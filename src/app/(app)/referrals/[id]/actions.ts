'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAuthorizedAction } from '@/lib/actions/guard'
import { changeStatus, assignReferral, addContactAttempt, addNote } from '@/lib/services/referrals'
import { linkEhrPatient } from '@/lib/services/patients'
import { evaluateReferral, setRequirementPresence } from '@/lib/services/triage'
import { REFERRAL_STATUSES } from '@/lib/domain/referral-status'

const statusEnum = z.enum(REFERRAL_STATUSES)

export const changeStatusAction = withAuthorizedAction({
  name: 'referral.changeStatus',
  permission: 'referral:status',
  schema: z.object({
    referralId: z.uuid(),
    to: statusEnum,
    reason: z.string().max(500).optional().nullable(),
  }),
  handler: async (input, ctx) => {
    const result = await changeStatus(ctx, input)
    revalidatePath(`/referrals/${input.referralId}`)
    return result
  },
})

export const assignAction = withAuthorizedAction({
  name: 'referral.assign',
  permission: 'referral:assign',
  schema: z.object({ referralId: z.uuid(), assignedUserId: z.uuid().nullable() }),
  handler: async (input, ctx) => {
    await assignReferral(ctx, input)
    revalidatePath(`/referrals/${input.referralId}`)
    return { ok: true }
  },
})

export const logContactAction = withAuthorizedAction({
  name: 'referral.logContact',
  permission: 'referral:contact',
  schema: z.object({
    referralId: z.uuid(),
    method: z.enum(['PHONE', 'VOICEMAIL', 'TEXT', 'EMAIL', 'MAIL', 'IN_PERSON']),
    outcome: z.enum(['REACHED', 'LEFT_VOICEMAIL', 'NO_ANSWER', 'WRONG_NUMBER', 'DECLINED', 'CALLBACK_REQUESTED']),
    note: z.string().max(1000).optional().nullable(),
  }),
  handler: async (input, ctx) => {
    await addContactAttempt(ctx, input)
    revalidatePath(`/referrals/${input.referralId}`)
    return { ok: true }
  },
})

export const addNoteAction = withAuthorizedAction({
  name: 'referral.addNote',
  permission: 'referral:update',
  schema: z.object({
    referralId: z.uuid(),
    note: z.string().min(1, 'Write a note first.').max(2000),
  }),
  handler: async (input, ctx) => {
    await addNote(ctx, input)
    revalidatePath(`/referrals/${input.referralId}`)
    return { ok: true }
  },
})

export const linkEhrAction = withAuthorizedAction({
  name: 'patient.linkEhr',
  permission: 'patient:link_ehr',
  schema: z.object({
    patientId: z.uuid(),
    referralId: z.uuid(),
    mrn: z.string().min(1, 'Enter the MRN.').max(64),
    ehrPatientId: z.string().max(64).optional().nullable(),
  }),
  handler: async (input, ctx) => {
    await linkEhrPatient(ctx, {
      patientId: input.patientId,
      mrn: input.mrn.trim(),
      ehrPatientId: input.ehrPatientId?.trim() || null,
      createdInEhrAt: new Date(),
    })
    revalidatePath(`/referrals/${input.referralId}`)
    return { ok: true }
  },
})

export const runTriageAction = withAuthorizedAction({
  name: 'referral.runTriage',
  permission: 'referral:update',
  schema: z.object({ referralId: z.uuid() }),
  handler: async (input, ctx) => {
    const result = await evaluateReferral(ctx, {
      referralId: input.referralId,
      trigger: 'REEVALUATION',
    })
    revalidatePath(`/referrals/${input.referralId}`)
    return result
  },
})

export const setRequirementAction = withAuthorizedAction({
  name: 'referral.setRequirement',
  permission: 'triage:override',
  schema: z.object({
    referralId: z.uuid(),
    requirementKey: z.string().min(1).max(64),
    status: z.enum(['PRESENT', 'ABSENT', 'UNCHECKED']),
  }),
  handler: async (input, ctx) => {
    await setRequirementPresence(ctx, input)
    revalidatePath(`/referrals/${input.referralId}`)
    return { ok: true }
  },
})
