'use server'

import { requireActor } from '@/lib/auth/current'
import { requirePermission } from '@/lib/authz'
import { documentationCheck } from '@/lib/coding/tools'
import { saveQuery } from '@/lib/coding/queries'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logging/logger'
import type { CodingResult } from '@/lib/coding/result'
import { revalidatePath } from 'next/cache'

export interface DocCheckState {
  result?: CodingResult
  note?: string
  codes?: string
  queryId?: string | null
  error?: string
}

const MAX_NOTE = 20_000

export async function documentationCheckAction(
  prev: DocCheckState,
  formData: FormData,
): Promise<DocCheckState> {
  const actor = await requireActor()
  requirePermission(actor, 'coding:use')

  const note = String(formData.get('note') ?? '').trim()
  const codesRaw = String(formData.get('codes') ?? '').trim()

  if (!note) return { ...prev, error: 'Paste a clinical note to review.' }
  if (note.length > MAX_NOTE) {
    return { ...prev, error: `Notes are limited to ${MAX_NOTE.toLocaleString()} characters.` }
  }

  // Accept "D2393, D0274" or "D2393 D0274" or one per line.
  const selectedCodes = codesRaw
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^D\d{4}$/.test(c))

  try {
    const { result, usage } = await documentationCheck({ note, selectedCodes })

    let queryId: string | null = null
    try {
      queryId = await saveQuery({
        organizationId: actor.organizationId,
        userId: actor.userId,
        tool: 'DOCUMENTATION_CHECK',
        input: note,
        result,
        usage,
      })
      revalidatePath('/dashboard')
    } catch {
      logger.warn('doc_check.persist_failed', { organizationId: actor.organizationId })
    }

    return { result, note, codes: codesRaw, queryId }
  } catch (error) {
    logger.error('doc_check.failed', { organizationId: actor.organizationId })
    return {
      ...prev,
      note,
      error: isAppError(error) ? error.message : 'We could not review that note.',
    }
  }
}
