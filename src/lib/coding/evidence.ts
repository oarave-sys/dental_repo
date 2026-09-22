/**
 * Evidence: the span of the user's own text that produced a fact.
 *
 * The point is that no recommendation should be unfalsifiable. A coder who can
 * see that "#30" came from characters 14-17 of what they typed can check the
 * engine's reading in a second; one who is shown only a conclusion has to take
 * it on trust.
 *
 * Spans are half-open [start, end) offsets into the ORIGINAL input string, so
 * the UI can highlight without re-parsing anything.
 */

export interface SourceSpan {
  start: number
  end: number
  /** The exact substring, carried so a span can be verified after the fact. */
  text: string
}

/** Where a fact's evidence came from. */
export type EvidenceOrigin =
  /** A rule matched this span directly. Offsets are exact. */
  | 'matched'
  /** The model quoted this text; we located the quote in the input. */
  | 'quoted'
  /** Derived from another fact rather than read from the text (e.g. #30 is posterior). */
  | 'derived'
  /** The model supplied it but the quote could not be located. */
  | 'unlocated'

export function span(text: string, start: number, end: number): SourceSpan {
  return { start, end, text: text.slice(start, end) }
}

/**
 * Merges overlapping or touching spans so highlighting never double-marks.
 *
 * Offsets only — `text` is recomputed by `reconcile` against the real source
 * rather than spliced together here, so the two can never disagree.
 */
export function mergeSpans(spans: readonly SourceSpan[]): SourceSpan[] {
  if (spans.length === 0) return []
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: SourceSpan[] = []

  for (const next of sorted) {
    const last = out[out.length - 1]
    if (last && next.start <= last.end) {
      if (next.end > last.end) last.end = next.end
    } else {
      out.push({ ...next })
    }
  }
  return out
}

/** Rebuilds span text from the source, guaranteeing offsets and text agree. */
export function reconcile(source: string, spans: readonly SourceSpan[]): SourceSpan[] {
  return mergeSpans(spans)
    .filter((s) => s.start >= 0 && s.end <= source.length && s.start < s.end)
    .map((s) => ({ start: s.start, end: s.end, text: source.slice(s.start, s.end) }))
}

/**
 * Locates a quoted fragment in the source.
 *
 * Used for facts the language model supplied: it returns the text it read, and
 * we find that text rather than trusting an offset it might have invented.
 * Whitespace is normalised on both sides because a model routinely re-wraps a
 * quote. Returns null when the quote cannot be found, and the caller then
 * marks the fact `unlocated` instead of highlighting the wrong thing.
 */
export function locateQuote(source: string, quote: string): SourceSpan | null {
  const needle = quote.trim()
  if (!needle) return null

  const direct = source.toLowerCase().indexOf(needle.toLowerCase())
  if (direct >= 0) return span(source, direct, direct + needle.length)

  // Whitespace-insensitive search: build a regex from the quote's words.
  const words = needle.split(/\s+/).filter(Boolean).map(escapeRegExp)
  if (words.length === 0) return null
  const loose = new RegExp(words.join('\\s+'), 'i')
  const m = loose.exec(source)
  if (!m || m.index === undefined) return null
  return span(source, m.index, m.index + m[0].length)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One segment of the source, for rendering: either plain or highlighted. */
export interface HighlightSegment {
  text: string
  /** Fact keys whose evidence covers this segment. Empty means plain text. */
  factKeys: string[]
}

/**
 * Splits the source into runs for rendering.
 *
 * Produces a flat list rather than nested markup so a span belonging to two
 * facts (the tooth and the procedure often overlap) renders once, attributed
 * to both, instead of as broken nested highlights.
 */
export function buildHighlights(
  source: string,
  evidence: ReadonlyArray<{ factKey: string; spans: readonly SourceSpan[] }>,
): HighlightSegment[] {
  // Collect every boundary, then walk the source between them.
  const boundaries = new Set<number>([0, source.length])
  for (const item of evidence) {
    for (const s of item.spans) {
      if (s.start >= 0 && s.end <= source.length && s.start < s.end) {
        boundaries.add(s.start)
        boundaries.add(s.end)
      }
    }
  }

  const points = [...boundaries].sort((a, b) => a - b)
  const out: HighlightSegment[] = []

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]
    const end = points[i + 1]
    if (start === undefined || end === undefined || start >= end) continue

    const factKeys = evidence
      .filter((item) => item.spans.some((s) => s.start <= start && s.end >= end))
      .map((item) => item.factKey)

    const text = source.slice(start, end)
    const previous = out[out.length - 1]
    // Merge adjacent runs carrying the same attribution.
    if (previous && sameKeys(previous.factKeys, factKeys)) previous.text += text
    else out.push({ text, factKeys: [...new Set(factKeys)] })
  }

  return out
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((k) => setB.has(k))
}
