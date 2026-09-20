import { describe, expect, it } from 'vitest'
import { documentationCheck } from '@/lib/coding/tools'
import { repository } from './helpers'

const NOTE_COMPLETE = `Patient presented for restorative treatment on tooth #30.
Existing MOD amalgam was removed. Recurrent decay was found beneath the
restoration and excavated. MOD composite restoration placed and finished.`

const NOTE_MISSING_REASON = `Patient presented for restorative treatment on tooth #30.
Existing restoration removed. MOD composite restoration placed and finished.`

describe('Documentation Check', () => {
  it('identifies the procedure and recommends a code from a full note', async () => {
    const { result } = await documentationCheck({ note: NOTE_COMPLETE }, {
      repository,
      useAi: false,
    })

    expect(result.procedures[0]?.procedureSummary).toMatch(/composite/i)
    expect(result.recommendedCodes.map((c) => c.code)).toEqual(['D2393'])
    expect(result.confidence).toBe('HIGH')
  })

  it('lists the coding-relevant elements it found', async () => {
    const { result } = await documentationCheck({ note: NOTE_COMPLETE }, {
      repository,
      useAi: false,
    })

    const present = result.documentation.present.map((p) => p.label)
    expect(present).toContain('Tooth number')
    expect(present).toContain('Surfaces restored')
    expect(present).toContain('Restorative material')
  })

  it('reports an undocumented reason without telling anyone to write one', async () => {
    const { result } = await documentationCheck({ note: NOTE_MISSING_REASON }, {
      repository,
      useAi: false,
    })

    const gaps = [...result.documentation.needsReview, ...result.documentation.claimSupport]
    const reason = gaps.find((g) => g.factKey === 'clinical_reasons')

    expect(reason).toBeDefined()
    expect(reason?.detail).toMatch(/not documented/i)
    expect(reason?.detail).toMatch(/record only what was actually found|what was the clinical finding/i)
    expect(reason?.detail).not.toMatch(/add that|state that recurrent/i)
  })

  it('scores a complete note above an incomplete one', async () => {
    const complete = await documentationCheck({ note: NOTE_COMPLETE }, { repository, useAi: false })
    const partial = await documentationCheck({ note: NOTE_MISSING_REASON }, { repository, useAi: false })

    expect(complete.result.documentation.percentage).toBeGreaterThan(
      partial.result.documentation.percentage,
    )
  })

  it('compares a supplied code against the note', async () => {
    const { result } = await documentationCheck(
      { note: NOTE_COMPLETE, selectedCodes: ['D2392'] },
      { repository, useAi: false },
    )

    const conflict = result.warnings.find((w) => w.severity === 'CONFLICT')
    expect(conflict?.message).toContain('D2392')
  })

  it('handles a multi-procedure note', async () => {
    const note = `Recall visit. Periodic evaluation completed. Four bitewing
    radiographs taken. Adult prophylaxis performed and fluoride varnish applied.`

    const { result } = await documentationCheck({ note }, { repository, useAi: false })
    const codes = result.recommendedCodes.map((c) => c.code)

    expect(codes).toContain('D0120')
    expect(codes).toContain('D0274')
    expect(codes).toContain('D1110')
    expect(codes).toContain('D1206')
  })
})
