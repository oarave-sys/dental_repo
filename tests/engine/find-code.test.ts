import { describe, expect, it } from 'vitest'
import { codesOf, questionKeys, run } from './helpers'

/**
 * The behaviours the product promises, expressed as tests.
 *
 * These are not unit tests of individual functions — they exercise the whole
 * pipeline from free text to validated output, because the promises being
 * checked ("ask rather than guess", "never invent a code") are properties of
 * the pipeline, not of any one step.
 */

describe('1. a fully specified restoration', () => {
  it('codes MOD composite #30 as a three-surface posterior composite', async () => {
    const result = await run('MOD composite #30')

    expect(codesOf(result)).toEqual(['D2393'])
    expect(result.confidence).toBe('HIGH')
    expect(result.status).toBe('COMPLETE')
    expect(result.followUpQuestions).toHaveLength(0)
  })

  it('counts the surfaces deterministically and shows its working', async () => {
    const result = await run('MOD composite #30')
    const facts = result.factsUsed

    expect(facts.find((f) => f.label === 'Tooth')?.value).toBe('#30')
    expect(facts.find((f) => f.label === 'Surface count')?.value).toBe('3')
    expect(facts.find((f) => f.label === 'Material')?.value).toContain('composite')
    // Every recommendation must be explainable in terms of supplied facts.
    expect(result.recommendedCodes[0]?.matchedOn.join(' ')).toContain('3 surfaces')
  })
})

describe('2. insufficient information triggers a question, not a guess', () => {
  it('asks which surfaces were restored on #12 instead of picking a code', async () => {
    const result = await run('Composite #12')

    expect(result.status).toBe('NEEDS_INPUT')
    expect(codesOf(result)).toHaveLength(0)
    expect(questionKeys(result)).toContain('surfaces')
    expect(result.followUpQuestions[0]?.question).toMatch(/surface/i)
    expect(result.followUpQuestions[0]?.question).toContain('#12')
  })

  it('never claims high confidence while a distinguishing fact is unknown', async () => {
    const result = await run('Composite #12')
    expect(result.confidence).toBe('LOW')
  })

  it('resolves to a single code once the surfaces are answered', async () => {
    const first = await run('Composite #12')
    const key = first.followUpQuestions.find((q) => q.factKey === 'surfaces')?.key
    expect(key).toBeDefined()

    const answered = await run('Composite #12', { answers: { [key!]: 'MO' } })

    // #12 is a premolar, so posterior; two surfaces -> two-surface posterior.
    expect(codesOf(answered)).toEqual(['D2392'])
    expect(answered.confidence).toBe('HIGH')
    expect(answered.status).toBe('COMPLETE')
  })
})

