import type { TenantDb } from '@/lib/db/client'
import type { Actor } from '@/lib/authz'
import type { AuditInput } from '@/lib/audit'
import { conflict, notFound } from '@/lib/errors'
import {
  canTransition,
  transitionEffect,
  allowedTransitions,
  STATUS_LABELS,
  type ReferralStatus,
} from '@/lib/domain/referral-status'
import { buildCalendar, businessSecondsBetween } from '@/lib/domain/business-time'

type Audit = (input: AuditInput) => void

/**
 * Referral workflow. Every mutation here does three things together, inside the
 * caller's transaction: change the record, append to the immutable timeline,
 * and queue an audit row. They are not separable — a status change that is not
 * on the timeline did not happen as far as the practice is concerned.
 */

interface Ctx {
  db: TenantDb
  actor: Actor
  audit: Audit
  now?: Date
}

/** First staff action on a referral, whatever it was. Drives touch-time. */
async function markTouched(db: TenantDb, referralId: string, now: Date): Promise<void> {
  await db.referral.updateMany({
    where: { id: referralId, firstTouchedAt: null },
    data: { firstTouchedAt: now },
  })
}

async function recordActivity(
  ctx: Ctx,
  referralId: string,
  type: Parameters<TenantDb['referralActivity']['create']>[0]['data']['type'],
  options: { note?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const now = ctx.now ?? new Date()
  await ctx.db.referralActivity.create({
    data: {
      organizationId: ctx.actor.organizationId,
      referralId,
      type,
      actorType: 'USER',
      userId: ctx.actor.userId,
      occurredAt: now,
      note: options.note ?? null,
      metadata: (options.metadata ?? undefined) as never,
    },
  })
  await ctx.db.referral.update({
    where: { id: referralId },
    data: { lastActivityAt: now },
  })
}

export async function changeStatus(
  ctx: Ctx,
  input: { referralId: string; to: ReferralStatus; reason?: string | null },
): Promise<{ from: ReferralStatus; to: ReferralStatus }> {
  const now = ctx.now ?? new Date()
  const referral = await ctx.db.referral.findUnique({
    where: { id: input.referralId },
    select: {
      id: true, status: true, receivedAt: true,
      firstTriagedAt: true, firstContactedAt: true,
      readyToScheduleAt: true, scheduledAt: true, closedAt: true,
    },
  })
  if (!referral) throw notFound('That referral no longer exists.')

  const from = referral.status as ReferralStatus
  if (!canTransition(from, input.to)) {
    throw conflict(
      `A referral that is ${STATUS_LABELS[from].toLowerCase()} cannot move to ` +
        `${STATUS_LABELS[input.to].toLowerCase()}. Available: ` +
        allowedTransitions(from).map((s) => STATUS_LABELS[s]).join(', ') + '.',
    )
  }

  const effect = transitionEffect(input.to)
  const data: Record<string, unknown> = { status: input.to, lastActivityAt: now }
  for (const field of Object.keys(effect.setOnce)) {
    if (referral[field as keyof typeof referral] === null) data[field] = now
  }
  for (const field of effect.clear) data[field] = null

  await ctx.db.referral.update({ where: { id: input.referralId }, data: data as never })
  await markTouched(ctx.db, input.referralId, now)

  await ctx.db.referralStatusHistory.create({
    data: {
      organizationId: ctx.actor.organizationId,
      referralId: input.referralId,
      fromStatus: from,
      toStatus: input.to,
      actorType: 'USER',
      changedByUserId: ctx.actor.userId,
      reason: input.reason ?? null,
    },
  })

  await recordActivity(ctx, input.referralId, 'STATUS_CHANGED', {
    note: input.reason ?? null,
    metadata: { from, to: input.to },
  })

  await recomputeTouchMetrics(ctx, input.referralId)

  ctx.audit({
    action: 'STATUS_CHANGE',
    resourceType: 'referral',
    resourceId: input.referralId,
    metadata: { from, to: input.to },
  })

  return { from, to: input.to }
}

export async function assignReferral(
  ctx: Ctx,
  input: { referralId: string; assignedUserId: string | null },
): Promise<void> {
  const now = ctx.now ?? new Date()
  const existing = await ctx.db.referral.findUnique({
    where: { id: input.referralId },
    select: { assignedUserId: true },
  })
  if (!existing) throw notFound('That referral no longer exists.')
  if (existing.assignedUserId === input.assignedUserId) return

  if (input.assignedUserId) {
    // Assignment must stay inside the organization. The extension would catch a
    // cross-tenant id, but a clear error beats a mysterious empty result.
    const member = await ctx.db.membership.findFirst({
      where: {
        userId: input.assignedUserId,
        organizationId: ctx.actor.organizationId,
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    if (!member) throw notFound('That user is not active in this organization.')
  }

  await ctx.db.referral.update({
    where: { id: input.referralId },
    data: { assignedUserId: input.assignedUserId, lastActivityAt: now },
  })
  await markTouched(ctx.db, input.referralId, now)
  await recordActivity(ctx, input.referralId, 'ASSIGNMENT_CHANGED', {
    metadata: { assigned: input.assignedUserId !== null },
  })
  ctx.audit({
    action: 'ASSIGNMENT_CHANGE',
    resourceType: 'referral',
    resourceId: input.referralId,
    metadata: { assignedUserId: input.assignedUserId },
  })
}

export async function addContactAttempt(
  ctx: Ctx,
  input: {
    referralId: string
    method: 'PHONE' | 'VOICEMAIL' | 'TEXT' | 'EMAIL' | 'MAIL' | 'IN_PERSON'
    outcome: 'REACHED' | 'LEFT_VOICEMAIL' | 'NO_ANSWER' | 'WRONG_NUMBER' | 'DECLINED' | 'CALLBACK_REQUESTED'
    note?: string | null
    nextAttemptAt?: Date | null
  },
): Promise<void> {
  const now = ctx.now ?? new Date()
  const referral = await ctx.db.referral.findUnique({
    where: { id: input.referralId },
    select: { id: true, patientId: true, status: true, firstContactedAt: true },
  })
  if (!referral) throw notFound('That referral no longer exists.')

  await ctx.db.contactAttempt.create({
    data: {
      organizationId: ctx.actor.organizationId,
      referralId: input.referralId,
      patientId: referral.patientId,
      userId: ctx.actor.userId,
      attemptedAt: now,
      method: input.method,
      outcome: input.outcome,
      note: input.note ?? null,
      nextAttemptAt: input.nextAttemptAt ?? null,
    },
  })

  if (input.outcome === 'REACHED' && referral.firstContactedAt === null) {
    await ctx.db.referral.update({
      where: { id: input.referralId },
      data: { firstContactedAt: now },
    })
  }

  await markTouched(ctx.db, input.referralId, now)
  await recordActivity(ctx, input.referralId, 'CONTACT_ATTEMPT', {
    note: input.note ?? null,
    metadata: { method: input.method, outcome: input.outcome },
  })
  await recomputeTouchMetrics(ctx, input.referralId)

  ctx.audit({
    action: 'RECORD_CREATE',
    resourceType: 'contact_attempt',
    resourceId: input.referralId,
    metadata: { method: input.method, outcome: input.outcome },
  })
}

export async function addNote(
  ctx: Ctx,
  input: { referralId: string; note: string },
): Promise<void> {
  const now = ctx.now ?? new Date()
  await markTouched(ctx.db, input.referralId, now)
  await recordActivity(ctx, input.referralId, 'NOTE_ADDED', { note: input.note })
  ctx.audit({
    action: 'RECORD_UPDATE',
    resourceType: 'referral',
    resourceId: input.referralId,
    metadata: { field: 'note' },
  })
}

/**
 * Recomputes the denormalized touch metrics. Reports read this table rather
 * than aggregating over referrals — reporting that slows down as a practice
 * succeeds is a product defect.
 */
export async function recomputeTouchMetrics(ctx: Ctx, referralId: string): Promise<void> {
  const referral = await ctx.db.referral.findUnique({
    where: { id: referralId },
    select: {
      receivedAt: true, firstTouchedAt: true, firstTriagedAt: true,
      firstContactedAt: true, readyToScheduleAt: true, scheduledAt: true, closedAt: true,
    },
  })
  if (!referral) return

  const settings = await ctx.db.organizationSettings.findUnique({
    where: { organizationId: ctx.actor.organizationId },
    select: { businessHours: true, holidayDates: true },
  })
  const organization = await ctx.db.organization.findUnique({
    where: { id: ctx.actor.organizationId },
    select: { timezone: true },
  })
  const calendar = buildCalendar({
    timezone: organization?.timezone ?? 'America/New_York',
    businessHours: settings?.businessHours,
    holidays: settings?.holidayDates ?? [],
  })

  const secs = (to: Date | null) =>
    to ? Math.max(0, Math.floor((to.getTime() - referral.receivedAt.getTime()) / 1000)) : null
  const businessSecs = (to: Date | null) =>
    to ? businessSecondsBetween(referral.receivedAt, to, calendar) : null

  const payload = {
    secondsToFirstTouch: secs(referral.firstTouchedAt),
    secondsToFirstTriage: secs(referral.firstTriagedAt),
    secondsToFirstContact: secs(referral.firstContactedAt),
    secondsToReadyToSchedule: secs(referral.readyToScheduleAt),
    secondsToScheduled: secs(referral.scheduledAt),
    secondsTotalLifecycle: secs(referral.closedAt ?? referral.scheduledAt),
    businessSecondsToFirstTouch: businessSecs(referral.firstTouchedAt),
    businessSecondsToScheduled: businessSecs(referral.scheduledAt),
    computedAt: ctx.now ?? new Date(),
  }

  await ctx.db.referralTouchMetrics.upsert({
    where: { referralId },
    create: { organizationId: ctx.actor.organizationId, referralId, ...payload },
    update: payload,
  })
}
