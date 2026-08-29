'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ActionResult } from '@/lib/actions/guard'
import { Card, Field } from '@/components/ui'

interface DuplicateHit {
  patientId: string
  firstName: string
  lastName: string
  dateOfBirth: string
  score: number
  strong: boolean
  reasons: string[]
}

interface Options {
  offices: Array<{ id: string; name: string }>
  providers: Array<{ id: string; name: string; officeId: string | null }>
  payers: Array<{ id: string; name: string }>
}

const today = () => new Date().toISOString().slice(0, 16)

export function IntakeForm({ options, checkDuplicates, createReferral }: {
  options: Options
  checkDuplicates: (input: unknown) => Promise<ActionResult<DuplicateHit[]>>
  createReferral: (input: unknown) => Promise<ActionResult<{ referralId: string }>>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateHit[] | null>(null)
  const [attachTo, setAttachTo] = useState<string | null>(null)

  const [patient, setPatient] = useState({
    firstName: '', lastName: '', dateOfBirth: '',
    phonePrimary: '', addressLine1: '', city: '', state: '', postalCode: '',
  })
  const [referral, setReferral] = useState({
    receivedAt: today(),
    intakeChannel: 'FAX',
    referringOrganizationId: '',
    referringProviderId: '',
    payerId: '',
    memberId: '',
    referralDiagnosisText: '',
    referringDiagnosisCode: '',
    notes: '',
  })

  const patientReady = patient.firstName && patient.lastName && /^\d{4}-\d{2}-\d{2}$/.test(patient.dateOfBirth)

  const runDuplicateCheck = () => {
    if (!patientReady) return
    setError(null)
    start(async () => {
      const result = await checkDuplicates(cleanPatient(patient))
      if (result.ok) setDuplicates(result.data)
      else setError(result.message)
    })
  }

  const submit = () => {
    setError(null)
    start(async () => {
      const result = await createReferral({
        patient: cleanPatient(patient),
        existingPatientId: attachTo,
        receivedAt: new Date(referral.receivedAt).toISOString(),
        intakeChannel: referral.intakeChannel,
        referringOrganizationId: referral.referringOrganizationId || null,
        referringProviderId: referral.referringProviderId || null,
        payerId: referral.payerId || null,
        memberId: referral.memberId || null,
        referralDiagnosisText: referral.referralDiagnosisText || null,
        referringDiagnosisCode: referral.referringDiagnosisCode || null,
        notes: referral.notes || null,
      })
      if (result.ok) router.push(`/referrals/${result.data.referralId}`)
      else setError(result.message)
    })
  }

  const providersForOffice = referral.referringOrganizationId
    ? options.providers.filter((p) => p.officeId === referral.referringOrganizationId)
    : options.providers

  return (
    <div className="space-y-4">
      <Card title="Patient">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <input
              name="firstName" value={patient.firstName}
              onChange={(e) => setPatient({ ...patient, firstName: e.target.value })}
              onBlur={runDuplicateCheck}
              className="field"
            />
          </Field>
          <Field label="Last name">
            <input
              name="lastName" value={patient.lastName}
              onChange={(e) => setPatient({ ...patient, lastName: e.target.value })}
              onBlur={runDuplicateCheck}
              className="field"
            />
          </Field>
          <Field label="Date of birth" hint="YYYY-MM-DD">
            <input
              type="date"
              name="dateOfBirth" value={patient.dateOfBirth}
              onChange={(e) => setPatient({ ...patient, dateOfBirth: e.target.value })}
              onBlur={runDuplicateCheck}
              className="field"
            />
          </Field>
          <Field label="Phone">
            <input
              name="phonePrimary" value={patient.phonePrimary}
              onChange={(e) => setPatient({ ...patient, phonePrimary: e.target.value })}
              onBlur={runDuplicateCheck}
              className="field"
            />
          </Field>
          <Field label="Address">
            <input
              name="addressLine1" value={patient.addressLine1}
              onChange={(e) => setPatient({ ...patient, addressLine1: e.target.value })}
              className="field"
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="City">
              <input name="city" value={patient.city} onChange={(e) => setPatient({ ...patient, city: e.target.value })} className="field" />
            </Field>
            <Field label="State">
              <input name="state" value={patient.state} onChange={(e) => setPatient({ ...patient, state: e.target.value })} className="field" />
            </Field>
            <Field label="ZIP">
              <input name="postalCode" value={patient.postalCode} onChange={(e) => setPatient({ ...patient, postalCode: e.target.value })} className="field" />
            </Field>
          </div>
        </div>
      </Card>

      {duplicates && duplicates.length > 0 && (
        <div className="rounded-lg border border-amber/50 bg-amber-bg/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-amber">Possible existing patient</h3>
          <p className="mt-0.5 text-xs text-ink-2">
            Nothing has been saved yet. Attach this referral to an existing patient, or continue
            creating a new one — the system will not merge records for you.
          </p>
          <ul className="mt-3 space-y-2">
            {duplicates.map((d) => (
              <li key={d.patientId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-rule bg-white px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium text-ink">{d.lastName}, {d.firstName}</span>
                  <span className="ml-2 text-xs text-ink-3">DOB {d.dateOfBirth}</span>
                  <div className="text-xs text-ink-2">{d.reasons.join(' · ')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tnum text-xs text-ink-3">{d.score}</span>
                  <Link href={`/patients/${d.patientId}`} className="btn-ghost px-2 py-1 text-xs">Open</Link>
                  <button
                    type="button"
                    onClick={() => setAttachTo(attachTo === d.patientId ? null : d.patientId)}
                    className={attachTo === d.patientId ? 'btn-primary px-2 py-1 text-xs' : 'btn-secondary px-2 py-1 text-xs'}
                  >
                    {attachTo === d.patientId ? 'Attaching' : 'Attach referral'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {attachTo && (
            <p className="mt-2 text-xs text-ink-2">
              This referral will be added to the selected patient. The details above will not
              overwrite theirs.
            </p>
          )}
        </div>
      )}

      <Card title="Referral">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Received" hint="When the referral arrived, not when it was entered.">
            <input
              type="datetime-local"
              value={referral.receivedAt}
              onChange={(e) => setReferral({ ...referral, receivedAt: e.target.value })}
              className="field"
            />
          </Field>
          <Field label="Intake channel">
            <select
              value={referral.intakeChannel}
              onChange={(e) => setReferral({ ...referral, intakeChannel: e.target.value })}
              className="field"
            >
              {['FAX', 'PORTAL', 'PHONE', 'EMAIL', 'MANUAL'].map((c) => (
                <option key={c} value={c}>{c.toLowerCase()}</option>
              ))}
            </select>
          </Field>
          <Field label="Referring office">
            <select
              value={referral.referringOrganizationId}
              onChange={(e) => setReferral({ ...referral, referringOrganizationId: e.target.value, referringProviderId: '' })}
              className="field"
            >
              <option value="">Not specified</option>
              {options.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Referring provider">
            <select
              value={referral.referringProviderId}
              onChange={(e) => setReferral({ ...referral, referringProviderId: e.target.value })}
              className="field"
            >
              <option value="">Not specified</option>
              {providersForOffice.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Payer">
            <select
              value={referral.payerId}
              onChange={(e) => setReferral({ ...referral, payerId: e.target.value })}
              className="field"
            >
              <option value="">Not specified</option>
              {options.payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Member ID">
            <input
              name="memberId" value={referral.memberId}
              onChange={(e) => setReferral({ ...referral, memberId: e.target.value })}
              className="field"
            />
          </Field>
          <Field label="Referral diagnosis">
            <input
              name="referralDiagnosisText" value={referral.referralDiagnosisText}
              onChange={(e) => setReferral({ ...referral, referralDiagnosisText: e.target.value })}
              className="field"
            />
          </Field>
          <Field label="Diagnosis code" hint="As supplied by the referring office.">
            <input
              name="referringDiagnosisCode" value={referral.referringDiagnosisCode}
              onChange={(e) => setReferral({ ...referral, referringDiagnosisCode: e.target.value })}
              className="field font-mono"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes">
            <textarea
              rows={2}
              value={referral.notes}
              onChange={(e) => setReferral({ ...referral, notes: e.target.value })}
              className="field"
            />
          </Field>
        </div>
      </Card>

      {error && <p role="alert" className="rounded bg-red-bg px-3 py-2 text-sm text-red">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Link href="/referrals" className="btn-secondary">Cancel</Link>
        <button type="button" onClick={submit} disabled={pending || !patientReady} className="btn-primary">
          {pending ? 'Saving…' : attachTo ? 'Add referral to existing patient' : 'Create referral'}
        </button>
      </div>
    </div>
  )
}

function cleanPatient(p: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]),
  )
}
