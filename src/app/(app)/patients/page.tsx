import Link from 'next/link'
import { withAuthorizedQuery } from '@/lib/actions/guard'
import { writeAudit } from '@/lib/audit'
import { DataTable, EmptyState, formatDate } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * The pre-EHR staging database. A patient listed here may have no chart in the
 * EHR at all — that is the normal case, not an error state.
 */
export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const term = q?.trim()

  const { patients, openDuplicates } = await withAuthorizedQuery('patient:read', async ({ db, actor }) => {
    const patients = await db.patient.findMany({
      where: {
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { lastName: { contains: term, mode: 'insensitive' as const } },
                { firstName: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true, firstName: true, lastName: true, dateOfBirth: true, phonePrimary: true,
        ehrLink: { select: { mrn: true } },
        _count: { select: { referrals: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 100,
    })
    const openDuplicates = await db.patientMatchCandidate.count({ where: { status: 'OPEN' } })

    await writeAudit(db, actor, {
      action: term ? 'PATIENT_SEARCH' : 'PATIENT_VIEW',
      resourceType: 'patient',
      metadata: { returned: patients.length },
    })
    return { patients, openDuplicates }
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Patients</h1>
          <p className="text-sm text-ink-3">
            Staging records. A patient here does not have an EHR chart unless one is shown.
          </p>
        </div>
        {openDuplicates > 0 && (
          <Link
            href="/patients?duplicates=1"
            className="rounded bg-amber-bg px-3 py-1.5 text-sm font-medium text-amber"
          >
            {openDuplicates} possible {openDuplicates === 1 ? 'duplicate' : 'duplicates'} to review
          </Link>
        )}
      </div>

      <form className="card flex items-end gap-3 px-4 py-3" method="get">
        <label className="flex-1">
          <span className="label">Search</span>
          <input name="q" defaultValue={term ?? ''} placeholder="Surname or first name" className="field" />
        </label>
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      <div className="card overflow-hidden">
        {patients.length === 0 ? (
          <EmptyState title="No patients found." hint="Referrals create staging patients automatically." />
        ) : (
          <DataTable head={['Patient', 'Date of birth', 'Phone', 'Referrals', 'EHR']}>
            {patients.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2">
                <td className="px-3 py-2">
                  <Link href={`/patients/${p.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {p.lastName}, {p.firstName}
                  </Link>
                </td>
                <td className="tnum px-3 py-2 text-ink-2">{formatDate(p.dateOfBirth)}</td>
                <td className="tnum px-3 py-2 text-ink-2">{p.phonePrimary ?? '—'}</td>
                <td className="tnum px-3 py-2 text-ink-2">{p._count.referrals}</td>
                <td className="px-3 py-2">
                  {p.ehrLink
                    ? <span className="font-mono text-xs text-green">{p.ehrLink.mrn}</span>
                    : <span className="text-xs text-ink-3">Not in EHR</span>}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  )
}
