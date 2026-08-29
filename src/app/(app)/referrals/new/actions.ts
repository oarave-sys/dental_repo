'use server'

import { z } from 'zod'
import { withAuthorizedAction } from '@/lib/actions/guard'
import { createReferral } from '@/lib/services/intake'
import { findPossibleDuplicates } from '@/lib/services/patients'
import { SIGNAL_LABELS, type MatchSignal } from '@/lib/domain/duplicate-detection'

const patientSchema = z.object({
  firstName: z.string().min(1, 'Enter a first name.').max(100),
  lastName: z.string().min(1, 'Enter a last name.').max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  phonePrimary: z.string().max(40).optional().nullable(),
  addressLine1: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(40).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
})

/**
 * Duplicate check, run before anything is written. The coordinator sees
 * "possible existing patient" and decides — the system never merges, and never
 * silently attaches to an existing record.
 */
export const checkDuplicatesAction = withAuthorizedAction({
  name: 'patient.checkDuplicates',
  permission: 'patient:read',
  schema: patientSchema,
  handler: async (input, ctx) => {
    const settings = await ctx.db.organizationSettings.findUnique({
      where: { organizationId: ctx.actor.organizationId },
      select: { duplicateReviewThreshold: true },
    })
    const matches = await findPossibleDuplicates(
      ctx.db,
      { ...input, dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00Z`) },
      settings?.duplicateReviewThreshold ?? 60,
    )
    return matches.map((m) => ({
      patientId: m.patient.id,
      firstName: m.patient.firstName,
      lastName: m.patient.lastName,
      dateOfBirth: m.patient.dateOfBirth.toISOString().slice(0, 10),
      score: m.score,
      strong: m.strong,
      reasons: m.signals.map((s: MatchSignal) => SIGNAL_LABELS[s]),
    }))
  },
})

export const createReferralAction = withAuthorizedAction({
  name: 'referral.create',
  permission: 'referral:create',
  schema: z.object({
    patient: patientSchema,
    existingPatientId: z.uuid().nullable().optional(),
    receivedAt: z.string().min(1),
    intakeChannel: z.enum(['FAX', 'PORTAL', 'PHONE', 'EMAIL', 'MANUAL', 'API']),
    referringOrganizationId: z.uuid().nullable().optional(),
    referringProviderId: z.uuid().nullable().optional(),
    payerId: z.uuid().nullable().optional(),
    memberId: z.string().max(64).nullable().optional(),
    referralDiagnosisText: z.string().max(500).nullable().optional(),
    referringDiagnosisCode: z.string().max(20).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }),
  handler: async (input, ctx) =>
    createReferral(ctx, {
      ...input,
      patient: {
        ...input.patient,
        dateOfBirth: new Date(`${input.patient.dateOfBirth}T00:00:00Z`),
      },
      receivedAt: new Date(input.receivedAt),
    }),
})
