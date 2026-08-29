'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { ActionResult } from '@/lib/actions/guard'
import { STATUS_LABELS, type ReferralStatus } from '@/lib/domain/referral-status'

/**
 * A thin client wrapper that runs a server action and surfaces its error.
 * Business rules stay on the server; this only decides what the user sees.
 */
function useAction<T>() {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  const run = (fn: () => Promise<ActionResult<T>>) => {
    setError(null)
    start(async () => {
      const result = await fn()
      if (result.ok) router.refresh()
      else setError(result.message)
    })
  }
  return { error, pending, run }
}

function Error({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p role="alert" className="mt-2 rounded bg-red-bg px-3 py-2 text-xs text-red">{children}</p>
}

export function StatusActions({ referralId, options, action }: {
  referralId: string
  options: ReferralStatus[]
  action: (input: unknown) => Promise<ActionResult<unknown>>
}) {
  const { error, pending, run } = useAction()
  const [to, setTo] = useState<ReferralStatus | ''>('')
  const [reason, setReason] = useState('')

  if (options.length === 0) {
    return <p className="text-xs text-ink-3">No further transitions are available.</p>
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[180px] flex-1">
          <span className="label">Move to</span>
          <select value={to} onChange={(e) => setTo(e.target.value as ReferralStatus)} className="field">
            <option value="">Choose a status…</option>
            {options.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="min-w-[180px] flex-1">
          <span className="label">Reason (optional)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="field" />
        </label>
        <button
          type="button"
          disabled={!to || pending}
          onClick={() => run(() => action({ referralId, to, reason: reason || null }))}
          className="btn-primary"
        >
          {pending ? 'Saving…' : 'Update'}
        </button>
      </div>
      <Error>{error}</Error>
    </div>
  )
}

export function AssignForm({ referralId, users, currentUserId, action }: {
  referralId: string
  users: Array<{ id: string; name: string }>
  currentUserId: string | null
  action: (input: unknown) => Promise<ActionResult<unknown>>
}) {
  const { error, pending, run } = useAction()
  return (
    <div>
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="label">Owner</span>
          <select
            defaultValue={currentUserId ?? ''}
            onChange={(e) =>
              run(() => action({ referralId, assignedUserId: e.target.value || null }))
            }
            disabled={pending}
            className="field"
          >
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </div>
      <Error>{error}</Error>
    </div>
  )
}

export function ContactForm({ referralId, action }: {
  referralId: string
  action: (input: unknown) => Promise<ActionResult<unknown>>
}) {
  const { error, pending, run } = useAction()
  const [method, setMethod] = useState('PHONE')
  const [outcome, setOutcome] = useState('NO_ANSWER')
  const [note, setNote] = useState('')

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">Method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="field">
            {['PHONE', 'VOICEMAIL', 'TEXT', 'EMAIL', 'MAIL', 'IN_PERSON'].map((m) => (
              <option key={m} value={m}>{m.replace('_', ' ').toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Outcome</span>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="field">
            {['REACHED', 'LEFT_VOICEMAIL', 'NO_ANSWER', 'WRONG_NUMBER', 'DECLINED', 'CALLBACK_REQUESTED'].map((o) => (
              <option key={o} value={o}>{o.replaceAll('_', ' ').toLowerCase()}</option>
            ))}
          </select>
        </label>
        <label className="min-w-[200px] flex-1">
          <span className="label">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="field" />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => action({ referralId, method, outcome, note: note || null }))}
          className="btn-secondary"
        >
          {pending ? 'Saving…' : 'Log attempt'}
        </button>
      </div>
      <Error>{error}</Error>
    </div>
  )
}

export function NoteForm({ referralId, action }: {
  referralId: string
  action: (input: unknown) => Promise<ActionResult<unknown>>
}) {
  const { error, pending, run } = useAction()
  const [note, setNote] = useState('')
  return (
    <div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Add a note to the timeline…"
        className="field"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={pending || !note.trim()}
          onClick={() => run(async () => {
            const r = await action({ referralId, note })
            if (r.ok) setNote('')
            return r
          })}
          className="btn-secondary"
        >
          {pending ? 'Saving…' : 'Add note'}
        </button>
      </div>
      <Error>{error}</Error>
    </div>
  )
}

export function EhrLinkForm({ referralId, patientId, action }: {
  referralId: string
  patientId: string
  action: (input: unknown) => Promise<ActionResult<unknown>>
}) {
  const { error, pending, run } = useAction()
  const [mrn, setMrn] = useState('')
  const [ehrPatientId, setEhrPatientId] = useState('')

  return (
    <div>
      <p className="mb-2 text-xs text-ink-3">
        Record the chart once it exists in the EHR. This system does not create it.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[140px] flex-1">
          <span className="label">MRN</span>
          <input value={mrn} onChange={(e) => setMrn(e.target.value)} className="field" />
        </label>
        <label className="min-w-[140px] flex-1">
          <span className="label">EHR patient ID (optional)</span>
          <input value={ehrPatientId} onChange={(e) => setEhrPatientId(e.target.value)} className="field" />
        </label>
        <button
          type="button"
          disabled={pending || !mrn.trim()}
          onClick={() => run(() => action({ referralId, patientId, mrn, ehrPatientId: ehrPatientId || null }))}
          className="btn-primary"
        >
          {pending ? 'Saving…' : 'Mark as created in EHR'}
        </button>
      </div>
      <Error>{error}</Error>
    </div>
  )
}
