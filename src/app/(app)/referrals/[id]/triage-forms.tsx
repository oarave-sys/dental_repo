'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ActionResult } from '@/lib/actions/guard'
import { cn } from '@/components/ui'

type Status = 'PRESENT' | 'ABSENT' | 'UNCHECKED'

interface RequirementRow {
  requirementKey: string
  label: string
  level: string
  status: Status
}

/**
 * The documentation checklist.
 *
 * Three states, not a checkbox: "not yet checked" is genuinely different from
 * "confirmed missing", and only the latter holds a referral up or generates a
 * records request. Phase 4 will pre-fill these from the packet; a coordinator
 * can always overrule it.
 */
export function RequirementChecklist({ referralId, rows, action, canEdit }: {
  referralId: string
  rows: RequirementRow[]
  action: (input: unknown) => Promise<ActionResult<unknown>>
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const set = (requirementKey: string, status: Status) => {
    setError(null)
    setBusy(requirementKey)
    start(async () => {
      const result = await action({ referralId, requirementKey, status })
      setBusy(null)
      if (result.ok) router.refresh()
      else setError(result.message)
    })
  }

  const required = rows.filter((r) => r.level === 'REQUIRED')
  const optional = rows.filter((r) => r.level !== 'REQUIRED')

  return (
    <div className="space-y-3">
      {[
        { title: 'Required', hint: 'Only these hold up a referral.', items: required },
        { title: 'Recommended', hint: 'Useful to have. Never blocking.', items: optional },
      ].map((group) => group.items.length === 0 ? null : (
        <div key={group.title}>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-3">{group.title}</span>
            <span className="text-xs text-ink-3">{group.hint}</span>
          </div>
          <ul className="divide-y divide-rule rounded border border-rule">
            {group.items.map((row) => (
              <li key={row.requirementKey} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm text-ink">{row.label}</span>
                <span className="flex items-center gap-1">
                  {(['PRESENT', 'ABSENT', 'UNCHECKED'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={!canEdit || pending}
                      onClick={() => set(row.requirementKey, status)}
                      aria-pressed={row.status === status}
                      className={cn(
                        'rounded px-2 py-1 text-xs transition-colors disabled:opacity-50',
                        row.status === status
                          ? status === 'PRESENT' ? 'bg-green-bg text-green font-medium'
                            : status === 'ABSENT' ? 'bg-red-bg text-red font-medium'
                            : 'bg-surface-2 text-ink-2 font-medium'
                          : 'text-ink-3 hover:bg-surface-2',
                        busy === row.requirementKey && 'opacity-50',
                      )}
                    >
                      {status === 'PRESENT' ? 'In packet' : status === 'ABSENT' ? 'Missing' : 'Not checked'}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {error && <p role="alert" className="rounded bg-red-bg px-3 py-2 text-xs text-red">{error}</p>}
    </div>
  )
}

export function RerunTriageButton({ referralId, action }: {
  referralId: string
  action: (input: unknown) => Promise<ActionResult<unknown>>
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null)
          start(async () => {
            const result = await action({ referralId })
            if (result.ok) router.refresh()
            else setError(result.message)
          })
        }}
        className="btn-secondary text-xs"
      >
        {pending ? 'Running…' : 'Re-run triage'}
      </button>
      {error && <p role="alert" className="mt-2 rounded bg-red-bg px-3 py-2 text-xs text-red">{error}</p>}
    </div>
  )
}
