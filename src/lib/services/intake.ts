import type { TenantDb } from '@/lib/db/client'
import type { Actor } from '@/lib/authz'
import type { AuditInput } from '@/lib/audit'
import { notFound } from '@/lib/errors'
import { createPatient, type PatientInput } from './patients'

interface Ctx {
  db: TenantDb
  actor: Actor
  audit: (input: AuditInput) => void
  now?: Date
}

export interface ReferralIntakeInput {
  patient: PatientInput
  /** Attach to an existing staging patient instead of creating one. */
  existingPatientId?: string | null
  receivedAt: Date
  intakeChannel: 'FAX' | 'PORTAL' | 'PHONE' | 'EMAIL' | 'MANUAL' | 'API'
  referringOrganizationId?: string | null
  referringProviderId?: string | null
  referralDiagnosisText?: string | null
  referringDiagnosisCode?: string | null
  payerId?: string | null
  payerRawName?: string | null
  memberId?: string | null
  notes?: string | null
}

/**
 * Creates a referral, and a staging patient if this is a new person.
 *
 * Note what does NOT happen: no EHR chart is created. That is the entire point
 * of the product — a referral is not a patient until it survives the workflow.
 */
export async function createReferral(
  ctx: Ctx,
  input: ReferralIntakeInput,
): Promise<{ referralId: string; patientId: string }> {
  const now = ctx.now ?? new Date()

  let patientId = input.existingPatientId ?? null
  if (patientId) {
    const existing = await ctx.db.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    })
    if (!existing) throw notFound('That patient no longer exists.')
  } else {
    patientId = (await createPatient(ctx, input.patient)).id
  }

  const referral = await ctx.db.referral.create({
    data: {
      organizationId: ctx.actor.organizationId,
      patientId,
      receivedAt: input.receivedAt,
      intakeChannel: input.intakeChannel,
      referringOrganizationId: input.referringOrganizationId ?? null,
      referringProviderId: input.referringProviderId ?? null,
      referralDiagnosisText: input.referralDiagnosisText ?? null,
      referringDiagnosisCode: input.referringDiagnosisCode ?? null,
      payerId: input.payerId ?? null,
      payerRawName: input.payerRawName ?? null,
      memberId: input.memberId ?? null,
      notes: input.notes ?? null,
      status: 'NEW',
      lastActivityAt: now,
    },
    select: { id: true },
  })

  await ctx.db.referralStatusHistory.create({
    data: {
      organizationId: ctx.actor.organizationId,
      referralId: referral.id,
      fromStatus: null,
      toStatus: 'NEW',
      actorType: 'USER',
      changedByUserId: ctx.actor.userId,
      reason: 'Referral received',
    },
  })

  for (const type of ['REFERRAL_RECEIVED', 'REFERRAL_CREATED'] as const) {
    await ctx.db.referralActivity.create({
      data: {
        organizationId: ctx.actor.organizationId,
        referralId: referral.id,
        type,
        actorType: 'USER',
        userId: ctx.actor.userId,
        occurredAt: type === 'REFERRAL_RECEIVED' ? input.receivedAt : now,
      },
    })
  }

  if (input.referringOrganizationId) {
    await ctx.db.referringOrganization.update({
      where: { id: input.referringOrganizationId },
      data: { lastReferralAt: input.receivedAt },
    })
  }

  ctx.audit({
    action: 'RECORD_CREATE',
    resourceType: 'referral',
    resourceId: referral.id,
    metadata: {
      intakeChannel: input.intakeChannel,
      attachedToExistingPatient: input.existingPatientId != null,
    },
  })

  return { referralId: referral.id, patientId }
}
