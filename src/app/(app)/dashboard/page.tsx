import Link from 'next/link'
import type { Metadata } from 'next'
import { requireActor } from '@/lib/auth/current'
import { TOOLS } from '@/lib/tools/registry'
import { listSavedCases, recentQueries } from '@/lib/coding/queries'
import { codeRepository, usingDemoFallback } from '@/lib/codes'
import { Badge, Card, DatasetNotice, EmptyState, SectionTitle, ToolIcon } from '@/components/ui'
import { toolName } from '@/lib/tools/registry'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const actor = await requireActor()

  // The dashboard must render even before a database exists, so the two
  // list queries degrade to empty rather than throwing.
  const [recent, cases, dataset] = await Promise.all([
    recentQueries(actor.organizationId, { limit: 6 }).catch(() => []),
    listSavedCases(actor.organizationId, 5).catch(() => []),
    codeRepository().info().catch(() => null),
  ])

  const firstName = actor.name.split(' ')[0] ?? actor.name

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Good to see you, {firstName}.
        </h1>
        <p className="mt-1 text-[15px] text-ink-2">
          Tell us what you did. We will help you identify the appropriate code, check the
          documentation, and catch potential problems before the claim goes out.
        </p>
      </div>

      {dataset && <DatasetNotice dataset={dataset} />}

      {usingDemoFallback() && (
        <div className="rounded-lg border border-medium-border bg-medium-bg px-3.5 py-3">
          <p className="text-[13px] leading-relaxed text-medium">
            <span className="font-semibold">No database connected.</span> The coding tools work,
            but searches and saved cases will not persist. Set <code>DATABASE_URL</code> to
            enable them.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TOOLS.map((tool) => (
          <ToolCard key={tool.key} tool={tool} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <SectionTitle>Recent searches</SectionTitle>
            {recent.length > 0 && (
              <Link href="/history" className="text-sm text-brand hover:underline">
                View all
              </Link>
            )}
          </div>

          {recent.length === 0 ? (
            <EmptyState
              title="No searches yet"
              description="Your practice's recent code searches will appear here."
              action={
                <Link href="/find-a-code" className="btn-primary">
                  Find a code
                </Link>
              }
            />
          ) : (
            <Card>
              <ul className="divide-y divide-rule">
                {recent.map((query) => (
                  <li key={query.id}>
                    <Link
                      href={`/history/${query.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/60"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {query.displayLabel ?? 'Search'}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-3">
                          {toolName(query.tool)} · {query.userName} ·{' '}
                          {query.createdAt.toLocaleDateString()}
                        </p>
                      </div>
                      {query.status === 'NEEDS_INPUT' ? (
                        <Badge tone="medium">Needs a detail</Badge>
                      ) : query.primaryCode ? (
                        <span className="code-number shrink-0 text-sm text-ink">
                          {query.primaryCode}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <SectionTitle>Saved cases</SectionTitle>
            {cases.length > 0 && (
              <Link href="/cases" className="text-sm text-brand hover:underline">
                View all
              </Link>
            )}
          </div>

          {cases.length === 0 ? (
            <EmptyState
              title="No saved cases"
              description="Save a result to keep it for reference, training, or a second opinion later."
            />
          ) : (
            <Card>
              <ul className="divide-y divide-rule">
                {cases.map((saved) => (
                  <li key={saved.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{saved.title}</p>
                        <p className="mt-0.5 text-xs text-ink-3">
                          {saved.user.name} · {saved.createdAt.toLocaleDateString()}
                        </p>
                      </div>
                      {saved.codes.length > 0 && (
                        <span className="code-number shrink-0 text-sm text-ink">
                          {saved.codes.join(', ')}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}

function ToolCard({ tool }: { tool: (typeof TOOLS)[number] }) {
  const planned = tool.status === 'PLANNED'

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            planned ? 'bg-surface-2 text-ink-3' : 'bg-brand-soft text-brand'
          }`}
        >
          <ToolIcon name={tool.icon} />
        </span>
        {planned && <Badge>Coming soon</Badge>}
      </div>
      <h2 className="mt-3 text-[15px] font-semibold text-ink">{tool.name}</h2>
      <p className="mt-0.5 text-sm font-medium text-ink-2">{tool.tagline}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-3">{tool.description}</p>
    </>
  )

  if (planned) {
    return (
      <div className="card p-5 opacity-70" aria-disabled>
        {inner}
      </div>
    )
  }

  return (
    <Link
      href={tool.href}
      className="card p-5 transition-shadow hover:shadow-lift focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring"
    >
      {inner}
    </Link>
  )
}
