import { notFound } from 'next/navigation'
import { withAuthorizedQuery } from '@/lib/actions/guard'
import { getReferralDetail } from '@/lib/repositories/referrals'
import { writeAudit } from '@/lib/audit'
import { can } from '@/lib/authz'
import {
  allowedTransitions, nextAction, STATUS_LABELS, type ReferralStatus,
} from '@/lib/domain/referral-status'
import { calendarDaysBetween } from '@/lib/domain/business-time'
import {
  AgeChip, Breadcrumb, Card, EmptyState, StatusBadge,
  formatDate, formatDateTime, formatDuration,
} from '@/components/ui'
import { StatusActions, AssignForm, ContactForm, NoteForm, EhrLinkForm } from './forms'
import { RequirementChecklist, RerunTriageButton } from './triage-forms'
import {
  changeStatusAction, assignAction, logContactAction, addNoteAction, linkEhrAction,
  runTriageAction, setRequirementAction,
} from './actions'
import { loadEvaluationDetail } from '@/lib/services/triage'
import { DispositionBadge, ConfidenceMeter, DimensionRow, type TriageOutcome } from '@/components/ui/triage'
import { formatCode } from '@/lib/icd10'

export const dynamic = 'force-dynamic'

export default async function ReferralDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const { referral, teammates, actor, evaluation } = await withAuthorizedQuery('referral:read', async ({ db, actor }) => {
    const referral = await getReferralDetail(db, id)
    if (!referral) return { referral: null, teammates: [], actor, evaluation: null }

    // Opening a referral is access to PHI. It is audited every time.
    await writeAudit(db, actor, {
      action: 'REFERRAL_VIEW', resourceType: 'referral', resourceId: id,
    })

    const memberships = await db.membership.findMany({
      where: { status: 'ACTIVE' },
      select: { userId: true, user: { select: { id: true, name: true } } },
    })
    return {
      referral,
      teammates: memberships.map((m) => ({ id: m.user.id, name: m.user.name })),
      actor,
      evaluation: await loadEvaluationDetail(db, id),
    }
  })

  if (!referral) notFound()

  const status = referral.status as ReferralStatus
  const age = calendarDaysBetween(referral.receivedAt, new Date())
  const patient = referral.patient
  const primary = evaluation?.diagnosisCandidates.find((c) => c.isPrimary) ?? null
  const noted = evaluation?.diagnosisCandidates.filter((c) => !c.isPrimary) ?? []
  const possible = (primary?.possibleCodes as Array<{ description: string }> | null) ?? []

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Referrals', href: '/referrals' }, { label: 'Referral' }]} />

      {/* Header: everything a coordinator needs before deciding what to do. */}
      <div className="card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-ink">
              {patient.lastName}, {patient.firstName}
            </h1>
            <p className="text-sm text-ink-3">
              DOB {formatDate(patient.dateOfBirth)}
              {patient.phonePrimary && ` · ${patient.phonePrimary}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={status} />
            <AgeChip days={age} />
            {referral.priority === 'EXPEDITE' && (
              <span className="rounded bg-red-bg px-2 py-0.5 text-xs font-medium text-red">Expedite</span>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-rule pt-4 text-sm md:grid-cols-4">
          <Fact label="Referring office" value={referral.referringOrganization?.name} />
          <Fact
            label="Referring provider"
            value={referral.referringProvider
              ? `${referral.referringProvider.firstName} ${referral.referringProvider.lastName}${referral.referringProvider.credential ? `, ${referral.referringProvider.credential}` : ''}`
              : null}
          />
          <Fact label="Payer" value={referral.payer?.name ?? referral.payerRawName} />
          <Fact label="Owner" value={referral.assignedUser?.name} />
          <Fact label="Received" value={formatDateTime(referral.receivedAt)} />
          <Fact label="Intake channel" value={referral.intakeChannel.toLowerCase()} />
          <Fact label="Referral diagnosis" value={referral.referralDiagnosisText} />
          <Fact label="Next action" value={nextAction(status)} />
        </dl>
      </div>

      {/* Referral intelligence. Every dimension is shown, not just the deciding one. */}
      {evaluation ? (
        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-ink">Referral intelligence</h2>
              <DispositionBadge outcome={evaluation.finalDisposition as TriageOutcome} size="lg" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-3">
                Rules v{evaluation.ruleSetVersion.version} · {formatDateTime(evaluation.evaluatedAt)}
              </span>
              {can(actor, 'referral:update') && (
                <RerunTriageButton referralId={referral.id} action={runTriageAction} />
              )}
            </div>
          </header>

          <div className="grid gap-4 px-4 py-3 md:grid-cols-[1fr_240px]">
            <div>
              <div className="mb-2 text-sm">
                <span className="text-ink-3">Next action: </span>
                <span className="font-medium text-ink">{evaluation.nextAction}</span>
              </div>
              {primary ? (
                <p className="text-sm text-ink-2">
                  Likely diagnosis <span className="font-medium text-ink">{primary.category.name}</span>
                  {primary.bestCode && (
                    <span className="ml-2 font-mono text-xs text-ink">{formatCode(primary.bestCode)}</span>
                  )}
                  <span className="ml-2 text-xs text-ink-3">
                    matched by {primary.matchType.replaceAll('_', ' ').toLowerCase()}
                  </span>
                </p>
              ) : (
                <p className="text-sm text-ink-2">No diagnosis could be identified from this referral.</p>
              )}

              {possible.length > 0 && (
                <div className="mt-2 rounded border border-rule bg-surface-2 px-3 py-2 text-xs text-ink-2">
                  <span className="font-medium text-ink">Specificity depends on the record: </span>
                  {possible.map((p, i) => (
                    <span key={i}>{i > 0 && ' · '}{p.description}</span>
                  ))}
                </div>
              )}

              {noted.length > 0 && (
                <div className="mt-2 rounded border border-amber/40 bg-amber-bg/40 px-3 py-2 text-xs text-ink-2">
                  {noted.map((n) => (
                    <div key={n.id}>
                      <span className="font-medium text-ink">{n.category.name}</span> also documented
                      ({n.strongestContext.replaceAll('_', ' ').toLowerCase()}) — not the primary
                      diagnosis, not blocking.
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {primary && (
                <ConfidenceMeter score={primary.diagnosisConfidence} label="Diagnosis confidence" />
              )}
              <ConfidenceMeter score={evaluation.dispositionConfidence} label="Disposition confidence" />
              <p className="text-[11px] leading-snug text-ink-3">
                Heuristic scores, not calibrated probabilities. They change what is surfaced
                first, never what happens to a patient.
              </p>
            </div>
          </div>

          <div className="divide-y divide-rule border-t border-rule">
            {evaluation.dimensionResults.map((d) => (
              <DimensionRow
                key={d.id}
                dimension={d.dimension}
                outcome={d.outcome as TriageOutcome}
                summary={d.summary}
                decisive={d.decisive}
              />
            ))}
          </div>
        </section>
      ) : (
        <Card title="Referral intelligence">
          <p className="text-sm text-ink-2">
            This referral has not been triaged yet.
          </p>
          {can(actor, 'referral:update') && (
            <div className="mt-3">
              <RerunTriageButton referralId={referral.id} action={runTriageAction} />
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Activity timeline">
            {referral.activities.length === 0 ? (
              <EmptyState title="Nothing has happened yet." />
            ) : (
              <ol className="space-y-3">
                {referral.activities.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rule-2" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-ink">
                          {a.type.replaceAll('_', ' ').toLowerCase()}
                        </span>
                        <span className="text-xs text-ink-3">
                          {a.user?.name ?? 'System'} · {formatDateTime(a.occurredAt)}
                        </span>
                      </div>
                      {a.note && <p className="mt-0.5 text-ink-2">{a.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {can(actor, 'referral:update') && (
            <Card title="Add a note">
              <NoteForm referralId={referral.id} action={addNoteAction} />
            </Card>
          )}

          <Card title="Contact attempts">
            {referral.contactAttempts.length === 0 ? (
              <EmptyState title="No contact attempts recorded." />
            ) : (
              <ul className="space-y-2 text-sm">
                {referral.contactAttempts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-rule pb-2 last:border-0">
                    <span className="font-medium text-ink">{c.outcome.replaceAll('_', ' ').toLowerCase()}</span>
                    <span className="text-xs text-ink-3">
                      {c.method.toLowerCase()} · {c.user?.name ?? 'System'} · {formatDateTime(c.attemptedAt)}
                    </span>
                    {c.note && <p className="w-full text-ink-2">{c.note}</p>}
                  </li>
                ))}
              </ul>
            )}
            {can(actor, 'referral:contact') && (
              <div className="mt-3 border-t border-rule pt-3">
                <ContactForm referralId={referral.id} action={logContactAction} />
              </div>
            )}
          </Card>

          {evaluation && (
            <Card title="Required documentation">
              <RequirementChecklist
                referralId={referral.id}
                rows={evaluation.requirementResults.map((r) => ({
                  requirementKey: r.requirementKey,
                  label: r.label,
                  level: r.level,
                  status: r.status,
                }))}
                action={setRequirementAction}
                canEdit={can(actor, 'triage:override')}
              />
            </Card>
          )}

          <Card title="Documents">
            {referral.documents.length === 0 ? (
              <EmptyState
                title="No documents yet."
                hint="Upload and packet analysis arrive in Phase 4."
              />
            ) : (
              <ul className="space-y-1 text-sm text-ink-2">
                {referral.documents.map((d) => (
                  <li key={d.id} className="flex justify-between">
                    <span>{d.documentType.replaceAll('_', ' ').toLowerCase()}</span>
                    <span className="tnum text-xs text-ink-3">
                      {d.pageCount ?? '—'} pages · {d.processingStatus.toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {can(actor, 'referral:status') && (
            <Card title="Move this referral">
              <StatusActions
                referralId={referral.id}
                options={[...allowedTransitions(status)]}
                action={changeStatusAction}
              />
            </Card>
          )}

          {can(actor, 'referral:assign') && (
            <Card title="Assignment">
              <AssignForm
                referralId={referral.id}
                users={teammates}
                currentUserId={referral.assignedUserId}
                action={assignAction}
              />
            </Card>
          )}

          <Card title="EHR record">
            {patient.ehrLink ? (
              <dl className="space-y-2 text-sm">
                <Fact label="MRN" value={patient.ehrLink.mrn} />
                <Fact label="Created in EHR" value={formatDate(patient.ehrLink.createdInEhrAt)} />
              </dl>
            ) : can(actor, 'patient:link_ehr') ? (
              <EhrLinkForm
                referralId={referral.id}
                patientId={patient.id}
                action={linkEhrAction}
              />
            ) : (
              <p className="text-sm text-ink-3">
                No EHR chart yet. That is expected until this referral is scheduled.
              </p>
            )}
          </Card>

          <Card title="Processing time">
            <dl className="space-y-2 text-sm">
              <Fact label="To first touch" value={formatDuration(referral.touchMetrics?.secondsToFirstTouch)} />
              <Fact label="To first triage" value={formatDuration(referral.touchMetrics?.secondsToFirstTriage)} />
              <Fact label="To first contact" value={formatDuration(referral.touchMetrics?.secondsToFirstContact)} />
              <Fact label="To scheduled" value={formatDuration(referral.touchMetrics?.secondsToScheduled)} />
            </dl>
          </Card>

          <Card title="Status history">
            <ol className="space-y-2 text-sm">
              {referral.statusHistory.map((h) => (
                <li key={h.id}>
                  <div className="text-ink">
                    {h.fromStatus ? `${STATUS_LABELS[h.fromStatus as ReferralStatus]} → ` : ''}
                    {STATUS_LABELS[h.toStatus as ReferralStatus]}
                  </div>
                  <div className="text-xs text-ink-3">{formatDateTime(h.changedAt)}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
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
