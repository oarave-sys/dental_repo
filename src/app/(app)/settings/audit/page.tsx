import { withAuthorizedQuery } from '@/lib/actions/guard'
import { DataTable, EmptyState, formatDateTime } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * Administrator-only. Note what this table shows and what it does not: which
 * field changed, never the value. The audit trail must not become a second,
 * less-protected copy of the record.
 */
export default async function AuditPage() {
  const rows = await withAuthorizedQuery('audit:read', ({ db }) =>
    db.auditLog.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    }),
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Audit log</h1>
        <p className="text-sm text-ink-3">
          Append-only. Records which record was touched and which fields changed — never the values.
        </p>
      </div>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No audit events yet." />
        ) : (
          <DataTable head={['When', 'User', 'Action', 'Resource', 'Detail']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">
                  {formatDateTime(r.occurredAt)}
                </td>
                <td className="px-3 py-2 text-ink-2">
                  {r.user?.name ?? <span className="text-ink-3">System</span>}
                </td>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs text-ink">{r.action}</span>
                </td>
                <td className="px-3 py-2 text-xs text-ink-2">
                  {r.resourceType}
                  {r.resourceId && (
                    <span className="ml-1 font-mono text-ink-3">{r.resourceId.slice(0, 8)}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-ink-3">
                  {r.metadata ? JSON.stringify(r.metadata) : '—'}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  )
}
