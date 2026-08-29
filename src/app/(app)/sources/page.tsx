import { withAuthorizedQuery } from '@/lib/actions/guard'
import { DataTable, EmptyState, formatDate } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * Referring offices. Reachable by MARKETING, so this page shows counts and
 * dates only — no patient reaches it, by construction rather than by hiding.
 */
export default async function SourcesPage() {
  const offices = await withAuthorizedQuery('source:read', ({ db }) =>
    db.referringOrganization.findMany({
      where: { deletedAt: null },
      select: {
        id: true, name: true, city: true, state: true, phone: true, fax: true,
        isActive: true, lastReferralAt: true,
        _count: { select: { referrals: true, providers: true } },
      },
      orderBy: { name: 'asc' },
    }),
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Referring offices</h1>
        <p className="text-sm text-ink-3">
          Referral volume by source. Outreach tracking and attribution arrive in Phase 7.
        </p>
      </div>

      <div className="card overflow-hidden">
        {offices.length === 0 ? (
          <EmptyState title="No referring offices yet." />
        ) : (
          <DataTable head={['Office', 'Location', 'Phone', 'Fax', 'Providers', 'Referrals', 'Last referral']}>
            {offices.map((o) => (
              <tr key={o.id} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-medium text-ink">
                  {o.name}
                  {!o.isActive && <span className="ml-2 text-xs text-ink-3">inactive</span>}
                </td>
                <td className="px-3 py-2 text-ink-2">
                  {[o.city, o.state].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="tnum px-3 py-2 text-ink-2">{o.phone ?? '—'}</td>
                <td className="tnum px-3 py-2 text-ink-2">{o.fax ?? '—'}</td>
                <td className="tnum px-3 py-2 text-ink-2">{o._count.providers}</td>
                <td className="tnum px-3 py-2 text-ink-2">{o._count.referrals}</td>
                <td className="px-3 py-2 text-ink-2">{formatDate(o.lastReferralAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  )
}
