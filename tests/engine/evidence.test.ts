import { describe, expect, it, afterEach } from 'vitest'
import { run, repository } from './helpers'
import { analyse } from '@/lib/coding/pipeline'
import { buildHighlights, locateQuote } from '@/lib/coding/evidence'
import { clearExtractionProviderOverride, setExtractionProvider } from '@/lib/coding/ai'
import type { CodingResult } from '@/lib/coding/result'

/**
 * Tracing a fact back to the words that produced it.
 *
 * The property that matters: a highlighted span must actually contain the
 * text it claims to. A span pointing at the wrong words would be worse than
 * no span at all, because it looks authoritative.
 */

function factFor(result: CodingResult, label: string) {
  return result.procedures.flatMap((p) => p.factsUsed).find((f) => f.label === label)
}

/** Every span must sit inside the source and quote it exactly. */
function assertSpansAreHonest(result: CodingResult) {
  const source = result.evidence.source
  for (const procedure of result.procedures) {
    for (const fact of procedure.factsUsed) {
      for (const s of fact.spans) {
        expect(s.start).toBeGreaterThanOrEqual(0)
        expect(s.end).toBeLessThanOrEqual(source.length)
        expect(s.start).toBeLessThan(s.end)
        expect(source.slice(s.start, s.end)).toBe(s.text)
      }
    }
  }
}

describe('facts point at the words that produced them', () => {
  it('traces the tooth and the surfaces to their own spans', async () => {
    const result = await run('MOD composite #30')
    assertSpansAreHonest(result)

    const tooth = factFor(result, 'Tooth')
    // The '#' marker is included so the highlight covers "#30" as one token.
    expect(tooth?.spans.map((s) => s.text)).toContain('#30')
    expect(tooth?.origin).toBe('matched')

    const surfaces = factFor(result, 'Surfaces')
    expect(surfaces?.spans.map((s) => s.text)).toContain('MOD')
  })

  it('traces the material', async () => {
    const result = await run('MOD composite #30')
    const material = factFor(result, 'Material')
    expect(material?.spans.map((s) => s.text.toLowerCase())).toContain('composite')
  })

  it('traces the reason for treatment', async () => {
    const result = await run('#19 crown, recurrent decay under the old crown, zirconia')
    assertSpansAreHonest(result)
    const reason = factFor(result, 'Reason for treatment')
    expect(reason?.spans.length).toBeGreaterThan(0)
    expect(reason?.spans.map((s) => s.text.toLowerCase()).join(' ')).toContain('recurrent decay')
  })

  it('gives derived facts no span, and says they are derived', async () => {
    const result = await run('MOD composite #30')

    const position = factFor(result, 'Tooth position')
    expect(position?.value).toBe('posterior')
    // Nobody wrote "posterior" — it follows from #30 being a molar.
    expect(position?.spans).toHaveLength(0)
    expect(position?.origin).toBe('derived')
  })

  it('keeps each tooth with its own procedure across a multi-procedure note', async () => {
    const result = await run('#3 MOD composite and #19 DO amalgam')
    assertSpansAreHonest(result)

    const composite = result.procedures.find((p) => p.procedureSummary.includes('Composite'))
    const amalgam = result.procedures.find((p) => p.procedureSummary.includes('Amalgam'))

    const compositeTooth = composite?.factsUsed.find((f) => f.label === 'Tooth')
    const amalgamTooth = amalgam?.factsUsed.find((f) => f.label === 'Tooth')

    expect(compositeTooth?.spans.map((s) => s.text)).toContain('#3')
    expect(amalgamTooth?.spans.map((s) => s.text)).toContain('#19')

    // The spans must be at different places in the source, not the same "3".
    const compositeStart = compositeTooth?.spans[0]?.start ?? -1
    const amalgamStart = amalgamTooth?.spans[0]?.start ?? -1
    expect(compositeStart).not.toBe(amalgamStart)
    expect(amalgamStart).toBeGreaterThan(compositeStart)
  })

  it('holds up on a long prose note', async () => {
    const note = `Patient presented for restorative treatment on tooth #30.
Existing MOD amalgam was removed. Recurrent decay was found beneath the
restoration and excavated. MOD composite restoration placed.`

    const result = await run(note)
    assertSpansAreHonest(result)
    expect(factFor(result, 'Tooth')?.spans.length).toBeGreaterThan(0)
  })
})

describe('the highlight runs', () => {
  it('cover the source exactly once, in order', async () => {
    const result = await run('MOD composite #30')
    const rebuilt = result.evidence.segments.map((s) => s.text).join('')
    expect(rebuilt).toBe(result.evidence.source)
  })

  it('attributes a shared span to every fact that claims it', () => {
    const source = 'MOD composite #30'
    const segments = buildHighlights(source, [
      { factKey: 'a', spans: [{ start: 0, end: 3, text: 'MOD' }] },
      { factKey: 'b', spans: [{ start: 0, end: 3, text: 'MOD' }] },
    ])
    const marked = segments.find((s) => s.text === 'MOD')
    expect(marked?.factKeys.sort()).toEqual(['a', 'b'])
  })

  it('leaves untraced text unattributed', () => {
    const source = 'hello world'
    const segments = buildHighlights(source, [
      { factKey: 'a', spans: [{ start: 0, end: 5, text: 'hello' }] },
    ])
    expect(segments.find((s) => s.text.includes('world'))?.factKeys).toEqual([])
  })
})

describe('locating a quote the model returned', () => {
  it('finds an exact quote', () => {
    const found = locateQuote('MOD composite on #30', 'composite')
    expect(found?.text).toBe('composite')
  })

  it('finds a quote the model re-wrapped', () => {
    const found = locateQuote('MOD composite\n   on #30', 'composite on')
    expect(found).not.toBeNull()
    expect(found?.text).toContain('composite')
  })

  it('returns null rather than guessing when the quote is absent', () => {
    expect(locateQuote('MOD composite #30', 'zirconia crown')).toBeNull()
  })
})

describe('an unlocatable model quote', () => {
  afterEach(() => clearExtractionProviderOverride())

  it('is marked unlocated rather than highlighted approximately', async () => {
    setExtractionProvider({
      name: 'stub',
      async extract() {
        return {
          extraction: {
            procedures: [
              {
                procedure_kind: 'crown',
                tooth_numbers: [],
                surfaces: [],
                materials: ['zirconia'],
                existing_restoration: null,
                is_replacement: null,
                clinical_reasons: [],
                image_count: null,
                quadrants: [],
                arches: [],
                attributes: {},
                // A quote that does not appear in the input at all.
                source_text: 'text the user never wrote',
              },
            ],
            dentition: null,
            age_band: null,
            ambiguities: [],
          },
          usage: {
            provider: 'stub',
            model: 'stub',
            inputTokens: 0,
            outputTokens: 0,
            costMillicents: 0,
            latencyMs: 0,
            success: true,
          },
        }
      },
    })

    const { result } = await analyse('crown #19', { repository })
    assertSpansAreHonest(result)

    const material = factFor(result, 'Material')
    expect(material?.value).toContain('zirconia')
    expect(material?.spans).toHaveLength(0)
    expect(material?.origin).toBe('unlocated')
  })
})
