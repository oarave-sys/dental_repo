import Link from 'next/link'
import { withAuthorizedQuery } from '@/lib/actions/guard'
import { exceptionCards, dashboardMetrics } from '@/lib/services/dashboard'
import { Card, cn, formatDuration } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * The exception dashboard answers one question: what needs attention right now?
 * Every card is a count plus the filter that produced it, so clicking one lands
 * on exactly the rows it counted.
 */
export default async function DashboardPage() {
  const now = new Date()
  const { cards, metrics, name } = await withAuthorizedQuery('referral:read', async ({ db, actor }) => {
    const [cards, metrics, org] = await Promise.all([
      exceptionCards(db, now),
      dashboardMetrics(db, now),
      db.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
    ])
    return { cards, metrics, name: org?.name ?? '' }
  })

  const tone = {
    neutral: 'border-rule',
    warn: 'border-amber/40 bg-amber-bg/40',
    urgent: 'border-red/40 bg-red-bg/40',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">What needs attention</h1>
        <p className="text-sm text-ink-3">{name}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={`/referrals${card.href}`}
            className={cn(
              'card block px-4 py-3 transition-colors hover:border-brand',
              tone[card.tone],
              card.count === 0 && 'opacity-60',
            )}
          >
            <div className="tnum text-2xl font-semibold text-ink">{card.count}</div>
            <div className="mt-0.5 text-xs text-ink-2">{card.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Today and this month">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Metric label="Referrals today" value={metrics.referralsToday} />
            <Metric label="Referrals this month" value={metrics.referralsThisMonth} />
            <Metric label="Scheduled today" value={metrics.scheduledToday} />
            <Metric label="Open referrals" value={metrics.openTotal} />
          </dl>
        </Card>

        <Card title="Processing">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Metric
              label="Median time to first touch"
              value={metrics.medianTouchMinutes === null
                ? '—'
                : formatDuration(metrics.medianTouchMinutes * 60)}
            />
            <Metric
              label="Average open age"
              value={metrics.averageOpenAgeDays === null ? '—' : `${metrics.averageOpenAgeDays}d`}
            />
            <Metric
              label="Oldest open referral"
              value={metrics.oldestOpenDays === null ? '—' : `${metrics.oldestOpenDays}d`}
            />
          </dl>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tnum mt-0.5 text-lg font-semibold text-ink">{value}</dd>
    </div>
  )
}
