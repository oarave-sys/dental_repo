'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ActionResult } from '@/lib/actions/guard'

export function RuleSetControls(props: {
  mode: 'install' | 'draft' | 'published'
  ruleSetVersionId?: string
  version?: number
  action?: (input: unknown) => Promise<ActionResult<unknown>>
  forkAction?: (input: unknown) => Promise<ActionResult<unknown>>
  publishAction?: (input: unknown) => Promise<ActionResult<unknown>>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const run = (fn: () => Promise<ActionResult<unknown>>) => {
    setError(null)
    start(async () => {
      const result = await fn()
      if (result.ok) router.refresh()
      else setError(result.message)
    })
  }

  if (props.mode === 'install') {
    return (
      <div>
        <button
          type="button" disabled={pending} className="btn-primary"
          onClick={() => run(() => props.action!({}))}
        >
          {pending ? 'Installing…' : 'Install rheumatology pack'}
        </button>
        {error && <p role="alert" className="mt-2 text-xs text-red">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {props.mode === 'draft' && (
        confirming ? (
          <>
            <span className="text-xs text-ink-2">Publish v{props.version}?</span>
            <button
              type="button" disabled={pending} className="btn-primary px-2 py-1 text-xs"
              onClick={() => run(() => props.publishAction!({ ruleSetVersionId: props.ruleSetVersionId }))}
            >
              {pending ? 'Publishing…' : 'Confirm'}
            </button>
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setConfirming(true)}>
            Publish
          </button>
        )
      )}
      {props.mode === 'published' && (
        <button
          type="button" disabled={pending} className="btn-ghost px-2 py-1 text-xs"
          onClick={() => run(() => props.forkAction!({ ruleSetVersionId: props.ruleSetVersionId }))}
        >
          {pending ? 'Copying…' : 'New draft from this'}
        </button>
      )}
      {error && <span role="alert" className="text-xs text-red">{error}</span>}
    </div>
  )
}
