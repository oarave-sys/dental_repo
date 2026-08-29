import crypto from 'node:crypto'
import type { TenantDb } from '@/lib/db/client'
import type { Actor } from '@/lib/authz'
import type { AuditInput } from '@/lib/audit'
import { notFound, conflict } from '@/lib/errors'
import { evaluateTriage, ENGINE_VERSION } from '@/lib/rules/engine'
import { DEFAULT_PRECEDENCE, type CompiledRuleSet, type DiagnosisFact, type RequirementFact, type TriageFacts, type RuleCondition } from '@/lib/rules/types'
import { matchCode, matchText, normalizeCode, isStructurallyValidCode, formatCode, type CategoryCodeMap, type Synonym } from '@/lib/icd10'

interface Ctx {
  db: TenantDb
  actor: Actor
  audit: (input: AuditInput) => void
  now?: Date
}

/**
 * Loads a rule set into the pure engine's shape.
 *
 * Everything the engine needs is read once and passed in, so the engine itself
 * stays free of I/O and a historical evaluation can be reproduced by loading
 * the version it names.
 */
export async function loadCompiledRuleSet(
  db: TenantDb,
  organizationId: string,
  versionId?: string,
): Promise<CompiledRuleSet | null> {
  const ruleSet = versionId
    ? await db.ruleSetVersion.findUnique({
        where: { id: versionId },
        include: { rules: { include: { actions: true } }, requirements: true, payerRules: true },
      })
    : await db.ruleSetVersion.findFirst({
        where: { status: 'PUBLISHED' },
        orderBy: { version: 'desc' },
        include: { rules: { include: { actions: true } }, requirements: true, payerRules: true },
      })

  if (!ruleSet) return null

  const settings = await db.organizationSettings.findUnique({
    where: { organizationId },
    select: { unknownDiagnosisBehavior: true, diagnosisConfidenceFloor: true, contestedMargin: true },
  })

  return {
    versionId: ruleSet.id,
    version: ruleSet.version,
    rules: ruleSet.rules
      .filter((r) => r.isActive)
      .map((r) => ({
        id: r.id,
        dimension: r.dimension,
        name: r.name,
        priority: r.priority,
        condition: r.condition as unknown as RuleCondition,
        outcome: r.outcome,
        blocking: r.blocking,
        rationale: r.rationale,
        actions: r.actions.map((a) => ({
          type: a.type,
          params: (a.params ?? undefined) as Record<string, unknown> | undefined,
        })),
      })),
    payerRules: ruleSet.payerRules
      .filter((p) => p.isActive)
      .map((p) => ({
        id: p.id, payerId: p.payerId, payerCategory: p.payerCategory,
        outcome: p.outcome, rationale: p.rationale,
      })),
    requirements: ruleSet.requirements.map((r) => ({
      key: r.key, label: r.label, level: r.level,
      appliesToCategoryKey: r.appliesToCategoryKey,
    })),
    precedence: DEFAULT_PRECEDENCE,
    unknownBehavior: settings?.unknownDiagnosisBehavior ?? 'YELLOW',
    diagnosisConfidenceFloor: settings?.diagnosisConfidenceFloor ?? 55,
    contestedMargin: settings?.contestedMargin ?? 12,
  }
}

/**
 * Diagnosis confidence, Phase 3 edition.
 *
 * Until Phase 4 there is no packet to read, so the only evidence is what the
 * referring office supplied: a diagnosis code and a free-text reason. The
 * scoring is deliberately modest and the framework is the one from
 * docs/ARCHITECTURE.md §7.1 — families with weights and caps — so Phase 4 adds
 * evidence families rather than replacing the model.
 */
const CONFIDENCE_MODEL_VERSION = 'diagnosis-confidence@0.3.0-prephase4'

interface ScoredCategory {
  categoryKey: string
  confidence: number
  matchType: DiagnosisFact['matchType']
  codes: string[]
  breakdown: Array<{ signal: string; detail: string; points: number }>
  possibleCodes: Array<{ code: string; description: string; note?: string }>
}

