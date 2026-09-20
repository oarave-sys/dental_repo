import Link from 'next/link'
import type { Metadata } from 'next'
import { requireActor } from '@/lib/auth/current'
import { can } from '@/lib/authz'
import { listSavedCases } from '@/lib/coding/queries'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { DeleteCaseButton } from './delete-button'

export const metadata: Metadata = { title: 'Saved cases' }
export const dynamic = 'force-dynamic'

export default async function CasesPage() {
  const actor = await requireActor()
  const cases = await listSavedCases(actor.organizationId, 100).catch(() => [])
  const mayDelete = can(actor, 'case:delete')

  return (
    <div>
      <PageHeader
        title="Saved cases"
        description="Results your practice has kept for reference or training."
      />

      {cases.length === 0 ? (
        <EmptyState
          title="No saved cases"
          description="When a result is worth keeping — an unusual procedure, a coding decision you want to be consistent about — save it here."
          action={
            <Link href="/find-a-code" className="btn-primary">
              Find a code
            </Link>
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-rule">
            {cases.map((saved) => (
              <li key={saved.id} className="flex items-start justify-between gap-4 px-4 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="font-medium text-ink">{saved.title}</p>
                    {saved.codes.length > 0 && (
                      <span className="code-number text-sm text-brand">
                        {saved.codes.join(', ')}
                      </span>
                    )}
                  </div>
                  {saved.notes && (
                    <p className="mt-1 text-sm leading-relaxed text-ink-2">{saved.notes}</p>
                  )}
                  <p className="mt-1.5 text-xs text-ink-3">
                    {saved.user.name} · {saved.createdAt.toLocaleDateString()}
                    {saved.queryId && (
                      <>
                        {' · '}
                        <Link
                          href={`/history/${saved.queryId}`}
                          className="text-brand hover:underline"
                        >
                          View the analysis
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {mayDelete && <DeleteCaseButton caseId={saved.id} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
