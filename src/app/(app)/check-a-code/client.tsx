'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { CodingResultView } from '@/components/coding-result'
import {
  Badge,
  Card,
  DatasetNotice,
  Disclaimer,
  FormBanner,
  NoPhiNotice,
  SectionTitle,
} from '@/components/ui'
import type { CodeExplanation } from '@/lib/coding/tools'
import { checkCodeAction, type CheckCodeState } from './actions'

export function CheckACode() {
  const [state, action] = useActionState<CheckCodeState, FormData>(checkCodeAction, {})

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div>
              <label className="label" htmlFor="code">
                Code
              </label>
              <input
                id="code"
                name="code"
                required
                className="field font-mono"
                placeholder="D2393"
                defaultValue={state.code ?? ''}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="label" htmlFor="description">
                What you did (optional)
              </label>
              <input
                id="description"
                name="description"
                className="field"
                placeholder="MOD composite #30"
                defaultValue={state.description ?? ''}
              />
              <p className="hint">
                Add this and we will compare the code against what you documented.
              </p>
            </div>
          </div>

          <NoPhiNotice />
          {state.error && <FormBanner tone="error">{state.error}</FormBanner>}
          <CheckButton />
        </form>
      </Card>

      {state.explanation && !state.explanation.found && (
        <Card className="p-5">
          <FormBanner tone="error">{state.explanation.message}</FormBanner>
          {state.explanation.suggestions.length > 0 && (
            <div className="mt-4">
              <SectionTitle>Codes near that number</SectionTitle>
              <ul className="mt-2 space-y-1.5">
                {state.explanation.suggestions.map((s) => (
                  <li key={s.code} className="flex gap-3 text-sm">
                    <span className="code-number shrink-0 text-ink">{s.code}</span>
                    <span className="text-ink-2">{s.shortLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {state.explanation?.found && <CodeCard explanation={state.explanation} />}

      {state.analysis && (
        <div>
          <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">
            Compared with what you documented
          </h2>
          <CodingResultView result={state.analysis} />
        </div>
      )}
    </div>
  )
}

function CheckButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Checking…' : 'Check this code'}
    </button>
  )
}

function CodeCard({ explanation }: { explanation: CodeExplanation }) {
  return (
    <div className="space-y-5">
      <DatasetNotice dataset={explanation.dataset} />

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <p className="code-number text-3xl text-ink">{explanation.code}</p>
          <Badge tone="brand">{explanation.categoryLabel}</Badge>
          {explanation.subcategory && <Badge>{explanation.subcategory}</Badge>}
        </div>

        <p className="mt-3 text-[15px] font-medium text-ink">{explanation.shortLabel}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{explanation.plainLanguage}</p>

        {explanation.officialDescriptor ? (
          <div className="mt-4 rounded-lg border border-rule bg-surface-2/60 px-3.5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Official descriptor
            </p>
            <p className="mt-1 text-sm text-ink-2">{explanation.officialDescriptor}</p>
            {explanation.officialDescriptorSource && (
              <p className="mt-1 text-xs text-ink-3">{explanation.officialDescriptorSource}</p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-ink-3">
            The official descriptor is not shown because no licensed dataset is loaded. The
            explanation above is our own plain-language writing.
          </p>
        )}

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {explanation.commonUse && (
            <div>
              <SectionTitle>Common use</SectionTitle>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">{explanation.commonUse}</p>
            </div>
          )}
          {explanation.distinctions && (
            <div>
              <SectionTitle>Important distinctions</SectionTitle>
              <p className="mt-2 text-sm leading-relaxed text-ink-2">
                {explanation.distinctions}
              </p>
            </div>
          )}
        </div>
      </Card>

      {explanation.documentationConsiderations.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Documentation considerations</SectionTitle>
          <ul className="mt-2 space-y-2">
            {explanation.documentationConsiderations.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-px shrink-0 text-ink-3">
                  &bull;
                </span>
                <span className="leading-relaxed text-ink-2">{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {explanation.verifyQuestions.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Questions to confirm this is the right code</SectionTitle>
          <ul className="mt-2 space-y-2">
            {explanation.verifyQuestions.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm">
                <span aria-hidden className="mt-px shrink-0 font-semibold text-medium">
                  ?
                </span>
                <span className="leading-relaxed text-ink-2">{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(explanation.commonlyConfusedWith.length > 0 || explanation.relatedCodes.length > 0) && (
        <Card className="p-5">
          <SectionTitle>Codes commonly confused with this one</SectionTitle>
          <ul className="mt-3 space-y-3">
            {[...explanation.commonlyConfusedWith, ...explanation.relatedCodes].map((rel) => (
              <li key={`${rel.code}-${rel.relationship}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="code-number text-sm text-ink">{rel.code}</span>
                  <span className="text-sm font-medium text-ink">{rel.shortLabel}</span>
                  <Badge>{rel.relationship}</Badge>
                </div>
                {rel.note && <p className="mt-1 text-sm leading-relaxed text-ink-2">{rel.note}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Disclaimer />
    </div>
  )
}
