import { withTenant } from '@/lib/db/client'
import { notFound } from '@/lib/errors'
import { recordAiRequest, recordUsage, type Tool } from '@/lib/usage'
import { recordAudit } from '@/lib/audit'
import type { ExtractionUsage } from './ai'
import type { CodingResult } from './result'

/**
 * Persistence for coding work.
 *
 * Two privacy decisions are enforced here rather than left to call sites:
 *
 *   · The clinical description is stored only when the practice has left
 *     retention on. With it off, the response is still returned but the input
 *     is never written down.
 *   · The list label is derived from structured facts, not from the input, so
 *     a recent-searches list never puts clinical text on a shared screen it
 *     was not asked to.
 */

export interface SaveQueryInput {
  organizationId: string
  userId: string
  tool: Tool
  input: string
  result: CodingResult
  usage?: ExtractionUsage | null
}

/** A short, non-clinical label: "Restorative · #30". */
export function displayLabelFor(result: CodingResult): string {
  const first = result.procedures[0]
  if (!first) return 'No procedure identified'

  const parts: string[] = []
  const kind = first.procedureSummary.split(' · ')[0]
  if (kind) parts.push(kind)

  const codes = result.recommendedCodes.map((c) => c.code)
  if (codes.length > 0) parts.push(codes.join(', '))
  else if (result.status === 'NEEDS_INPUT') parts.push('needs a detail')

  if (result.procedures.length > 1) parts.push(`+${result.procedures.length - 1} more`)
  return parts.join(' · ')
}

export async function saveQuery(input: SaveQueryInput): Promise<string> {
  const queryId = await withTenant(input.organizationId, async (db) => {
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: { retainQueryText: true },
    })

    const query = await db.codingQuery.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        tool: input.tool,
        status: input.result.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'COMPLETE',
        inputText: organization.retainQueryText ? input.input : null,
        displayLabel: displayLabelFor(input.result),
        result: input.result as unknown as object,
        confidence: input.result.confidence,
        primaryCode: input.result.recommendedCodes[0]?.code ?? null,
      },
    })

    if (organization.retainQueryText) {
      await db.codingQueryMessage.create({
        data: {
          organizationId: input.organizationId,
          queryId: query.id,
          role: 'USER',
          content: input.input,
        },
      })
    }

    for (const question of input.result.followUpQuestions) {
      await db.codingQueryMessage.create({
        data: {
          organizationId: input.organizationId,
          queryId: query.id,
          role: 'ASSISTANT_QUESTION',
          content: question.question,
          factKey: question.factKey,
        },
      })
    }

    return query.id
  })

  await recordUsage({
    organizationId: input.organizationId,
    userId: input.userId,
    eventType:
      input.result.status === 'NEEDS_INPUT' ? 'query.clarification_asked' : 'query.completed',
    tool: input.tool,
    metadata: {
      confidence: input.result.confidence,
      procedureCount: input.result.procedures.length,
      codeCount: input.result.recommendedCodes.length,
      questionCount: input.result.followUpQuestions.length,
      documentationScore: input.result.documentation.percentage,
      aiAssisted: input.result.aiAssisted,
    },
  })

  if (input.usage) {
    await recordAiRequest({
      organizationId: input.organizationId,
      queryId,
      purpose: 'fact_extraction',
      usage: input.usage,
    })
  }

  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: 'CLINICAL_CONTENT_CREATED',
    subjectType: 'CodingQuery',
    subjectId: queryId,
    metadata: { tool: input.tool, retained: input.result.evidence.source.length > 0 },
  })

  return queryId
}

