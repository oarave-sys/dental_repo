import { cn } from './index'

export type TriageOutcome =
  | 'GREEN' | 'YELLOW' | 'RED' | 'INCOMPLETE' | 'UNKNOWN' | 'REVIEW' | 'NO_EFFECT'

const OUTCOME: Record<TriageOutcome, { label: string; className: string }> = {
  GREEN: { label: 'Good to schedule', className: 'bg-green-bg text-green' },
  YELLOW: { label: 'Physician review', className: 'bg-amber-bg text-amber' },
  RED: { label: 'Not accepted', className: 'bg-red-bg text-red' },
  INCOMPLETE: { label: 'Incomplete', className: 'bg-amber-bg text-amber' },
  UNKNOWN: { label: 'Unknown', className: 'bg-slate-bg text-slate' },
  REVIEW: { label: 'Review', className: 'bg-amber-bg text-amber' },
  NO_EFFECT: { label: 'No effect', className: 'bg-surface-2 text-ink-3' },
}

export function DispositionBadge({ outcome, size = 'sm' }: {
  outcome: TriageOutcome
  size?: 'sm' | 'lg'
}) {
  const spec = OUTCOME[outcome]
  return (
    <span className={cn(
      'inline-flex items-center whitespace-nowrap rounded font-medium',
      spec.className,
      size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs',
    )}>
      {spec.label}
    </span>
  )
}

/**
 * Confidence bands. The numbers are heuristic, not calibrated probabilities,
 * and the explanation panel says so — see docs/ARCHITECTURE.md §7.4.
 */
export function bandFor(score: number): string {
  if (score >= 90) return 'Very high'
  if (score >= 75) return 'High'
  if (score >= 60) return 'Moderate'
  if (score >= 40) return 'Low'
  return 'Insufficient'
}

export function ConfidenceMeter({ score, label }: { score: number; label: string }) {
  const tone =
    score >= 75 ? 'bg-green' : score >= 60 ? 'bg-brand' : score >= 40 ? 'bg-amber' : 'bg-red'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-3">{label}</span>
        <span className="tnum text-sm font-semibold text-ink">
          {score}
          <span className="ml-1 text-xs font-normal text-ink-3">{bandFor(score)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-2">
        <div className={cn('h-full rounded', tone)} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

export function DimensionRow({ dimension, outcome, summary, decisive }: {
  dimension: string
  outcome: TriageOutcome
  summary: string
  decisive: boolean
}) {
  return (
    <div className={cn(
      'grid grid-cols-[130px_120px_1fr] items-start gap-3 px-4 py-2.5 text-sm',
      decisive && 'bg-surface-2',
    )}>
      <span className="font-mono text-[11px] uppercase tracking-wide text-ink-3">
        {dimension.replaceAll('_', ' ')}
      </span>
      <span><DispositionBadge outcome={outcome} /></span>
      <span className="text-ink-2">
        {summary}
        {decisive && <span className="ml-2 text-xs text-brand">decided this</span>}
      </span>
    </div>
  )
}
