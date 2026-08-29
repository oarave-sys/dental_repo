import type { TenantDb } from '@/lib/db/client'
import type { Actor } from '@/lib/authz'
import type { AuditInput } from '@/lib/audit'
import { conflict, notFound } from '@/lib/errors'
import { findDuplicates, type DuplicateMatch, type PersonRecord } from '@/lib/domain/duplicate-detection'

interface Ctx {
  db: TenantDb
  actor: Actor
  audit: (input: AuditInput) => void
  now?: Date
}

export interface PatientInput {
  firstName: string
  lastName: string
  dateOfBirth: Date
  sex?: string | null
  phonePrimary?: string | null
  phoneSecondary?: string | null
  email?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}

/**
 * Candidate pool for duplicate detection.
 *
 * Blocked on date of birth, surname prefix, or phone rather than scanning the
 * whole staging database — the scoring in lib/domain is cheap, but loading
 * every patient to run it is not.
 */
async function candidatePool(db: TenantDb, input: PatientInput): Promise<PersonRecord[]> {
  const surnamePrefix = input.lastName.trim().slice(0, 3)
  const rows = await db.patient.findMany({
    where: {
      deletedAt: null,
      mergedIntoPatientId: null,
      OR: [
        { dateOfBirth: input.dateOfBirth },
        { lastName: { startsWith: surnamePrefix, mode: 'insensitive' } },
        ...(input.phonePrimary ? [{ phonePrimary: input.phonePrimary }] : []),
      ],
    },
    select: {
      id: true, firstName: true, lastName: true, dateOfBirth: true,
      phonePrimary: true, phoneSecondary: true, addressLine1: true, postalCode: true,
      ehrLink: { select: { mrn: true } },
    },
    take: 400,
  })
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    dateOfBirth: r.dateOfBirth,
    phonePrimary: r.phonePrimary,
    phoneSecondary: r.phoneSecondary,
    addressLine1: r.addressLine1,
    postalCode: r.postalCode,
    mrn: r.ehrLink?.mrn ?? null,
  }))
}

/**
 * Duplicate suspicions for a not-yet-created patient. Called before creation so
 * the coordinator sees "possible existing patient" and chooses — the system
 * never merges, and never silently attaches.
 */
export async function findPossibleDuplicates(
  db: TenantDb,
  input: PatientInput,
  threshold: number,
): Promise<Array<DuplicateMatch & { patient: { id: string; firstName: string; lastName: string; dateOfBirth: Date } }>> {
  const pool = await candidatePool(db, input)
  const subject: PersonRecord = { id: '__new__', ...input }
  const matches = findDuplicates(subject, pool, threshold)
  const byId = new Map(pool.map((p) => [p.id, p]))
  return matches.map((m) => {
    const p = byId.get(m.candidateId)!
    return {
      ...m,
      patient: { id: p.id, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth },
    }
  })
}

export async function createPatient(ctx: Ctx, input: PatientInput): Promise<{ id: string }> {
  const patient = await ctx.db.patient.create({
    data: { organizationId: ctx.actor.organizationId, ...input },
    select: { id: true },
  })

  // Record the suspicions so the review queue has them, but never act on them.
  const settings = await ctx.db.organizationSettings.findUnique({
    where: { organizationId: ctx.actor.organizationId },
    select: { duplicateReviewThreshold: true },
  })
  const matches = await findPossibleDuplicates(
    ctx.db,
    input,
    settings?.duplicateReviewThreshold ?? 60,
  )
  for (const match of matches) {
    if (match.patient.id === patient.id) continue
    await ctx.db.patientMatchCandidate.create({
      data: {
        organizationId: ctx.actor.organizationId,
        patientId: patient.id,
        candidatePatientId: match.patient.id,
        score: match.score,
        matchedOn: match.signals,
      },
    })
  }

  ctx.audit({
    action: 'RECORD_CREATE',
    resourceType: 'patient',
    resourceId: patient.id,
    metadata: { possibleDuplicates: matches.length },
  })
  return patient
}

export async function reviewDuplicate(
  ctx: Ctx,
  input: { matchId: string; decision: 'LINKED' | 'DISMISSED' },
): Promise<void> {
  const match = await ctx.db.patientMatchCandidate.findUnique({
    where: { id: input.matchId },
    select: { id: true, status: true },
  })
  if (!match) throw notFound('That duplicate review no longer exists.')
  if (match.status !== 'OPEN') throw conflict('That duplicate has already been reviewed.')

  await ctx.db.patientMatchCandidate.update({
    where: { id: input.matchId },
    data: {
      status: input.decision,
      reviewedByUserId: ctx.actor.userId,
      reviewedAt: ctx.now ?? new Date(),
    },
  })
  ctx.audit({
    action: 'PATIENT_MERGE_REVIEWED',
    resourceType: 'patient_match_candidate',
    resourceId: input.matchId,
    metadata: { decision: input.decision },
  })
}

/**
 * "Mark as created in EHR" — the last step of the workflow, and the only point
 * at which this system's staging record becomes a chart in the EHR.
 */
export async function linkEhrPatient(
  ctx: Ctx,
  input: { patientId: string; mrn: string; ehrPatientId?: string | null; createdInEhrAt: Date },
): Promise<void> {
  const patient = await ctx.db.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true, ehrLink: { select: { id: true } } },
  })
  if (!patient) throw notFound('That patient no longer exists.')
  if (patient.ehrLink) throw conflict('This patient is already linked to an EHR chart.')

  const clash = await ctx.db.ehrLink.findFirst({
    where: { mrn: input.mrn },
    select: { patientId: true },
  })
  if (clash) throw conflict('That MRN is already linked to another patient in this organization.')

  await ctx.db.ehrLink.create({
    data: {
      organizationId: ctx.actor.organizationId,
      patientId: input.patientId,
      mrn: input.mrn,
      ehrPatientId: input.ehrPatientId ?? null,
      createdInEhrAt: input.createdInEhrAt,
      linkedByUserId: ctx.actor.userId,
      linkMethod: 'MANUAL',
    },
  })

  const referrals = await ctx.db.referral.findMany({
    where: { patientId: input.patientId, deletedAt: null },
    select: { id: true },
  })
  for (const referral of referrals) {
    await ctx.db.referralActivity.create({
      data: {
        organizationId: ctx.actor.organizationId,
        referralId: referral.id,
        type: 'EHR_PATIENT_LINKED',
        actorType: 'USER',
        userId: ctx.actor.userId,
        subjectType: 'patient',
        subjectId: input.patientId,
      },
    })
  }

  // The MRN itself is an identifier: recorded on the link, not in the audit row.
  ctx.audit({
    action: 'EHR_LINK_CREATED',
    resourceType: 'patient',
    resourceId: input.patientId,
    metadata: { referralsAffected: referrals.length },
  })
}