function scoreCategories(params: {
  code: string | null
  text: string | null
  codeMaps: CategoryCodeMap[]
  synonyms: Synonym[]
  specificityNotes: Map<string, string[]>
}): ScoredCategory[] {
  const scores = new Map<string, ScoredCategory>()

  const bump = (key: string, patch: Partial<ScoredCategory> & { points: number; signal: string; detail: string }) => {
    const existing = scores.get(key) ?? {
      categoryKey: key, confidence: 0, matchType: 'NONE' as const,
      codes: [], breakdown: [], possibleCodes: [],
    }
    existing.confidence += patch.points
    existing.breakdown.push({ signal: patch.signal, detail: patch.detail, points: patch.points })
    if (patch.codes) existing.codes = [...new Set([...existing.codes, ...patch.codes])]
    if (patch.matchType && patch.matchType !== 'NONE') {
      const rank = { EXACT_CODE: 5, CODE_FAMILY: 4, CODE_RANGE: 3, DIAGNOSIS_CATEGORY: 2, TEXT_SYNONYM: 1, NONE: 0 }
      if (rank[patch.matchType] > rank[existing.matchType]) existing.matchType = patch.matchType
    }
    scores.set(key, existing)
  }

  // F2 — coded evidence. The referring office chose this code deliberately,
  // which is the strongest signal available before the packet is read.
  if (params.code && isStructurallyValidCode(params.code)) {
    for (const match of matchCode(params.code, params.codeMaps)) {
      const points =
        match.matchType === 'EXACT_CODE' ? 78 :
        match.matchType === 'CODE_FAMILY' ? 70 : 66
      bump(match.categoryKey, {
        points,
        signal: 'REFERRING_DIAGNOSIS_CODE',
        detail: `${formatCode(params.code)} matched by ${match.matchType.replaceAll('_', ' ').toLowerCase()}`,
        matchType: match.matchType,
        codes: [normalizeCode(params.code)],
      })
    }
  }

  // F1 — the referral's own stated reason.
  if (params.text?.trim()) {
    for (const match of matchText(params.text, params.synonyms)) {
      // An abbreviation on its own must not carry a category: "RA" corroborates.
      const points = Math.round(match.weight * 0.55)
      bump(match.categoryKey, {
        points,
        signal: match.matchMode === 'ABBREVIATION' ? 'REFERRAL_REASON_ABBREVIATION' : 'REFERRAL_REASON_TEXT',
        detail: `Referral reason mentions "${match.term}"`,
        matchType: 'TEXT_SYNONYM',
      })
    }
  }

  const out = [...scores.values()].map((s) => {
    // Saturating, so repeated weak signals cannot manufacture certainty.
    const capped = Math.min(99, Math.round(100 * (1 - Math.exp(-s.confidence / 60))))
    const notes = params.specificityNotes.get(s.categoryKey) ?? []
    return {
      ...s,
      confidence: capped,
      possibleCodes: notes.map((note) => ({ code: '', description: note })),
    }
  })

  return out.sort((a, b) => b.confidence - a.confidence || a.categoryKey.localeCompare(b.categoryKey))
}

/**
 * Requirement facts.
 *
 * Phase 4 will detect these by searching the packet. Until then a coordinator
 * ticks off what the fax actually contains, and those confirmations carry
 * forward across re-evaluations — a human statement about a document does not
 * expire because the rules changed.
 */
async function requirementFacts(
  db: TenantDb,
  referralId: string,
  ruleSet: CompiledRuleSet,
): Promise<RequirementFact[]> {
  const priorRows = await db.referralRequirementResult.findMany({
    where: { triageEvaluation: { referralId }, humanOverride: true },
    orderBy: { createdAt: 'desc' },
    select: { requirementKey: true, status: true, createdAt: true },
  })
  const confirmed = new Map<string, 'PRESENT' | 'ABSENT'>()
  for (const row of priorRows) {
    if (row.status === 'UNCHECKED') continue
    if (!confirmed.has(row.requirementKey)) {
      confirmed.set(row.requirementKey, row.status as 'PRESENT' | 'ABSENT')
    }
  }

  return ruleSet.requirements.map((r) => ({
    key: r.key,
    label: r.label,
    level: r.level,
    // UNCHECKED until a coordinator says otherwise, or Phase 4 searches the
    // packet. Absence is a finding, not a default.
    status: confirmed.get(r.key) ?? 'UNCHECKED',
    detectionConfidence: null,
    searchCoverage: null,
  }))
}

