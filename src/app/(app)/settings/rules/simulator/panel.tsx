'use client'

import { useState, useTransition } from 'react'
import type { ActionResult } from '@/lib/actions/guard'
import { Card, DataTable, EmptyState } from '@/components/ui'
import { DispositionBadge, type TriageOutcome } from '@/components/ui/triage'

interface Summary {
  version: number
  evaluated: number
  changed: number
  transitions: Array<{ from: string; to: string; count: number }>
  rows: Array<{
    referralId: string
    patientInitials: string
    receivedAt: string | Date
    current: string | null
    proposed: string
    changed: boolean
    reason: string
  }>
}

export function SimulatorPanel({ versions, action }: {
  versions: Array<{ id: string; version: number; status: string }>
  action: (input: unknown) => Promise<ActionResult<Summary>>
}) {
  const [selected, setSelected] = useState(versions[0]?.id ?? '')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[220px]">
            <span className="label">Rule set</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className="field">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>v{v.version} — {v.status.toLowerCase()}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !selected}
            className="btn-primary"
            onClick={() => {
              setError(null)
              start(async () => {
                const result = await action({ ruleSetVersionId: selected })
                if (result.ok) setSummary(result.data)
                else setError(result.message)
              })
            }}
          >
            {pending ? 'Simulating…' : 'Run simulation'}
          </button>
        </div>
        {error && <p role="alert" className="mt-3 rounded bg-red-bg px-3 py-2 text-sm text-red">{error}</p>}
      </Card>

      {summary && (
        <>
          <Card title={`Result — v${summary.version}`}>
            <div className="flex flex-wrap gap-8">
              <div>
                <div className="tnum text-2xl font-semibold text-ink">{summary.evaluated}</div>
                <div className="text-xs text-ink-3">referrals evaluated</div>
              </div>
              <div>
                <div className={`tnum text-2xl font-semibold ${summary.changed > 0 ? 'text-amber' : 'text-green'}`}>
                  {summary.changed}
                </div>
                <div className="text-xs text-ink-3">would change</div>
              </div>
            </div>

            {summary.transitions.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-sm">
                {summary.transitions.map((t, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="tnum w-8 text-right font-semibold text-ink">{t.count}</span>
                    <DispositionBadge outcome={t.from as TriageOutcome} />
                    <span className="text-ink-3" aria-hidden>→</span>
                    <DispositionBadge outcome={t.to as TriageOutcome} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="What would change">
            {summary.rows.length === 0 ? (
              <EmptyState
                title="Nothing changes under this rule set."
                hint="Safe to publish as far as these referrals are concerned."
              />
            ) : (
              <DataTable head={['Patient', 'Received', 'Now', 'Would become', 'Because']}>
                {summary.rows.map((row) => (
                  <tr key={row.referralId}>
                    {/* Initials only: policy review does not need patient names. */}
                    <td className="px-3 py-2 font-mono text-xs text-ink-2">{row.patientInitials}</td>
                    <td className="px-3 py-2 text-xs text-ink-3">
                      {new Date(row.receivedAt).toLocaleDateString('en-US')}
                    </td>
                    <td className="px-3 py-2">
                      {row.current
                        ? <DispositionBadge outcome={row.current as TriageOutcome} />
                        : <span className="text-xs text-ink-3">not triaged</span>}
                    </td>
                    <td className="px-3 py-2"><DispositionBadge outcome={row.proposed as TriageOutcome} /></td>
                    <td className="px-3 py-2 text-xs text-ink-2">{row.reason}</td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
