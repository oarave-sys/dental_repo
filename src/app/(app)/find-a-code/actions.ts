'use server'

import { requireActor } from '@/lib/auth/current'
import { requirePermission } from '@/lib/authz'
import { findCode } from '@/lib/coding/tools'
import { appendAnswer, saveCase, saveQuery } from '@/lib/coding/queries'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logging/logger'
import type { CodingResult } from '@/lib/coding/result'
import { revalidatePath } from 'next/cache'

/**
 * Find a Code.
 *
 * The conversational loop lives in this action's state: the original
 * description and every answer given so far travel together, and the whole
 * analysis is re-run from scratch each time. Re-running rather than patching
 * the previous result means an answer can never leave a stale recommendation
 * behind, and the engine stays a pure function of the facts it was given.
 */

export interface FindCodeState {
  result?: CodingResult
  /** The description being refined, carried across clarification rounds. */
  description?: string
  answers?: Record<string, string>
  /** Asked questions, so the model sees the conversation on a re-run. */
  priorAnswers?: Array<{ question: string; answer: string }>
  queryId?: string | null
  error?: string
  savedCaseId?: string
}

const MAX_INPUT = 8000

export async function analyseAction(
  prev: FindCodeState,
  formData: FormData,
): Promise<FindCodeState> {
  const actor = await requireActor()
  requirePermission(actor, 'coding:use')

  const submitted = String(formData.get('description') ?? '').trim()
  const isFollowUp = formData.get('intent') === 'answer'
  const description = isFollowUp ? (prev.description ?? submitted) : submitted

  if (!description) {
    return { ...prev, error: 'Describe what you did to get started.' }
  }
  if (description.length > MAX_INPUT) {
    return { ...prev, error: `Keep the description under ${MAX_INPUT} characters.` }
  }

  // Collect answers from this round. Keys are "<intentId>:<factKey>".
  const answers: Record<string, string> = isFollowUp ? { ...(prev.answers ?? {}) } : {}
  const priorAnswers = isFollowUp ? [...(prev.priorAnswers ?? [])] : []

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('answer:')) continue
    const factKey = key.slice('answer:'.length)
    const answer = String(value).trim()
    if (!answer) continue
    answers[factKey] = answer

    const question = prev.result?.followUpQuestions.find((q) => q.key === factKey)
    if (question) priorAnswers.push({ question: question.question, answer })
  }

  try {
    const { result, usage } = await findCode({ description, answers, priorAnswers })

    // Persistence is best-effort: a practice with no database configured still
    // gets its answer, it just does not get history.
    let queryId = prev.queryId ?? null
    try {
      if (isFollowUp && queryId) {
        await appendAnswer({
          organizationId: actor.organizationId,
          userId: actor.userId,
          queryId,
          answers,
          result,
          usage,
        })
      } else {
        queryId = await saveQuery({
          organizationId: actor.organizationId,
          userId: actor.userId,
          tool: 'FIND_CODE',
          input: description,
          result,
          usage,
        })
      }
      revalidatePath('/dashboard')
    } catch (error) {
      logger.warn('find_code.persist_failed', { organizationId: actor.organizationId })
      queryId = null
    }

    return { result, description, answers, priorAnswers, queryId }
  } catch (error) {
    logger.error('find_code.failed', {
      organizationId: actor.organizationId,
      message: isAppError(error) ? error.code : 'unknown',
    })
    return {
      ...prev,
      description,
      error: isAppError(error)
        ? error.message
        : 'We could not analyse that description. Try again.',
    }
  }
}

export async function saveCaseAction(
  prev: FindCodeState,
  formData: FormData,
): Promise<FindCodeState> {
  const actor = await requireActor()
  requirePermission(actor, 'case:write')

  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { ...prev, error: 'Give this case a short title.' }

  try {
    const id = await saveCase({
      organizationId: actor.organizationId,
      userId: actor.userId,
      queryId: prev.queryId ?? null,
      title,
      notes: String(formData.get('notes') ?? ''),
      codes: prev.result?.recommendedCodes.map((c) => c.code) ?? [],
    })
    revalidatePath('/cases')
    revalidatePath('/dashboard')
    return { ...prev, savedCaseId: id, error: undefined }
  } catch (error) {
    return {
      ...prev,
      error: isAppError(error) ? error.message : 'We could not save that case.',
    }
  }
}