export async function buildFacts(
  db: TenantDb,
  organizationId: string,
  referralId: string,
  ruleSet: CompiledRuleSet,
): Promise<{ facts: TriageFacts; scored: ScoredCategory[] }> {
  const referral = await db.referral.findUnique({
    where: { id: referralId },
    select: {
      id: true, referringDiagnosisCode: true, referralDiagnosisText: true,
      referringOrganizationId: true, referringProviderId: true, patientId: true,
      payer: { select: { id: true, category: true, name: true } },
      payerRawName: true,
    },
  })
  if (!referral) throw notFound('That referral no longer exists.')

  const [categories, maps, synonyms] = await Promise.all([
    db.referralCategory.findMany({ select: { id: true, key: true } }),
    db.referralCategoryCodeMap.findMany({
      select: { categoryId: true, matchType: true, value: true, valueTo: true, weight: true, specificityNote: true },
    }),
    db.diagnosisSynonym.findMany({
      select: { categoryId: true, term: true, matchMode: true, weight: true },
    }),
  ])
  const keyById = new Map(categories.map((c) => [c.id, c.key]))

  const codeMaps: CategoryCodeMap[] = maps.map((m) => ({
    categoryKey: keyById.get(m.categoryId) ?? '',
    matchType: m.matchType as CategoryCodeMap['matchType'],
    value: m.value,
    valueTo: m.valueTo,
    weight: m.weight,
    specificityNote: m.specificityNote,
  }))
  const specificityNotes = new Map<string, string[]>()
  for (const m of maps) {
    if (!m.specificityNote) continue
    const key = keyById.get(m.categoryId) ?? ''
    specificityNotes.set(key, [...(specificityNotes.get(key) ?? []), m.specificityNote])
  }

  const synonymList: Synonym[] = synonyms.map((s) => ({
    categoryKey: keyById.get(s.categoryId) ?? '',
    term: s.term,
    matchMode: s.matchMode as Synonym['matchMode'],
    weight: s.weight,
  }))

  const scored = scoreCategories({
    code: referral.referringDiagnosisCode,
    text: referral.referralDiagnosisText,
    codeMaps,
    synonyms: synonymList,
    specificityNotes,
  })

  // Is the primary clear? Two candidates within the margin means the system
  // refuses to pick and asks a physician instead.
  const [first, second] = scored
  let determinacy: TriageFacts['primaryDeterminacy'] = 'NONE'
  if (first) {
    determinacy =
      second && first.confidence - second.confidence < ruleSet.contestedMargin
        ? 'CONTESTED'
        : 'CLEAR'
  }

  const diagnosisCandidates: DiagnosisFact[] = scored.map((s, index) => ({
    categoryKey: s.categoryKey,
    rank: index + 1,
    isPrimary: index === 0 && determinacy === 'CLEAR',
    confidence: s.confidence,
    matchType: s.matchType,
    // Pre-Phase 4 the only context available is what the referring office
    // recorded. Labelling it honestly matters: rules filter on context.
    strongestContext: s.matchType === 'TEXT_SYNONYM' ? 'REFERRAL_REASON' : 'ENCOUNTER_DIAGNOSIS',
    polarity: 'AFFIRMED',
    codes: s.codes,
    possibleCodes: s.possibleCodes,
  }))

  // Existing patients: any prior referral that reached scheduling.
  const priorScheduled = await db.referral.count({
    where: {
      patientId: referral.patientId,
      id: { not: referralId },
      status: { in: ['SCHEDULED', 'CLOSED'] },
    },
  })

  const facts: TriageFacts = {
    diagnosisCandidates,
    primaryDeterminacy: determinacy,
    referralReasonText: referral.referralDiagnosisText ?? '',
    payer: {
      payerId: referral.payer?.id ?? null,
      category: referral.payer?.category ?? null,
      rawName: referral.payer?.name ?? referral.payerRawName ?? null,
    },
    requirements: await requirementFacts(db, referralId, ruleSet),
    referralSource: {
      organizationId: referral.referringOrganizationId,
      providerId: referral.referringProviderId,
      tags: [],
    },
    patientStatus: priorScheduled > 0 ? 'FORMER_PATIENT' : 'NEW',
    // No packet has been read yet, so coverage is not applicable rather than 0.
    packetCoverage: 100,
  }

  return { facts, scored }
}

function hashFacts(facts: TriageFacts): string {
  return crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32)
}

/**
 * Evaluates a referral and persists the result.
 *
 * Append-only: a re-run creates a new evaluation and marks the previous one
 * superseded. If rules change later, historical referrals must not silently
 * appear as though they were evaluated under the new ones.
 */
