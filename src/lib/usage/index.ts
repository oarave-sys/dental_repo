import { withTenant } from '@/lib/db/client'
import type { ExtractionUsage } from '@/lib/coding/ai'
import { logger } from '@/lib/logging/logger'

/**
 * Usage and cost recording.
 *
 * Deliberately narrow: counts, durations, enum values and opaque IDs. No
 * clinical text ever reaches these tables, which is what lets the admin area
 * report on volume and spend across practices without anyone being able to
 * read what a practice typed.
 */

export type UsageEventType =
  | 'query.completed'
  | 'query.clarification_asked'
  | 'query.clarification_answered'
  | 'query.failed'
  | 'code.checked'
  | 'case.saved'
  | 'case.deleted'
  | 'member.invited'

export type Tool = 'FIND_CODE' | 'CHECK_CODE' | 'DOCUMENTATION_CHECK' | 'CLAIM_SCRUBBER'

export interface RecordUsageInput {
  organizationId: string
  userId?: string | null
  eventType: UsageEventType
  tool?: Tool | null
  /** Numbers, booleans and enum values only. Never free text. */
  metadata?: Record<string, string | number | boolean | null>
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    await withTenant(input.organizationId, async (db) => {
      await db.usageEvent.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          eventType: input.eventType,
          tool: input.tool ?? null,
          metadata: input.metadata ?? {},
        },
      })
    })
  } catch (error) {
    // Usage accounting must never break the thing being accounted for.
    logger.warn('usage.record_failed', {
      organizationId: input.organizationId,
      eventType: input.eventType,
    })
  }
}

export async function recordAiRequest(params: {
  organizationId: string
  queryId?: string | null
  purpose: string
  usage: ExtractionUsage
}): Promise<void> {
  try {
    await withTenant(params.organizationId, async (db) => {
      await db.aiRequest.create({
        data: {
          organizationId: params.organizationId,
          queryId: params.queryId ?? null,
          provider: params.usage.provider,
          model: params.usage.model,
          purpose: params.purpose,
          inputTokens: params.usage.inputTokens,
          outputTokens: params.usage.outputTokens,
          costMillicents: params.usage.costMillicents,
          latencyMs: params.usage.latencyMs,
          success: params.usage.success,
          errorCode: params.usage.errorCode ?? null,
        },
      })
    })
  } catch {
    logger.warn('usage.ai_record_failed', { organizationId: params.organizationId })
  }
}

/** Formats tenth-of-a-cent units for display. */
export function formatCost(millicents: number): string {
  const dollars = millicents / 100_000
  if (dollars === 0) return '$0.00'
  if (dollars < 0.01) return '<$0.01'
  return `$${dollars.toFixed(2)}`
}
