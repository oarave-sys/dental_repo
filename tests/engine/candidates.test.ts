import { describe, expect, it } from 'vitest'
import { run } from './helpers'

/**
 * Showing what is still possible, side by side.
 *
 * The comparison has to state the real difference between the codes — read
 * off their attributes — rather than restating the question in a table.
 */

describe('when several codes remain possible', () => {
  it('lists the surviving candidates with the values that separate them', async () => {
    const result = await run('Composite #12')
    const procedure = result.procedures[0]
    const choice = procedure?.choice

    expect(choice).not.toBeNull()
    expect(choice?.distinguishingFactKeys).toContain('surfaces')

    const codes = choice?.candidates.map((c) => c.code) ?? []
    expect(codes).toContain('D2391')
    expect(codes).toContain('D2392')
    expect(codes).toContain('D2393')
    expect(codes).toContain('D2394')
  })

  it('shows each candidate its own surface count, not the same value', async () => {
    const result = await run('Composite #12')
    const candidates = result.procedures[0]?.choice?.candidates ?? []

    const byCode = new Map(candidates.map((c) => [c.code, c.distinguishingValues.surfaces]))
    expect(byCode.get('D2391')).toBe('1 surface')
    expect(byCode.get('D2392')).toBe('2 surfaces')
    expect(byCode.get('D2393')).toBe('3 surfaces')
    expect(byCode.get('D2394')).toContain('four or more')
  })

  it('names what the choice depends on', async () => {
    const result = await run('Composite #12')
    const note = result.procedures[0]?.choice?.specificityNote ?? ''

    expect(note).toMatch(/depends on/i)
    expect(note).toMatch(/surfaces/i)
    expect(note).toMatch(/4 candidates/i)
  })

  it('keeps the targeted question alongside the comparison', async () => {
    const result = await run('Composite #12')

    expect(result.procedures[0]?.choice).not.toBeNull()
    expect(result.followUpQuestions.map((q) => q.factKey)).toContain('surfaces')
  })

  it('marks the leading candidate', async () => {
    const result = await run('Composite #12')
    const candidates = result.procedures[0]?.choice?.candidates ?? []
    expect(candidates.filter((c) => c.leading)).toHaveLength(1)
  })

  it('compares evaluation types for an ambiguous exam', async () => {
    const result = await run('exam today')
    const choice = result.procedures[0]?.choice

    expect(choice?.distinguishingFactKeys).toContain('evaluation_type')
    const values = choice?.candidates.map((c) => c.distinguishingValues.evaluation_type) ?? []
    expect(values).toContain('periodic')
    expect(values).toContain('comprehensive')
    expect(values).toContain('limited')
  })
})

describe('when the answer is settled', () => {
  it('shows no comparison for a single confident recommendation', async () => {
    const result = await run('MOD composite #30')
    expect(result.procedures[0]?.choice).toBeNull()
    expect(result.procedures[0]?.awaitingAnswer).toBe(false)
  })

  it('drops the comparison once the surfaces are supplied', async () => {
    const first = await run('Composite #12')
    const key = first.followUpQuestions.find((q) => q.factKey === 'surfaces')?.key

    const answered = await run('Composite #12', { answers: { [key!]: 'MO' } })
    expect(answered.procedures[0]?.choice).toBeNull()
    expect(answered.recommendedCodes.map((c) => c.code)).toEqual(['D2392'])
  })
})