export async function evaluateReferral(
  ctx: Ctx,
  input: { referralId: string; trigger?: 'AUTOMATIC' | 'REEVALUATION'; ruleSetVersionId?: string },
): Promise<{ evaluationId: string; disposition: string }> {
  const orgId = ctx.actor.organizationId
  const ruleSet = await loadCompiledRuleSet(ctx.db, orgId, input.ruleSetVersionId)
  if (!ruleSet) {
    throw conflict('No published rule set. An administrator must publish one before triage can run.')
  }

  const { facts, scored } = await buildFacts(ctx.db, orgId, input.referralId, ruleSet)
  const result = evaluateTriage(facts, ruleSet)

  const previous = await ctx.db.triageEvaluation.findFirst({
    where: { referralId: input.referralId, supersededById: null },
    select: { id: true },
  })

  const categories = await ctx.db.referralCategory.findMany({ select: { id: true, key: true } })
  const idByKey = new Map(categories.map((c) => [c.key, c.id]))

  const evaluation = await ctx.db.triageEvaluation.create({
    data: {
      organizationId: orgId,
      referralId: input.referralId,
      ruleSetVersionId: ruleSet.versionId,
      engineVersion: `${ENGINE_VERSION}+${CONFIDENCE_MODEL_VERSION}`,
      trigger: input.trigger ?? 'AUTOMATIC',
      evaluatedAt: ctx.now ?? new Date(),
      finalDisposition: result.finalDisposition,
      dispositionConfidence: result.dispositionConfidence,
      nextAction: result.nextAction,
      factsHash: hashFacts(facts),
    },
    select: { id: true },
  })

  for (const [index, dimension] of result.dimensions.entries()) {
    await ctx.db.triageDimensionResult.create({
      data: {
        organizationId: orgId,
        triageEvaluationId: evaluation.id,
        dimension: dimension.dimension,
        outcome: dimension.outcome,
        summary: dimension.summary,
        matchedRuleIds: dimension.matchedRuleIds,
        blocking: dimension.blocking,
        decisive: dimension.decisive,
        sortOrder: index,
      },
    })
  }

  for (const candidate of facts.diagnosisCandidates) {
    const categoryId = idByKey.get(candidate.categoryKey)
    if (!categoryId) continue
    const detail = scored.find((s) => s.categoryKey === candidate.categoryKey)
    await ctx.db.diagnosisCandidate.create({
      data: {
        organizationId: orgId,
        triageEvaluationId: evaluation.id,
        categoryId,
        rank: candidate.rank,
        isPrimary: candidate.isPrimary,
        diagnosisConfidence: candidate.confidence,
        matchType: candidate.matchType,
        strongestContext: candidate.strongestContext,
        polarity: candidate.polarity,
        bestCode: candidate.codes[0] ? formatCode(candidate.codes[0]) : null,
        possibleCodes: (candidate.possibleCodes ?? undefined) as never,
        breakdown: {
          modelVersion: CONFIDENCE_MODEL_VERSION,
          terms: detail?.breakdown ?? [],
        } as never,
      },
    })
  }

  for (const requirement of facts.requirements) {
    await ctx.db.referralRequirementResult.create({
      data: {
        organizationId: orgId,
        triageEvaluationId: evaluation.id,
        requirementKey: requirement.key,
        label: requirement.label,
        level: requirement.level,
        status: requirement.status,
        detectionConfidence: requirement.detectionConfidence ?? null,
        searchCoverage: requirement.searchCoverage ?? null,
        // Carried forward from a coordinator's confirmation, not detected.
        humanOverride: requirement.status !== 'UNCHECKED',
      },
    })
  }

  if (previous) {
    await ctx.db.triageEvaluation.update({
      where: { id: previous.id },
      data: { supersededById: evaluation.id },
    })
  }

  await ctx.db.referral.update({
    where: { id: input.referralId },
    data: { currentTriageEvaluationId: evaluation.id },
  })

  await ctx.db.referralActivity.create({
    data: {
      organizationId: orgId,
      referralId: input.referralId,
      type: 'TRIAGE_GENERATED',
      actorType: 'USER',
      userId: ctx.actor.userId,
      metadata: {
        disposition: result.finalDisposition,
        ruleSetVersion: ruleSet.version,
      } as never,
    },
  })

  ctx.audit({
    action: 'RECORD_CREATE',
    resourceType: 'triage_evaluation',
    resourceId: evaluation.id,
    metadata: {
      disposition: result.finalDisposition,
      dispositionConfidence: result.dispositionConfidence,
      ruleSetVersion: ruleSet.version,
      decisiveDimension: result.decisiveDimension,
    },
  })

  return { evaluationId: evaluation.id, disposition: result.finalDisposition }
}

