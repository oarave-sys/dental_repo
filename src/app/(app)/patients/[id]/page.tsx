import Link from 'next/link'
import { notFound } from 'next/navigation'
import { withAuthorizedQuery } from '@/lib/actions/guard'
import { writeAudit } from '@/lib/audit'
import { SIGNAL_LABELS, type MatchSignal } from '@/lib/domain/duplicate-detection'
import type { ReferralStatus } from '@/lib/domain/referral-status'
import { Breadcrumb, Card, EmptyState, StatusBadge, formatDate, formatDateTime } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const patient = await withAuthorizedQuery('patient:read', async ({ db, actor }) => {
    const found = await db.patient.findUnique({
      where: { id },
      include: {
        ehrLink: true,
        referrals: {
          where: { deletedAt: null },
          select: {
            id: true, status: true, receivedAt: true, referralDiagnosisText: true,
            referringOrganization: { select: { name: true } },
          },
          orderBy: { receivedAt: 'desc' },
        },
        contactAttempts: { orderBy: { attemptedAt: 'desc' }, take: 10 },
        matchesAsSource: {
          where: { status: 'OPEN' },
          include: {
            candidatePatient: {
              select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
            },
          },
        },
      },
    })
    if (found) {
      await writeAudit(db, actor, {
        action: 'PATIENT_VIEW', resourceType: 'patient', resourceId: id,
      })
    }
    return found
  })

  if (!patient) notFound()

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Patients', href: '/patients' }, { label: 'Patient' }]} />

      <div className="card px-5 py-4">
        <h1 className="text-lg font-semibold text-ink">{patient.lastName}, {patient.firstName}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <Fact label="Date of birth" value={formatDate(patient.dateOfBirth)} />
          <Fact label="Phone" value={patient.phonePrimary} />
          <Fact label="Email" value={patient.email} />
          <Fact
            label="Address"
            value={[patient.addressLine1, patient.city, patient.state, patient.postalCode]
              .filter(Boolean).join(', ') || null}
          />
          <Fact label="MRN" value={patient.ehrLink?.mrn ?? 'Not in EHR'} />
          <Fact
            label="Created in EHR"
            value={patient.ehrLink ? formatDate(patient.ehrLink.createdInEhrAt) : '—'}
          />
        </dl>
      </div>

      {patient.matchesAsSource.length > 0 && (
        <div className="rounded-lg border border-amber/50 bg-amber-bg/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-amber">Possible duplicate records</h2>
          <p className="mt-0.5 text-xs text-ink-2">
            Flagged for review. Nothing has been merged, and nothing will be without a decision here.
          </p>
          <ul className="mt-3 space-y-2">
            {patient.matchesAsSource.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-rule bg-white px-3 py-2 text-sm">
                <div>
                  <Link href={`/patients/${m.candidatePatient.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {m.candidatePatient.lastName}, {m.candidatePatient.firstName}
                  </Link>
                  <span className="ml-2 text-xs text-ink-3">
                    DOB {formatDate(m.candidatePatient.dateOfBirth)}
                  </span>
                  <div className="text-xs text-ink-2">
                    {m.matchedOn.map((s) => SIGNAL_LABELS[s as MatchSignal] ?? s).join(' · ')}
                  </div>
                </div>
                <span className="tnum text-xs text-ink-3">score {m.score}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card title="Referral history">
        {patient.referrals.length === 0 ? (
          <EmptyState title="No referrals for this patient." />
        ) : (
          <ul className="divide-y divide-rule">
            {patient.referrals.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <Link href={`/referrals/${r.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                    {r.referralDiagnosisText ?? 'Referral'}
                  </Link>
                  <div className="text-xs text-ink-3">
                    {r.referringOrganization?.name ?? 'Unknown office'} · received {formatDate(r.receivedAt)}
                  </div>
                </div>
                <StatusBadge status={r.status as ReferralStatus} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent contact attempts">
        {patient.contactAttempts.length === 0 ? (
          <EmptyState title="No contact attempts recorded." />
        ) : (
          <ul className="space-y-1 text-sm">
            {patient.contactAttempts.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span className="text-ink-2">
                  {c.method.toLowerCase()} — {c.outcome.replaceAll('_', ' ').toLowerCase()}
                </span>
                <span className="text-xs text-ink-3">{formatDateTime(c.attemptedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-ink">{value ?? <span className="text-ink-3">—</span>}</dd>
    </div>
  )
}