describe('3. multiple procedures in one description', () => {
  it('recognises all four services in "exam bwx cleaning fluoride"', async () => {
    const result = await run('exam bwx cleaning fluoride')

    const kinds = result.procedures.map((p) => p.procedureSummary)
    expect(kinds).toHaveLength(4)
    expect(kinds.join(' ')).toMatch(/evaluation/i)
    expect(kinds.join(' ')).toMatch(/bitewing/i)
    expect(kinds.join(' ')).toMatch(/prophylaxis/i)
    expect(kinds.join(' ')).toMatch(/fluoride/i)
  })

  it('asks a separate question per unresolved service', async () => {
    const result = await run('exam bwx cleaning fluoride')

    expect(questionKeys(result)).toContain('image_count')
    expect(questionKeys(result)).toContain('evaluation_type')
    expect(questionKeys(result)).toContain('fluoride_form')
    // One question per distinction, never the same question twice.
    const texts = result.followUpQuestions.map((q) => q.question)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('codes a fully specified preventive visit without asking anything', async () => {
    const result = await run('adult prophy and fluoride varnish')

    expect(codesOf(result)).toContain('D1110')
    expect(codesOf(result)).toContain('D1206')
    expect(result.followUpQuestions).toHaveLength(0)
  })
})

describe('4. crown replacement', () => {
  it('codes a zirconia crown and captures the reason for replacement', async () => {
    const result = await run(
      '#19 crown replaced because old crown fractured and recurrent decay present, new zirconia crown',
    )

    expect(codesOf(result)).toEqual(['D2740'])
    expect(result.confidence).toBe('HIGH')

    const facts = result.factsUsed
    expect(facts.find((f) => f.label === 'Tooth')?.value).toBe('#19')
    expect(facts.find((f) => f.label === 'Reason for treatment')?.value).toContain('recurrent decay')
    expect(facts.find((f) => f.label === 'New or replacement')?.value).toBe('replacement')
  })

  it('does not ask a crown which surfaces were restored', async () => {
    const result = await run('#19 zirconia crown, existing crown fractured')
    expect(questionKeys(result)).not.toContain('surfaces')
  })
})

describe('7. a relevant tooth number is missing', () => {
  it('asks for the tooth rather than coding without one', async () => {
    const result = await run('MOD composite placed')

    expect(codesOf(result)).toHaveLength(0)
    expect(result.status).toBe('NEEDS_INPUT')
    expect(questionKeys(result)).toContain('tooth_numbers')
  })
})

describe('8. an ambiguous procedure', () => {
  it('asks which kind of evaluation was performed', async () => {
    const result = await run('exam today')

    expect(questionKeys(result)).toContain('evaluation_type')
    const question = result.followUpQuestions.find((q) => q.factKey === 'evaluation_type')
    expect(question?.options).toContain('Periodic (recall)')
    expect(codesOf(result)).toHaveLength(0)
  })

  it('asks the extraction technique before choosing between simple and surgical', async () => {
    const result = await run('extracted #1')

    expect(questionKeys(result)).toContain('extraction_complexity')
    expect(codesOf(result)).toHaveLength(0)
  })

  it('codes a simple extraction once the technique is documented', async () => {
    const result = await run('#1 erupted, extracted with forceps, no bone removal or sectioning')
    expect(codesOf(result)).toEqual(['D7140'])
  })
})

describe('9. multiple procedures across multiple teeth', () => {
  it('keeps each tooth with its own procedure', async () => {
    const result = await run('#3 MOD composite and #19 DO amalgam')

    expect(result.procedures).toHaveLength(2)
    expect(codesOf(result)).toEqual(['D2393', 'D2150'])

    const composite = result.procedures.find((p) => p.procedureSummary.includes('Composite'))
    const amalgam = result.procedures.find((p) => p.procedureSummary.includes('Amalgam'))
    expect(composite?.procedureSummary).toContain('#3')
    expect(amalgam?.procedureSummary).toContain('#19')
    // The teeth must not leak across procedures.
    expect(composite?.procedureSummary).not.toContain('#19')
    expect(amalgam?.procedureSummary).not.toContain('#3')
  })
})

describe('surface and tooth validation', () => {
  it('rejects a tooth number that does not exist', async () => {
    const result = await run('composite #45 MO')

    const warnings = result.warnings.map((w) => w.message).join(' ')
    expect(warnings).toMatch(/not a valid tooth number/i)
  })

  it('flags an occlusal surface recorded on an anterior tooth', async () => {
    const result = await run('MOD composite #8')

    const warnings = result.warnings.map((w) => w.message).join(' ')
    expect(warnings).toMatch(/anterior tooth/i)
    expect(warnings).toMatch(/occlusal/i)
  })

  it('does not read "moderate" as mesial-occlusal-distal', async () => {
    const result = await run('#30 moderate decay noted, composite placed, occlusal only')

    const surfaces = result.factsUsed.find((f) => f.label === 'Surfaces')?.value ?? ''
    expect(surfaces).not.toContain('M')
    expect(surfaces).toContain('O')
  })
})
