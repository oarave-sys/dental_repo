'use server'

import { requireActor } from '@/lib/auth/current'
import { requirePermission } from '@/lib/authz'
import { checkCodeAgainstDescription, type CheckCodeResult } from '@/lib/coding/tools'
import { saveQuery } from '@/lib/coding/queries'
import { recordUsage } from '@/lib/usage'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logging/logger'
import type { CodingResult } from '@/lib/coding/result'

export interface CheckCodeState {
  explanation?: CheckCodeResult
  analysis?: CodingResult | null
  code?: string
  description?: string
  error?: string
}

const CODE_SHAPE = /^[Dd]?\d{4}$/

export async function checkCodeAction(
  prev: CheckCodeState,
  formData: FormData,
): Promise<CheckCodeState> {
  const actor = await requireActor()
  requirePermission(actor, 'coding:use')

  const raw = String(formData.get('code') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()

  if (!raw) return { ...prev, error: 'Enter a procedure code.' }

  // Normalise "2393" to "D2393" before looking anything up; anything that is
  // not code-shaped is rejected here rather than becoming a failed lookup.
  const normalised = CODE_SHAPE.test(raw)
    ? `D${raw.replace(/^[Dd]/, '')}`
    : raw.toUpperCase()

  if (!/^D\d{4}$/.test(normalised)) {
    return {
      ...prev,
      code: raw,
      error: 'A procedure code looks like D2393 — the letter D followed by four digits.',
    }
  }

  try {
    const { explanation, analysis } = await checkCodeAgainstDescription(normalised, description)

    await recordUsage({
      organizationId: actor.organizationId,
      userId: actor.userId,
      eventType: 'code.checked',
      tool: 'CHECK_CODE',
      metadata: {
        found: explanation.found,
        withDescription: description.length > 0,
        conflicts: analysis?.warnings.filter((w) => w.severity === 'CONFLICT').length ?? 0,
      },
    })

    if (analysis) {
      try {
        await saveQuery({
          organizationId: actor.organizationId,
          userId: actor.userId,
          tool: 'CHECK_CODE',
          input: description,
          result: analysis,
        })
      } catch {
        logger.warn('check_code.persist_failed', { organizationId: actor.organizationId })
      }
    }

    return { explanation, analysis, code: normalised, description }
  } catch (error) {
    logger.error('check_code.failed', { organizationId: actor.organizationId })
    return {
      ...prev,
      code: raw,
      error: isAppError(error) ? error.message : 'We could not check that code.',
    }
  }
}
