import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentSession } from '@/lib/auth/current'
import { platformMetrics } from '@/lib/admin/metrics'
import { logger } from '@/lib/logging/logger'
import { formatCost } from '@/lib/usage'
import { toolName } from '@/lib/tools/registry'
import type { Tool } from '@/lib/usage'
import { Badge, Card, PageHeader, SectionTitle } from '@/components/ui'
import { signOutAction } from '../(auth)/actions'

export const metadata: Metadata = { title: 'Admin' }
export const dynamic = 'force-dynamic'

/**
 * The internal admin area.
 *
 * Gated on the platform-admin flag, which has no UI that can grant it — it is
 * set directly on the user record. Everything shown is aggregate or
 * account-level; no clinical content from any practice is reachable here.
 */
export default async function AdminPage() {
  const session = await currentSession()
  if (!session) redirect('/sign-in')
  if (!session.actor.isPlatformAdmin) redirect('/dashboard')

  const metrics = await platformMetrics().catch((error) => {
    // Without a database the admin area has nothing to show; that is a
    // configuration state, not a crash. Anything else is worth seeing.
    logger.error('admin.metrics_failed', { message: String(error).slice(0, 300) })
    return null
  })

  if (!metrics) {
    return (
      <AdminShell>
        <Card className="p-5">
          <p className="text-[15px] text-ink-2">
            Metrics are unavailable. A database connection is required for the admin area.
          </p>
        </Card>
      </AdminShell>
    )
  }

  return (
    <AdminShell>
      <PageHeader
        title="Platform admin"
        description="Aggregate activity across all practices. No practice's clinical content is shown here."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Practices" value={metrics.organizationCount} />
        <Stat label="Users" value={metrics.userCount} />
        <Stat label="Active subscriptions" value={metrics.activeSubscriptions} />
        <Stat label="Trial accounts" value={metrics.trialAccounts} />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Searches (30d)" value={metrics.queriesLast30Days} />
        <Stat label="Active users (30d)" value={metrics.activeUsersLast30Days} />
        <Stat label="AI requests (30d)" value={metrics.aiRequestsLast30Days} />
        <Stat
          label="Estimated AI cost (30d)"
          value={formatCost(metrics.aiCostMillicentsLast30Days)}
          note={
            metrics.aiRequestsLast30Days > 0
              ? `${(metrics.aiErrorRate * 100).toFixed(1)}% error rate`
              : 'no requests'
          }
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SectionTitle>Most-used features (30d)</SectionTitle>
          <Card className="mt-3 p-5">
            {metrics.featureUsage.length === 0 ? (
              <p className="text-sm text-ink-3">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {metrics.featureUsage.map((feature) => {
                  const top = metrics.featureUsage[0]?.count ?? 1
                  const pct = Math.round((feature.count / top) * 100)
                  return (
                    <li key={feature.tool}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-ink-2">{toolName(feature.tool as Tool)}</span>
                        <span className="code-number text-ink">{feature.count}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2">
          <SectionTitle>Practices</SectionTitle>
          <Card className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs uppercase tracking-wider text-ink-3">
                  <th className="px-4 py-2.5 font-semibold">Practice</th>
                  <th className="px-4 py-2.5 font-semibold">Plan</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Users</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Searches 30d</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {metrics.organizations.map((org) => (
                  <tr key={org.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{org.name}</p>
                      <p className="text-xs text-ink-3">
                        joined {org.createdAt.toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={org.subscriptionStatus === 'ACTIVE' ? 'high' : 'medium'}>
                        {org.subscriptionStatus ?? 'none'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-2">{org.memberCount}</td>
                    <td className="px-4 py-2.5 text-right tnum text-ink-2">
                      {org.queriesLast30Days}
                    </td>
                    <td className="px-4 py-2.5 text-right text-ink-3">
                      {org.lastActivityAt ? org.lastActivityAt.toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </AdminShell>
  )
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-rule bg-white">
        <div className="mx-auto flex max-w-content items-center gap-3 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-xs font-semibold text-white">
            DC
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Platform admin
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/dashboard" className="btn-ghost btn-sm">
              Back to app
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="btn-ghost btn-sm">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-content flex-1 px-4 py-8">{children}</main>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string | number
  note?: string
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink tnum">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-3">{note}</p>}
    </Card>
  )
}
