import type { CodingResult, DocumentationItem, ProcedureResult } from '@/lib/coding/result'
import { CATEGORY_LABELS } from '@/lib/coding/vocabulary'
import { Badge, Card, ConfidenceBadge, DatasetNotice, Disclaimer, SectionTitle } from './ui'

/**
 * Renders an analysis.
 *
 * The layout follows the order a coder actually thinks in: what code, how
 * sure, why, what we read from your words, what is missing. The "why" and the
 * facts sit next to the recommendation rather than behind a disclosure,
 * because a recommendation nobody can check is not worth making.
 */

export function CodingResultView({
  result,
  children,
}: {
  result: CodingResult
  children?: React.ReactNode
}) {
  const hasRecommendation = result.recommendedCodes.length > 0

  return (
    <div className="space-y-5">
      <DatasetNotice dataset={result.dataset} />

      {result.status === 'NEEDS_INPUT' && children}

      {hasRecommendation && (
        <div className="space-y-4">
          {result.procedures
            .filter((p) => p.recommended.length > 0)
            .map((procedure) => (
              <ProcedureCard key={procedure.intentId} procedure={procedure} />
            ))}
        </div>
      )}

      {!hasRecommendation && result.status === 'COMPLETE' && (
        <Card className="p-5">
          <p className="text-[15px] text-ink-2">
            No code could be identified from this description. Try adding what was done, which
            tooth was involved, and the material used.
          </p>
        </Card>
      )}

      {result.warnings.length > 0 && <WarningsPanel result={result} />}

      <DocumentationPanel result={result} />

      <Card className="p-5">
        <SectionTitle>Summary</SectionTitle>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{result.reasoningSummary}</p>
        {!result.aiAssisted && (
          <p className="mt-3 text-[13px] text-ink-3">
            Analysed with the built-in rules engine. Connect an Anthropic API key to also
            interpret longer free-text notes.
          </p>
        )}
      </Card>

      <Disclaimer />
    </div>
  )
}

function ProcedureCard({ procedure }: { procedure: ProcedureResult }) {
  const top = procedure.recommended[0]
  if (!top) return null

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-rule bg-surface-2/60 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-2">{procedure.procedureSummary}</p>
          {procedure.category && (
            <Badge>{CATEGORY_LABELS[procedure.category] ?? procedure.category}</Badge>
          )}
        </div>
      </div>

      <div className="px-5 py-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <p className="code-number text-3xl text-ink">{top.code}</p>
          <ConfidenceBadge level={top.confidence} />
        </div>

        <p className="mt-2 text-[15px] font-medium text-ink">{top.shortLabel}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{top.plainLanguage}</p>

        {top.officialDescriptor && (
          <div className="mt-3 rounded-lg border border-rule bg-surface-2/60 px-3.5 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Official descriptor
            </p>
            <p className="mt-1 text-sm text-ink-2">{top.officialDescriptor}</p>
          </div>
        )}

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <SectionTitle>Why</SectionTitle>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{top.why}</p>
          </div>

          <div>
            <SectionTitle>Facts identified</SectionTitle>
            <dl className="mt-2 space-y-1.5">
              {procedure.factsUsed.map((fact, i) => (
                <div key={`${fact.label}-${i}`} className="flex gap-2 text-sm">
                  <dt className="min-w-[7.5rem] shrink-0 text-ink-3">{fact.label}</dt>
                  <dd className="text-ink-2">
                    {fact.value}
                    {fact.source === 'derived' && (
                      <span className="ml-1.5 text-xs text-ink-3">(derived)</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {procedure.alternatives.length > 0 && (
          <div className="mt-5 border-t border-rule pt-4">
            <SectionTitle>Possible alternatives</SectionTitle>
            <ul className="mt-2 space-y-2.5">
              {procedure.alternatives.map((alt) => (
                <li key={alt.code} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <span className="code-number shrink-0 text-sm text-ink">{alt.code}</span>
                  <span className="text-sm text-ink-2">
                    <span className="font-medium text-ink">{alt.shortLabel}.</span>{' '}
                    {alt.distinction}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

function WarningsPanel({ result }: { result: CodingResult }) {
  const order = { CONFLICT: 0, REVIEW: 1, INFO: 2 } as const
  const sorted = [...result.warnings].sort((a, b) => order[a.severity] - order[b.severity])

  return (
    <Card className="p-5">
      <SectionTitle>Review before submission</SectionTitle>
      <ul className="mt-3 space-y-2.5">
        {sorted.map((warning, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">
              <Badge
                tone={
                  warning.severity === 'CONFLICT'
                    ? 'low'
                    : warning.severity === 'REVIEW'
                      ? 'medium'
                      : 'info'
                }
              >
                {warning.severity === 'CONFLICT'
                  ? 'Conflict'
                  : warning.severity === 'REVIEW'
                    ? 'Check'
                    : 'Note'}
              </Badge>
            </span>
            <span className="text-sm leading-relaxed text-ink-2">{warning.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * The documentation completeness indicator.
 *
 * The percentage is shown next to the weights it was computed from, and every
 * item that cost points is listed. A score nobody can account for would be
 * worse than no score.
 */
export function DocumentationPanel({ result }: { result: CodingResult }) {
  const doc = result.documentation
  // Written out rather than interpolated: Tailwind only keeps classes it can
  // see as complete strings in the source.
  const strong = doc.percentage >= 80
  const middling = doc.percentage >= 50
  const barColour = strong ? 'bg-high' : middling ? 'bg-medium' : 'bg-low'
  const textColour = strong ? 'text-high' : middling ? 'text-medium' : 'text-low'

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Documentation completeness</SectionTitle>
        <span className={`code-number text-lg ${textColour}`}>{doc.percentage}%</span>
      </div>

      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`Documentation completeness ${doc.percentage} percent`}
      >
        <div className={`h-full rounded-full ${barColour}`} style={{ width: `${doc.percentage}%` }} />
      </div>

      <p className="mt-2 text-[13px] text-ink-3">
        {doc.earnedWeight} of {doc.totalWeight} weighted coding elements documented. This
        measures coding specificity only — it is not an assessment of care.
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <ItemList title="Documented" items={doc.present} marker="check" />
        <div className="space-y-5">
          {doc.needsReview.length > 0 && (
            <ItemList title="Needs review" items={doc.needsReview} marker="question" />
          )}
          {doc.claimSupport.length > 0 && (
            <ItemList
              title="May support the claim"
              items={doc.claimSupport}
              marker="question"
              note="Not required to select the code. Whether a payer asks for it varies."
            />
          )}
        </div>
      </div>
    </Card>
  )
}

function ItemList({
  title,
  items,
  marker,
  note,
}: {
  title: string
  items: DocumentationItem[]
  marker: 'check' | 'question'
  note?: string
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {note && <p className="mt-1 text-[13px] text-ink-3">{note}</p>}
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={`${item.factKey}-${i}`} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden
              className={`mt-px shrink-0 font-semibold ${
                marker === 'check' ? 'text-high' : 'text-medium'
              }`}
            >
              {marker === 'check' ? '✓' : '?'}
            </span>
            <span className="leading-relaxed text-ink-2">{item.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