/** Records an answered clarification and the refined result against the query. */
export async function appendAnswer(params: {
  organizationId: string
  userId: string
  queryId: string
  answers: Record<string, string>
  result: CodingResult
  usage?: ExtractionUsage | null
}): Promise<void> {
  await withTenant(params.organizationId, async (db) => {
    const query = await db.codingQuery.findUnique({ where: { id: params.queryId } })
    if (!query) throw notFound('That search was not found.')

    const organization = await db.organization.findUniqueOrThrow({
      where: { id: params.organizationId },
      select: { retainQueryText: true },
    })

    if (organization.retainQueryText) {
      for (const [key, answer] of Object.entries(params.answers)) {
        await db.codingQueryMessage.create({
          data: {
            organizationId: params.organizationId,
            queryId: params.queryId,
            role: 'USER_ANSWER',
            content: answer,
            factKey: key.includes(':') ? (key.split(':')[1] ?? null) : key,
          },
        })
      }
    }

    await db.codingQuery.update({
      where: { id: params.queryId },
      data: {
        status: params.result.status === 'NEEDS_INPUT' ? 'NEEDS_INPUT' : 'COMPLETE',
        result: params.result as unknown as object,
        confidence: params.result.confidence,
        primaryCode: params.result.recommendedCodes[0]?.code ?? null,
        displayLabel: displayLabelFor(params.result),
      },
    })
  })

  await recordUsage({
    organizationId: params.organizationId,
    userId: params.userId,
    eventType: 'query.clarification_answered',
    tool: 'FIND_CODE',
    metadata: {
      answerCount: Object.keys(params.answers).length,
      confidence: params.result.confidence,
    },
  })

  if (params.usage) {
    await recordAiRequest({
      organizationId: params.organizationId,
      queryId: params.queryId,
      purpose: 'fact_extraction_refinement',
      usage: params.usage,
    })
  }
}

export interface RecentQuery {
  id: string
  tool: Tool
  status: string
  displayLabel: string | null
  primaryCode: string | null
  confidence: string | null
  createdAt: Date
  userName: string
}

export async function recentQueries(
  organizationId: string,
  options: { limit?: number; userId?: string } = {},
): Promise<RecentQuery[]> {
  return withTenant(organizationId, async (db) => {
    const rows = await db.codingQuery.findMany({
      where: options.userId ? { userId: options.userId } : {},
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 10,
      include: { user: { select: { name: true } } },
    })
    return rows.map((r) => ({
      id: r.id,
      tool: r.tool as Tool,
      status: r.status,
      displayLabel: r.displayLabel,
      primaryCode: r.primaryCode,
      confidence: r.confidence,
      createdAt: r.createdAt,
      userName: r.user.name,
    }))
  })
}

export async function loadQuery(
  organizationId: string,
  queryId: string,
  viewer?: { userId: string },
) {
  if (viewer) {
    await recordAudit({
      organizationId,
      userId: viewer.userId,
      action: 'CLINICAL_CONTENT_VIEWED',
      subjectType: 'CodingQuery',
      subjectId: queryId,
    })
  }
  return withTenant(organizationId, async (db) => {
    const query = await db.codingQuery.findUnique({
      where: { id: queryId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        user: { select: { name: true } },
      },
    })
    if (!query) throw notFound('That search was not found.')
    return query
  })
}

// ---------------------------------------------------------------------------
// Saved cases
// ---------------------------------------------------------------------------

export async function saveCase(params: {
  organizationId: string
  userId: string
  queryId: string | null
  title: string
  notes?: string
  codes: string[]
}): Promise<string> {
  const id = await withTenant(params.organizationId, async (db) => {
    const row = await db.savedCase.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        queryId: params.queryId,
        title: params.title.trim().slice(0, 200) || 'Saved case',
        notes: params.notes?.trim() || null,
        codes: params.codes,
      },
    })
    return row.id
  })

  await recordUsage({
    organizationId: params.organizationId,
    userId: params.userId,
    eventType: 'case.saved',
    metadata: { codeCount: params.codes.length },
  })

  await recordAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    action: 'CASE_SAVED',
    subjectType: 'SavedCase',
    subjectId: id,
    metadata: { codeCount: params.codes.length },
  })

  return id
}

export async function listSavedCases(organizationId: string, limit = 20) {
  return withTenant(organizationId, async (db) =>
    db.savedCase.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true } } },
    }),
  )
}

export async function deleteSavedCase(params: {
  organizationId: string
  userId: string
  caseId: string
}): Promise<void> {
  await withTenant(params.organizationId, async (db) => {
    const existing = await db.savedCase.findUnique({ where: { id: params.caseId } })
    if (!existing) throw notFound('That case was not found.')
    await db.savedCase.delete({ where: { id: params.caseId } })
  })

  await recordUsage({
    organizationId: params.organizationId,
    userId: params.userId,
    eventType: 'case.deleted',
  })

  await recordAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    action: 'CASE_DELETED',
    subjectType: 'SavedCase',
    subjectId: params.caseId,
  })
}
