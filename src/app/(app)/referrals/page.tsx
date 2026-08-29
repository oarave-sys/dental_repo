import Link from 'next/link'
import { withAuthorizedQuery } from '@/lib/actions/guard'
import { listReferrals, type ReferralFilters, type ReferralSort } from '@/lib/repositories/referrals'
import { REFERRAL_STATUSES, STATUS_LABELS, nextAction, type ReferralStatus } from '@/lib/domain/referral-status'
import { calendarDaysBetween } from '@/lib/domain/business-time'
import { writeAudit } from '@/lib/audit'
import { AgeChip, DataTable, EmptyState, StatusBadge, formatDate } from '@/components/ui'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type Search = Record<string, string | string[] | undefined>

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

function parseFilters(params: Search): { filters: ReferralFilters; sort: ReferralSort; page: number } {
  const statuses = asArray(params.status).filter((s): s is ReferralStatus =>
    (REFERRAL_STATUSES as readonly string[]).includes(s),
  )
  const filters: ReferralFilters = {
    ...(statuses.length ? { status: statuses } : {}),
    ...(params.open === '1' ? { openOnly: true } : {}),
    ...(params.untouched === '1' ? { untouched: true } : {}),
    ...(params.stale ? { staleDays: Number(params.stale) } : {}),
    ...(typeof params.assigned === 'string' ? { assignedUserId: params.assigned } : {}),
    ...(typeof params.q === 'string' && params.q.trim() ? { search: params.q.trim() } : {}),
  }
  const sort = (typeof params.sort === 'string' ? params.sort : 'NEWEST') as ReferralSort
  return { filters, sort, page: Math.max(1, Number(params.page ?? 1)) }
}

export default async function ReferralInbox({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const params = await searchParams
  const { filters, sort, page } = parseFilters(params)
  const now = new Date()

  const { rows, total } = await withAuthorizedQuery('referral:read', async ({ db, actor }) => {
    const result = await listReferrals(db, {
      filters, sort, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE, now,
    })
    // Listing referrals is access to PHI, and is audited as such. A search term
    // is recorded as a boolean — the term itself can name a patient.
    await writeAudit(db, actor, {
      action: filters.search ? 'PATIENT_SEARCH' : 'REFERRAL_LIST',
      resourceType: 'referral',
      metadata: { returned: result.rows.length, filtered: Object.keys(filters).length > 0 },
    })
    return result
  })

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Referrals</h1>
          <p className="tnum text-sm text-ink-3">
            {total} {total === 1 ? 'referral' : 'referrals'}
            {Object.keys(filters).length > 0 && ' matching these filters'}
          </p>
        </div>
        <Link href="/referrals/new" className="btn-primary">Add referral</Link>
      </div>

      <form className="card flex flex-wrap items-end gap-3 px-4 py-3" method="get">
        <label className="min-w-[200px] flex-1">
          <span className="label">Search patient</span>
          <input
            name="q"
            defaultValue={typeof params.q === 'string' ? params.q : ''}
            placeholder="Surname or first name"
            className="field"
          />
        </label>
        <label>
          <span className="label">Status</span>
          <select name="status" defaultValue={filters.status?.[0] ?? ''} className="field">
            <option value="">Any status</option>
            {REFERRAL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Sort</span>
          <select name="sort" defaultValue={sort} className="field">
            <option value="NEWEST">Newest first</option>
            <option value="OLDEST">Oldest first</option>
            <option value="LONGEST_WITHOUT_ACTIVITY">Longest without activity</option>
            <option value="REFERRING_OFFICE">Referring office</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-2">
          <input type="checkbox" name="untouched" value="1" defaultChecked={params.untouched === '1'} />
          Never touched
        </label>
        <button type="submit" className="btn-secondary">Apply</button>
        <Link href="/referrals" className="btn-ghost">Clear</Link>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title="No referrals match these filters."
            hint="Clear the filters to see the full inbox."
          />
        ) : (
          <DataTable head={['Patient', 'Status', 'Age', 'Referring office', 'Payer', 'Owner', 'Next action']}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface-2">
                <td className="px-3 py-2">
                  <Link href={`/referrals/${r.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {r.patient.lastName}, {r.patient.firstName}
                  </Link>
                  <div className="text-xs text-ink-3">
                    DOB {formatDate(r.patient.dateOfBirth)}
                    {r.referralDiagnosisText && ` · ${r.referralDiagnosisText}`}
                  </div>
                </td>
                <td className="px-3 py-2"><StatusBadge status={r.status as ReferralStatus} /></td>
                <td className="px-3 py-2">
                  <AgeChip days={calendarDaysBetween(r.receivedAt, now)} />
                  {r.firstTouchedAt === null && (
                    <span className="ml-1 text-xs text-red">untouched</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-2">{r.referringOrganization?.name ?? '—'}</td>
                <td className="px-3 py-2 text-ink-2">{r.payer?.name ?? '—'}</td>
                <td className="px-3 py-2 text-ink-2">{r.assignedUser?.name ?? <span className="text-ink-3">Unassigned</span>}</td>
                <td className="px-3 py-2 text-ink-2">{nextAction(r.status as ReferralStatus)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          <PageLink params={params} page={page - 1} disabled={page <= 1} label="Previous" />
          <span className="tnum text-ink-3">Page {page} of {pages}</span>
          <PageLink params={params} page={page + 1} disabled={page >= pages} label="Next" />
        </nav>
      )}
    </div>
  )
}

function PageLink({ params, page, disabled, label }: {
  params: Search; page: number; disabled: boolean; label: string
}) {
  if (disabled) return <span className="text-ink-3">{label}</span>
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'page' || v === undefined) continue
    for (const item of asArray(v)) next.append(k, item)
  }
  next.set('page', String(page))
  return <Link href={`/referrals?${next}`} className="text-brand hover:underline">{label}</Link>
}
