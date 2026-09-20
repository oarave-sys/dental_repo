'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { CodingResultView } from '@/components/coding-result'
import { Card, FormBanner, NoPhiNotice, SectionTitle } from '@/components/ui'
import type { FollowUpQuestion } from '@/lib/coding/result'
import { analyseAction, saveCaseAction, type FindCodeState } from './actions'

const EXAMPLES = [
  'MOD composite #30',
  'exam bwx cleaning fluoride',
  '#19 old crown fractured, recurrent decay, new zirconia crown',
  'SRP upper right, 5 teeth',
]

export function FindACode() {
  const [state, action] = useActionState<FindCodeState, FormData>(analyseAction, {})
  const [description, setDescription] = useState('')

  const needsAnswers = state.result?.status === 'NEEDS_INPUT'

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form action={action} className="space-y-4">
          <input type="hidden" name="intent" value="new" />
          <div>
            <label className="label text-base font-semibold text-ink" htmlFor="description">
              What did you do?
            </label>
            <p className="mb-2 text-sm text-ink-2">
              Describe the procedure in your own words. Shorthand is fine.
            </p>
            <textarea
              id="description"
              name="description"
              rows={5}
              required
              className="field resize-y"
              placeholder="e.g. Patient had fractured MOD composite on #30. Existing restoration removed, recurrent decay removed, and MOD composite placed."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <NoPhiNotice />

          {state.error && <FormBanner tone="error">{state.error}</FormBanner>}

          <div className="flex flex-wrap items-center gap-3">
            <AnalyseButton />
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setDescription('')}
            >
              Clear
            </button>
          </div>
        </form>

        {!state.result && (
          <div className="mt-5 border-t border-rule pt-4">
            <SectionTitle>Try one of these</SectionTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setDescription(example)}
                  className="rounded-full border border-rule bg-white px-3 py-1.5 text-sm text-ink-2 hover:border-brand hover:text-brand"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {state.result && (
        <CodingResultView result={state.result}>
          {needsAnswers && (
            <ClarificationForm
              questions={state.result.followUpQuestions}
              action={action}
              description={state.description ?? description}
            />
          )}
        </CodingResultView>
      )}

      {state.result && state.result.recommendedCodes.length > 0 && (
        <SaveCaseCard state={state} />
      )}
    </div>
  )
}

function AnalyseButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Analysing…' : 'Find the code'}
    </button>
  )
}

/**
 * The clarification step.
 *
 * Shown above the result rather than below it: when the engine is holding back
 * a recommendation, the question IS the result, and burying it under an empty
 * panel would invite people to scroll past and assume the tool had failed.
 */
function ClarificationForm({
  questions,
  action,
  description,
}: {
  questions: FollowUpQuestion[]
  action: (formData: FormData) => void
  description: string
}) {
  return (
    <Card className="border-medium-border bg-medium-bg/40 p-5">
      <SectionTitle>
        {questions.length === 1 ? 'One more detail' : `${questions.length} more details`}
      </SectionTitle>
      <p className="mt-1.5 text-[15px] text-ink-2">
        More than one code is still possible. Answering this decides which one applies — we would
        rather ask than guess.
      </p>

      <form action={action} className="mt-4 space-y-5">
        <input type="hidden" name="intent" value="answer" />
        <input type="hidden" name="description" value={description} />

        {questions.map((question) => (
          <div key={question.key}>
            <label className="label" htmlFor={question.key}>
              {question.question}
            </label>

            {question.options.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {question.options.map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-rule bg-white px-3 py-2.5 text-sm text-ink-2 hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-brand"
                  >
                    <input
                      type="radio"
                      name={`answer:${question.key}`}
                      value={option}
                      className="accent-brand"
                    />
                    {option}
                  </label>
                ))}
              </div>
            ) : (
              <input
                id={question.key}
                name={`answer:${question.key}`}
                className="field"
                placeholder={placeholderFor(question.factKey)}
                autoComplete="off"
              />
            )}

            {question.blockingCodes.length > 1 && (
              <p className="hint">
                Still possible: {question.blockingCodes.slice(0, 6).join(', ')}
              </p>
            )}
          </div>
        ))}

        <AnswerButton />
      </form>
    </Card>
  )
}

function AnswerButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Refining…' : 'Update the recommendation'}
    </button>
  )
}

function placeholderFor(factKey: string): string {
  switch (factKey) {
    case 'surfaces':
      return 'e.g. MO, or mesial and occlusal'
    case 'tooth_numbers':
      return 'e.g. 30, or A for a primary tooth'
    case 'image_count':
      return 'e.g. 4'
    case 'material':
      return 'e.g. composite, zirconia'
    case 'tooth_count_in_quadrant':
      return 'e.g. 5'
    default:
      return ''
  }
}

function SaveCaseCard({ state }: { state: FindCodeState }) {
  const [saveState, saveAction] = useActionState<FindCodeState, FormData>(saveCaseAction, state)
  const [open, setOpen] = useState(false)

  if (saveState.savedCaseId) {
    return <FormBanner tone="success">Saved. You will find it under Saved cases.</FormBanner>
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        Save this case
      </button>
    )
  }

  return (
    <Card className="p-5">
      <SectionTitle>Save this case</SectionTitle>
      <form action={saveAction} className="mt-3 space-y-4">
        <div>
          <label className="label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            name="title"
            required
            className="field"
            placeholder="MOD composite, posterior"
          />
          <p className="hint">
            Use a description of the procedure, not a patient identifier.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="notes">
            Notes (optional)
          </label>
          <textarea id="notes" name="notes" rows={2} className="field resize-y" />
        </div>
        {saveState.error && <FormBanner tone="error">{saveState.error}</FormBanner>}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Save case
          </button>
          <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}
