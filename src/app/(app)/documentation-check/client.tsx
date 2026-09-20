'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CodingResultView } from '@/components/coding-result'
import { Card, FormBanner, NoPhiNotice, SectionTitle } from '@/components/ui'
import { documentationCheckAction, type DocCheckState } from './actions'

const SAMPLE = `Patient presented for restorative treatment on tooth #30.
Existing MOD amalgam was removed. Recurrent decay was found beneath the
restoration and excavated. MOD composite restoration placed, occlusion
checked and adjusted, and the restoration polished.`

export function DocumentationCheck() {
  const [state, action] = useActionState<DocCheckState, FormData>(
    documentationCheckAction,
    {},
  )
  const [note, setNote] = useState('')

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form action={action} className="space-y-4">
          <div>
            <label className="label text-base font-semibold text-ink" htmlFor="note">
              Paste your clinical note
            </label>
            <p className="mb-2 text-sm text-ink-2">
              We review it for coding specificity — which details are documented, and which are
              not.
            </p>
            <textarea
              id="note"
              name="note"
              rows={10}
              required
              className="field resize-y font-mono text-sm"
              placeholder="Paste the clinical note here…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="codes">
              Codes already selected (optional)
            </label>
            <input
              id="codes"
              name="codes"
              className="field font-mono"
              placeholder="D2393, D0274"
              defaultValue={state.codes ?? ''}
              autoComplete="off"
            />
            <p className="hint">
              Add these and we will flag anything inconsistent between the note and the codes.
            </p>
          </div>

          <NoPhiNotice />
          {state.error && <FormBanner tone="error">{state.error}</FormBanner>}

          <div className="flex flex-wrap items-center gap-3">
            <ReviewButton />
            <button type="button" className="btn-ghost btn-sm" onClick={() => setNote(SAMPLE)}>
              Use a sample note
            </button>
          </div>
        </form>
      </Card>

      {state.result && (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-ink">Documentation review</h2>
            <SectionTitle>
              {state.result.procedures.length} procedure
              {state.result.procedures.length === 1 ? '' : 's'} detected
            </SectionTitle>
          </div>
          <CodingResultView result={state.result} />
        </div>
      )}
    </div>
  )
}

function ReviewButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Reviewing…' : 'Review this note'}
    </button>
  )
}
