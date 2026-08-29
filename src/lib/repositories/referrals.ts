import type { Prisma } from '@/generated/prisma/client'
import type { TenantDb } from '@/lib/db/client'
import { OPEN_STATUSES, type ReferralStatus } from '@/lib/domain/referral-status'

/**
 * All referral queries. Tenancy is applied by the client extension and by
 * row-level security — no method here builds its own organizationId filter,
 * because a filter someone can forget is not a control.
 */

export interface ReferralFilters {
  status?: ReferralStatus[]
  assignedUserId?: string | 'UNASSIGNED'
  referringOrganizationId?: string
  payerId?: string
  /** Referrals with no activity for at least this many days. */
  staleDays?: number
  openOnly?: boolean
  untouched?: boolean
  search?: string
}

export type ReferralSort =
  | 'NEWEST'
  | 'OLDEST'
  | 'LONGEST_WITHOUT_ACTIVITY'
  | 'REFERRING_OFFICE'

export function buildWhere(filters: ReferralFilters, now: Date): Prisma.ReferralWhereInput {
  const where: Prisma.ReferralWhereInput = { deletedAt: null }

  if (filters.status?.length) where.status = { in: filters.status }
  else if (filters.openOnly) where.status = { in: [...OPEN_STATUSES] }

  if (filters.assignedUserId === 'UNASSIGNED') where.assignedUserId = null
  else if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId

  if (filters.referringOrganizationId) {
    where.referringOrganizationId = filters.referringOrganizationId
  }
  if (filters.payerId) where.payerId = filters.payerId
  if (filters.untouched) where.firstTouchedAt = null

  if (filters.staleDays !== undefined) {
    where.lastActivityAt = { lte: new Date(now.getTime() - filters.staleDays * 86_400_000) }
  }

  if (filters.search?.trim()) {
    const term = filters.search.trim()
    // Search reaches patient identifiers, so it is gated on patient:read at the
    // action layer and is audited as a PATIENT_SEARCH.
    where.patient = {
      OR: [
        { lastName: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
      ],
    }
  }
  return where
}

function orderBy(sort: ReferralSort): Prisma.ReferralOrderByWithRelationInput[] {
  switch (sort) {
    case 'OLDEST': return [{ receivedAt: 'asc' }]
    case 'LONGEST_WITHOUT_ACTIVITY': return [{ lastActivityAt: 'asc' }]
    case 'REFERRING_OFFICE': return [{ referringOrganization: { name: 'asc' } }, { receivedAt: 'desc' }]
    default: return [{ receivedAt: 'desc' }]
  }
}

const LIST_SELECT = {
  id: true,
  status: true,
  priority: true,
  receivedAt: true,
  lastActivityAt: true,
  firstTouchedAt: true,
  referralDiagnosisText: true,
  patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
  referringOrganization: { select: { id: true, name: true } },
  payer: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, name: true } },
} satisfies Prisma.ReferralSelect

export type ReferralListRow = Prisma.ReferralGetPayload<{ select: typeof LIST_SELECT }>

export async function listReferrals(
  db: TenantDb,
  params: { filters: ReferralFilters; sort: ReferralSort; take: number; skip: number; now: Date },
): Promise<{ rows: ReferralListRow[]; total: number }> {
  const where = buildWhere(params.filters, params.now)
  const [rows, total] = await Promise.all([
    db.referral.findMany({
      where,
      select: LIST_SELECT,
      orderBy: orderBy(params.sort),
      take: params.take,
      skip: params.skip,
    }),
    db.referral.count({ where }),
  ])
  return { rows, total }
}

export function getReferralDetail(db: TenantDb, id: string) {
  return db.referral.findUnique({
    where: { id },
    include: {
      patient: { include: { ehrLink: true } },
      referringOrganization: true,
      referringProvider: true,
      payer: true,
      assignedUser: { select: { id: true, name: true, email: true } },
      documents: {
        select: { id: true, documentType: true, pageCount: true, processingStatus: true, uploadedAt: true },
        orderBy: { uploadedAt: 'desc' },
      },
      contactAttempts: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { attemptedAt: 'desc' },
      },
      activities: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      },
      statusHistory: { orderBy: { changedAt: 'desc' }, take: 50 },
      touchMetrics: true,
    },
  })
}

export type ReferralDetail = NonNullable<Awaited<ReturnType<typeof getReferralDetail>>>

export function countByStatus(db: TenantDb) {
  return db.referral.groupBy({
    by: ['status'],
    where: { deletedAt: null },
    _count: { _all: true },
  })
}

export async function countWhere(db: TenantDb, where: Prisma.ReferralWhereInput): Promise<number> {
  return db.referral.count({ where: { ...where, deletedAt: null } })
}

export function oldestOpenReferral(db: TenantDb) {
  return db.referral.findFirst({
    where: { deletedAt: null, status: { in: [...OPEN_STATUSES] } },
    orderBy: { receivedAt: 'asc' },
    select: { id: true, receivedAt: true },
  })
}
