import Link from 'next/link'
import type { Metadata } from 'next'
import { requireActor } from '@/lib/auth/current'
import { can } from '@/lib/authz'
import { recentQueries } from '@/lib/coding/queries'
import { toolName } from '@/lib/tools/registry'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'History' }
export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  const actor = await requireActor()

  // Members see their own searches; admins and owners see the practice's.
  const seesAll = can(actor, 'history:read_all')
  const queries = await recentQueries(actor.organizationId, {
    limit: 100,
    ...(seesAll ? {} : { userId: actor.userId }),
  }).catch(() => [])

  return (
    <div>
      <PageHeader
        title="History"
        description={
          seesAll
            ? "Recent searches across your practice."
            : 'Your recent searches.'
        }
      />

      {queries.length === 0 ? (
        <EmptyState
          title="No searches yet"
          description="Searches you run will be listed here."
          action={
            <Link href="/find-a-code" className="btn-primary">
              Find a code
            </Link>
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-rule">
            {queries.map((query) => (
              <li key={query.id}>
                <Link
                  href={`/history/${query.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-surface-2/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {query.displayLabel ?? 'Search'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {toolName(query.tool)} · {query.userName} ·{' '}
                      {query.createdAt.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {query.status === 'NEEDS_INPUT' && <Badge tone="medium">Needs a detail</Badge>}
                    {query.primaryCode && (
                      <span className="code-number text-sm text-ink">{query.primaryCode}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