/** A coordinator ticking off what the fax actually contains. */
export async function setRequirementPresence(
  ctx: Ctx,
  input: { referralId: string; requirementKey: string; status: 'PRESENT' | 'ABSENT' | 'UNCHECKED' },
): Promise<void> {
  const current = await ctx.db.triageEvaluation.findFirst({
    where: { referralId: input.referralId, supersededById: null },
    select: { id: true },
  })
  if (!current) throw conflict('Run triage on this referral first.')

  await ctx.db.referralRequirementResult.updateMany({
    where: { triageEvaluationId: current.id, requirementKey: input.requirementKey },
    data: {
      status: input.status,
      humanOverride: input.status !== 'UNCHECKED',
      overriddenByUserId: ctx.actor.userId,
      overriddenAt: ctx.now ?? new Date(),
    },
  })

  ctx.audit({
    action: 'TRIAGE_OVERRIDE',
    resourceType: 'referral_requirement_result',
    resourceId: input.referralId,
    metadata: { requirementKey: input.requirementKey, status: input.status },
  })

  await evaluateReferral(ctx, { referralId: input.referralId, trigger: 'REEVALUATION' })
}

/**
 * The rule simulator (docs/ARCHITECTURE.md §5.5).
 *
 * Runs a draft rule set against recent referrals and reports what would change,
 * WITHOUT persisting anything. This is the feature that makes rule editing by a
 * non-engineer safe: "14 referrals change from GREEN to INCOMPLETE" is a
 * sentence an administrator can act on before publishing, not after.
 */
export interface SimulationRow {
  referralId: string
  patientInitials: string
  receivedAt: Date
  current: string | null
  proposed: string
  changed: boolean
  reason: string
}

export interface SimulationSummary {
  version: number
  evaluated: number
  changed: number
  transitions: Array<{ from: string; to: string; count: number }>
  rows: SimulationRow[]
}

export async function simulateRuleSet(
  db: TenantDb,
  organizationId: string,
  input: { ruleSetVersionId: string; limit?: number },
): Promise<SimulationSummary> {
  const ruleSet = await loadCompiledRuleSet(db, organizationId, input.ruleSetVersionId)
  if (!ruleSet) throw notFound('That rule set no longer exists.')

  const referrals = await db.referral.findMany({
    where: { deletedAt: null },
    orderBy: { receivedAt: 'desc' },
    take: input.limit ?? 100,
    select: {
      id: true,
      receivedAt: true,
      patient: { select: { firstName: true, lastName: true } },
    },
  })

  const rows: SimulationRow[] = []
  const transitions = new Map<string, number>()

  for (const referral of referrals) {
    const current = await db.triageEvaluation.findFirst({
      where: { referralId: referral.id, supersededById: null },
      select: { finalDisposition: true },
    })
    const { facts } = await buildFacts(db, organizationId, referral.id, ruleSet)
    const result = evaluateTriage(facts, ruleSet)

    const from = current?.finalDisposition ?? 'NONE'
    const changed = from !== result.finalDisposition
    if (changed) {
      const key = `${from}→${result.finalDisposition}`
      transitions.set(key, (transitions.get(key) ?? 0) + 1)
    }

    rows.push({
      referralId: referral.id,
      // Initials only: a simulation is an administrative view of policy, and
      // does not need to name patients.
      patientInitials: `${referral.patient.firstName[0] ?? ''}${referral.patient.lastName[0] ?? ''}`.toUpperCase(),
      receivedAt: referral.receivedAt,
      current: current?.finalDisposition ?? null,
      proposed: result.finalDisposition,
      changed,
      reason: result.decisiveReason,
    })
  }

  return {
    version: ruleSet.version,
    evaluated: rows.length,
    changed: rows.filter((r) => r.changed).length,
    transitions: [...transitions.entries()]
      .map(([key, count]) => {
        const [from = '', to = ''] = key.split('→')
        return { from, to, count }
      })
      .sort((a, b) => b.count - a.count),
    rows: rows.filter((r) => r.changed).slice(0, 50),
  }
}

/** The full explanation behind a persisted evaluation. Drives "why this score?". */
export async function loadEvaluationDetail(db: TenantDb, referralId: string) {
  return db.triageEvaluation.findFirst({
    where: { referralId, supersededById: null },
    include: {
      ruleSetVersion: { select: { version: true, publishedAt: true } },
      dimensionResults: { orderBy: { sortOrder: 'asc' } },
      diagnosisCandidates: {
        orderBy: { rank: 'asc' },
        include: { category: { select: { key: true, name: true } } },
      },
      requirementResults: { orderBy: { requirementKey: 'asc' } },
    },
  })
}

export type EvaluationDetail = NonNullable<Awaited<ReturnType<typeof loadEvaluationDetail>>>
