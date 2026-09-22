import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/current'
import { can } from '@/lib/authz'
import { AUDIT_LABELS, listAuditEvents } from '@/lib/audit'
import { BackLink, Badge, Card, EmptyState, PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

/**
 * The practice's own audit log.
 *
 * Scoped to the signed-in organization like everything else — this is the
 * practice seeing its own record, not a platform view. Entries carry no
 * clinical text; where one refers to clinical content it links to it, and
 * opening that link is itself recorded.
 */
export default async function AuditPage() {
  const actor = await requireActor()
  // Reading who looked at what is an administrative capability.
  if (!can(actor, 'org:manage')) notFound()

  const entries = await listAuditEvents(actor.organizationId, { limit: 200 }).catch(() => [])

  return (
    <div>
      <div className="mb-4">
        <BackLink href="/settings">Back to settings</BackLink>
      </div>

      <PageHeader
        title="Audit log"
        description="Who accessed what, and when. Entries cannot be edited or deleted — the database refuses both."
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No entries yet"
          description="Access to searches and changes to your team will be recorded here."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs uppercase tracking-wider text-ink-3">
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 font-semibold">Who</th>
                <th className="px-4 py-2.5 font-semibold">Action</th>
                <th className="px-4 py-2.5 font-semibold">Subject</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-3 tnum">
                    {entry.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{entry.actorName}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={toneFor(entry.action)}>{AUDIT_LABELS[entry.action]}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-3">
                    {entry.subjectType}
                    {entry.subjectId && (
                      <span className="ml-1.5 font-mono text-xs">
                        {entry.subjectId.slice(0, 8)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
        The log records access, not content: no clinical text is stored in an entry. Retention
        is currently unbounded — set a retention period before this product handles protected
        health information.
      </p>
    </div>
  )
}

function toneFor(action: string): 'neutral' | 'low' | 'medium' | 'info' {
  if (action.includes('DELETED') || action.includes('REMOVED')) return 'low'
  if (action.includes('VIEWED')) return 'info'
  if (action.includes('MEMBER') || action.includes('SETTINGS')) return 'medium'
  return 'neutral'
}
