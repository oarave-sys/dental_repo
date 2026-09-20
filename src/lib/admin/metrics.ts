import { unsafeCrossTenantClient } from '@/lib/db/client'

/**
 * Platform metrics for the internal admin area.
 *
 * Reads across every tenant, which is exactly why it is confined to this file
 * and gated on `isPlatformAdmin`. Every query here is an AGGREGATE or a
 * non-clinical field: counts, sums, enum values, timestamps. Nothing selects
 * inputText, note content, a result payload or a saved case's notes, so one
 * practice's clinical content cannot surface here — not by accident, and not
 * through a careless future addition, because the shapes returned below have
 * nowhere to put it.
 */

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  createdAt: Date
  memberCount: number
  status: string
  subscriptionStatus: string | null
  trialEndsAt: Date | null
  queriesLast30Days: number
  lastActivityAt: Date | null
}

export interface FeatureUsage {
  tool: string
  count: number
}

export interface PlatformMetrics {
  organizationCount: number
  userCount: number
  activeSubscriptions: number
  trialAccounts: number
  queriesLast30Days: number
  activeUsersLast30Days: number
  aiRequestsLast30Days: number
  aiCostMillicentsLast30Days: number
  aiErrorRate: number
  featureUsage: FeatureUsage[]
  organizations: OrganizationSummary[]
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export async function platformMetrics(): Promise<PlatformMetrics> {
  const db = unsafeCrossTenantClient()
  const since = new Date(Date.now() - THIRTY_DAYS_MS)

  const [
    organizationCount,
    userCount,
    activeSubscriptions,
    trialAccounts,
    queriesLast30Days,
    aiAggregate,
    aiFailures,
    aiRequestsLast30Days,
    featureGroups,
    activeUserRows,
    organizations,
    activityRows,
  ] = await Promise.all([
    db.organization.count(),
    db.user.count(),
    db.subscription.count({ where: { status: 'ACTIVE' } }),
    db.subscription.count({ where: { status: 'TRIALING' } }),
    db.codingQuery.count({ where: { createdAt: { gte: since } } }),
    db.aiRequest.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { costMillicents: true },
    }),
    db.aiRequest.count({ where: { createdAt: { gte: since }, success: false } }),
    db.aiRequest.count({ where: { createdAt: { gte: since } } }),
    db.codingQuery.groupBy({
      by: ['tool'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.codingQuery.findMany({
      where: { createdAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    db.organization.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        status: true,
        subscription: { select: { status: true, trialEndsAt: true } },
        _count: { select: { memberships: true } },
      },
    }),
    // Per-organization activity, counted rather than joined so no clinical
    // column is ever in a select list.
    db.codingQuery.groupBy({
      by: ['organizationId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ])

  const activityByOrg = new Map(
    activityRows.map((r) => [
      r.organizationId,
      { count: r._count._all, last: r._max.createdAt },
    ]),
  )

  return {
    organizationCount,
    userCount,
    activeSubscriptions,
    trialAccounts,
    queriesLast30Days,
    activeUsersLast30Days: activeUserRows.length,
    aiRequestsLast30Days,
    aiCostMillicentsLast30Days: aiAggregate._sum.costMillicents ?? 0,
    aiErrorRate: aiRequestsLast30Days === 0 ? 0 : aiFailures / aiRequestsLast30Days,
    featureUsage: featureGroups
      .map((g) => ({ tool: String(g.tool), count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    organizations: organizations.map((org) => {
      const activity = activityByOrg.get(org.id)
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        createdAt: org.createdAt,
        status: org.status,
        memberCount: org._count.memberships,
        subscriptionStatus: org.subscription?.status ?? null,
        trialEndsAt: org.subscription?.trialEndsAt ?? null,
        queriesLast30Days: activity?.count ?? 0,
        lastActivityAt: activity?.last ?? null,
      }
    }),
  }
}
