import type { TenantDb } from '@/lib/db/client'
import { countWhere, oldestOpenReferral } from '@/lib/repositories/referrals'
import { OPEN_STATUSES } from '@/lib/domain/referral-status'
import { buildCalendar, calendarDaysBetween, type BusinessCalendar } from '@/lib/domain/business-time'

/**
 * The exception dashboard (brief §39): "what needs attention right now?"
 *
 * Every card is a count plus the filter that produced it, so clicking one lands
 * on exactly the rows it counted. A number a coordinator cannot open is a number
 * they will not trust.
 */
export interface ExceptionCard {
  key: string
  label: string
  count: number
  /** Query string for /referrals that reproduces this exact set. */
  href: string
  tone: 'neutral' | 'warn' | 'urgent'
}

const DAY = 86_400_000

export async function loadCalendar(db: TenantDb, organizationId: string): Promise<BusinessCalendar> {
  const [org, settings] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.organizationSettings.findUnique({
      where: { organizationId },
      select: { businessHours: true, holidayDates: true },
    }),
  ])
  return buildCalendar({
    timezone: org?.timezone ?? 'America/New_York',
    businessHours: settings?.businessHours,
    holidays: settings?.holidayDates ?? [],
  })
}

export async function exceptionCards(db: TenantDb, now: Date): Promise<ExceptionCard[]> {
  const open = { status: { in: [...OPEN_STATUSES] } }

  const [
    newReferrals,
    needsReview,
    missingInfo,
    waitingOnOffice,
    waitingOverThree,
    needingContact,
    untouched,
    olderThanSeven,
  ] = await Promise.all([
    countWhere(db, { status: 'NEW' }),
    countWhere(db, { status: { in: ['NEW', 'UNDER_REVIEW'] }, firstTriagedAt: null }),
    countWhere(db, { status: 'MISSING_INFORMATION' }),
    countWhere(db, { status: 'WAITING_ON_REFERRING_OFFICE' }),
    countWhere(db, {
      status: 'WAITING_ON_REFERRING_OFFICE',
      lastActivityAt: { lte: new Date(now.getTime() - 3 * DAY) },
    }),
    countWhere(db, { status: { in: ['READY_TO_CONTACT', 'PATIENT_CONTACTED'] } }),
    countWhere(db, { ...open, firstTouchedAt: null }),
    countWhere(db, { ...open, receivedAt: { lte: new Date(now.getTime() - 7 * DAY) } }),
  ])

  return [
    { key: 'new', label: 'New referrals', count: newReferrals, href: '?status=NEW', tone: 'neutral' },
    { key: 'review', label: 'Needs initial review', count: needsReview, href: '?untouched=1&open=1', tone: 'warn' },
    { key: 'missing', label: 'Missing information', count: missingInfo, href: '?status=MISSING_INFORMATION', tone: 'warn' },
    { key: 'waiting', label: 'Waiting on referring office', count: waitingOnOffice, href: '?status=WAITING_ON_REFERRING_OFFICE', tone: 'neutral' },
    { key: 'waiting3', label: 'Waiting more than 3 days', count: waitingOverThree, href: '?status=WAITING_ON_REFERRING_OFFICE&stale=3', tone: 'urgent' },
    { key: 'contact', label: 'Patients needing contact', count: needingContact, href: '?status=READY_TO_CONTACT&status=PATIENT_CONTACTED', tone: 'warn' },
    { key: 'untouched', label: 'Never touched', count: untouched, href: '?untouched=1&open=1', tone: 'urgent' },
    { key: 'stale7', label: 'Open more than 7 days', count: olderThanSeven, href: '?open=1&age=7', tone: 'urgent' },
  ]
}

export interface DashboardMetrics {
  referralsToday: number
  referralsThisMonth: number
  scheduledToday: number
  openTotal: number
  medianTouchMinutes: number | null
  oldestOpenDays: number | null
  averageOpenAgeDays: number | null
}

export async function dashboardMetrics(db: TenantDb, now: Date): Promise<DashboardMetrics> {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [referralsToday, referralsThisMonth, scheduledToday, openTotal, oldest, touchRows, openRows] =
    await Promise.all([
      countWhere(db, { receivedAt: { gte: startOfDay } }),
      countWhere(db, { receivedAt: { gte: startOfMonth } }),
      countWhere(db, { scheduledAt: { gte: startOfDay } }),
      countWhere(db, { status: { in: [...OPEN_STATUSES] } }),
      oldestOpenReferral(db),
      db.referralTouchMetrics.findMany({
        where: { secondsToFirstTouch: { not: null } },
        select: { secondsToFirstTouch: true },
        take: 5000,
      }),
      db.referral.findMany({
        where: { deletedAt: null, status: { in: [...OPEN_STATUSES] } },
        select: { receivedAt: true },
        take: 5000,
      }),
    ])

  const touches = touchRows
    .map((r) => r.secondsToFirstTouch)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)
  const median =
    touches.length === 0
      ? null
      : Math.round(
          (touches.length % 2
            ? touches[(touches.length - 1) / 2]!
            : (touches[touches.length / 2 - 1]! + touches[touches.length / 2]!) / 2) / 60,
        )

  const averageOpenAgeDays =
    openRows.length === 0
      ? null
      : Math.round(
          openRows.reduce((sum, r) => sum + calendarDaysBetween(r.receivedAt, now), 0) /
            openRows.length,
        )

  return {
    referralsToday,
    referralsThisMonth,
    scheduledToday,
    openTotal,
    medianTouchMinutes: median,
    oldestOpenDays: oldest ? calendarDaysBetween(oldest.receivedAt, now) : null,
    averageOpenAgeDays,
  }
}
