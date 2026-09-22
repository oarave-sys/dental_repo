'use client'

import { useState } from 'react'
import type { CodingResult, ProcedureResult } from '@/lib/coding/result'
import type { DisplayFact } from '@/lib/coding/facts'
import { Card, SectionTitle } from './ui'

/**
 * Shows the user's own words with the spans that produced each fact marked.
 *
 * A recommendation nobody can check is worth very little. Hovering or focusing
 * a fact lights up the exact words it came from, and hovering the text lights
 * up the facts it produced — so verifying the engine's reading takes a second
 * rather than a re-read.
 *
 * Derived facts (#30 is posterior) deliberately have no highlight, and say so.
 * A fact the model quoted but we could not locate says that too, rather than
 * highlighting an approximate guess.
 */
export function EvidencePanel({ result }: { result: CodingResult }) {
  const [activeKey, setActiveKey] = useState<string | null>(null)

  if (!result.evidence.source.trim() || result.evidence.segments.length === 0) return null

  const traceable = result.procedures.some((p) => p.factsUsed.some((f) => f.spans.length > 0))
  if (!traceable) return null

  return (
    <Card className="p-5">
      <SectionTitle>Where this came from</SectionTitle>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Hover a fact to see the words it was read from.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-3">What you entered</p>
          <p className="whitespace-pre-wrap rounded-lg border border-rule bg-surface-2/40 px-3.5 py-3 text-[15px] leading-relaxed text-ink-2">
            {result.evidence.segments.map((segment, i) => {
              const isActive = activeKey !== null && segment.factKeys.includes(activeKey)
              const isTraced = segment.factKeys.length > 0
              if (!isTraced) return <span key={i}>{segment.text}</span>
              return (
                <mark
                  key={i}
                  onMouseEnter={() => setActiveKey(segment.factKeys[0] ?? null)}
                  onMouseLeave={() => setActiveKey(null)}
                  className={`rounded px-0.5 transition-colors ${
                    isActive
                      ? 'bg-brand text-white'
                      : activeKey === null
                        ? 'bg-brand-soft text-brand'
                        : 'bg-surface-2 text-ink-3'
                  }`}
                >
                  {segment.text}
                </mark>
              )
            })}
          </p>
        </div>

        <div className="space-y-4">
          {result.procedures.map((procedure) => (
            <FactList
              key={procedure.intentId}
              procedure={procedure}
              showHeading={result.procedures.length > 1}
              activeKey={activeKey}
              onActivate={setActiveKey}
            />
          ))}
        </div>
      </div>
    </Card>
  )
}

function FactList({
  procedure,
  showHeading,
  activeKey,
  onActivate,
}: {
  procedure: ProcedureResult
  showHeading: boolean
  activeKey: string | null
  onActivate: (key: string | null) => void
}) {
  if (procedure.factsUsed.length === 0) return null

  return (
    <div>
      {showHeading && (
        <p className="mb-1.5 text-xs font-medium text-ink-3">{procedure.procedureSummary}</p>
      )}
      <ul className="space-y-1">
        {procedure.factsUsed.map((fact, i) => (
          <FactRow
            key={`${fact.factKey}-${i}`}
            fact={fact}
            traceKey={`${procedure.intentId}:${fact.factKey}`}
            activeKey={activeKey}
            onActivate={onActivate}
          />
        ))}
      </ul>
    </div>
  )
}

function FactRow({
  fact,
  traceKey,
  activeKey,
  onActivate,
}: {
  fact: DisplayFact
  traceKey: string
  activeKey: string | null
  onActivate: (key: string | null) => void
}) {
  const traceable = fact.spans.length > 0
  const isActive = activeKey === traceKey

  return (
    <li
      onMouseEnter={() => traceable && onActivate(traceKey)}
      onMouseLeave={() => traceable && onActivate(null)}
      onFocus={() => traceable && onActivate(traceKey)}
      onBlur={() => traceable && onActivate(null)}
      tabIndex={traceable ? 0 : -1}
      data-evidence-fact={fact.factKey}
      className={`flex gap-2 rounded px-2 py-1 text-sm outline-none transition-colors ${
        traceable ? 'cursor-default' : ''
      } ${isActive ? 'bg-brand-soft' : ''} focus-visible:ring-2 focus-visible:ring-brand-ring`}
    >
      <span className="min-w-[7rem] shrink-0 text-ink-3">{fact.label}</span>
      <span className="text-ink-2">
        {fact.value}
        <OriginNote fact={fact} />
      </span>
    </li>
  )
}

function OriginNote({ fact }: { fact: DisplayFact }) {
  switch (fact.origin) {
    case 'derived':
      return (
        <span className="ml-1.5 text-xs text-ink-3" title="Follows from another fact, not read from your text">
          derived
        </span>
      )
    case 'quoted':
      return (
        <span className="ml-1.5 text-xs text-ink-3" title="Located from the text the model quoted">
          from your note
        </span>
      )
    case 'unlocated':
      return (
        <span
          className="ml-1.5 text-xs text-medium"
          title="We could not point at the exact words this came from"
        >
          source not located
        </span>
      )
    default:
      return null
  }
}
