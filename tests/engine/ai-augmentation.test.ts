import { describe, expect, it, afterEach } from 'vitest'
import { analyse } from '@/lib/coding/pipeline'
import { clearExtractionProviderOverride, setExtractionProvider } from '@/lib/coding/ai'
import type { FactExtractionProvider } from '@/lib/coding/ai'
import { repository } from './helpers'

/**
 * How the language model and the rules engine combine.
 *
 * These use a stub provider rather than the live API: the merge policy is the
 * thing worth pinning down, and it should behave identically whichever model
 * produced the extraction. The live call itself is a thin wrapper around
 * client.messages.parse and needs ANTHROPIC_API_KEY to exercise.
 *
 * The policy under test: the model may ADD facts the rules missed; it may
 * never overwrite one they found.
 */

const usage = {
  provider: 'stub',
  model: 'stub',
  inputTokens: 100,
  outputTokens: 50,
  costMillicents: 175,
  latencyMs: 12,
  success: true,
}

function provider(procedures: unknown[]): FactExtractionProvider {
  return {
    name: 'stub',
    async extract() {
      return {
        extraction: {
          procedures: procedures as never,
          dentition: null,
          age_band: null,
          ambiguities: [],
        },
        usage,
      }
    },
  }
}

const base = {
  tooth_numbers: [],
  surfaces: [],
  materials: [],
  existing_restoration: null,
  is_replacement: null,
  clinical_reasons: [],
  image_count: null,
  quadrants: [],
  arches: [],
  attributes: {},
  source_text: '',
}

afterEach(() => clearExtractionProviderOverride())

describe('the model fills gaps the rules could not', () => {
  it('supplies a procedure the rules did not recognise', async () => {
    // Prose the keyword matcher has no pattern for.
    setExtractionProvider(
      provider([
        {
          ...base,
          procedure_kind: 'crown',
          tooth_numbers: ['19'],
          materials: ['zirconia'],
          source_text: 'full coverage unit seated on the lower left six',
        },
      ]),
    )

    const { result } = await analyse('full coverage unit seated on the lower left six', {
      repository,
    })

    expect(result.aiAssisted).toBe(true)
    expect(result.recommendedCodes.map((c) => c.code)).toEqual(['D2740'])
  })

  it('reports token usage and cost for the request', async () => {
    setExtractionProvider(provider([{ ...base, procedure_kind: 'prophylaxis' }]))
    const { usage: reported } = await analyse('cleaning', { repository })

    expect(reported?.inputTokens).toBe(100)
    expect(reported?.costMillicents).toBe(175)
  })
})

describe('the model cannot overwrite a fact the rules established', () => {
  it('keeps the rule-extracted surfaces when the model disagrees', async () => {
    setExtractionProvider(
      provider([
        {
          ...base,
          procedure_kind: 'composite_restoration',
          tooth_numbers: ['30'],
          // The model claims four surfaces; the note plainly says three.
          surfaces: ['M', 'O', 'D', 'B'],
          materials: ['composite'],
        },
      ]),
    )

    const { result } = await analyse('MOD composite #30', { repository })

    const count = result.factsUsed.find((f) => f.label === 'Surface count')?.value
    expect(count).toBe('3')
    expect(result.recommendedCodes.map((c) => c.code)).toEqual(['D2393'])
  })

  it('keeps the rule-extracted tooth when the model disagrees', async () => {
    setExtractionProvider(
      provider([
        {
          ...base,
          procedure_kind: 'composite_restoration',
          tooth_numbers: ['8'],
          surfaces: ['M', 'O'],
          materials: ['composite'],
        },
      ]),
    )

    const { result } = await analyse('MO composite #30', { repository })

    expect(result.factsUsed.find((f) => f.label === 'Tooth')?.value).toBe('#30')
    // #30 is posterior, so the posterior family applies — not the anterior one
    // the model's tooth would have selected.
    expect(result.recommendedCodes.map((c) => c.code)).toEqual(['D2392'])
  })

  it('discards a tooth number that is not a real tooth', async () => {
    setExtractionProvider(
      provider([
        {
          ...base,
          procedure_kind: 'composite_restoration',
          tooth_numbers: ['45', 'Z', '0'],
          surfaces: ['M', 'O'],
          materials: ['composite'],
        },
      ]),
    )

    const { result } = await analyse('composite placed', { repository })

    expect(JSON.stringify(result)).not.toContain('#45')
    // With no valid tooth, the engine asks rather than proceeding.
    expect(result.followUpQuestions.map((q) => q.factKey)).toContain('tooth_numbers')
  })

  it('does not accept surfaces for a procedure that has none', async () => {
    setExtractionProvider(
      provider([
        {
          ...base,
          procedure_kind: 'prophylaxis',
          surfaces: ['M', 'O', 'D'],
          attributes: { age_band: 'adult' },
        },
      ]),
    )

    const { result } = await analyse('adult cleaning', { repository })

    expect(result.factsUsed.find((f) => f.label === 'Surfaces')).toBeUndefined()
    expect(result.recommendedCodes.map((c) => c.code)).toEqual(['D1110'])
  })

  it('lets a user answer override the model', async () => {
    setExtractionProvider(
      provider([
        {
          ...base,
          procedure_kind: 'composite_restoration',
          tooth_numbers: ['30'],
          surfaces: ['M', 'O', 'D'],
          materials: ['composite'],
        },
      ]),
    )

    const { result } = await analyse('composite #30', {
      repository,
      answers: { 'p1:surfaces': 'MO' },
    })

    expect(result.factsUsed.find((f) => f.label === 'Surface count')?.value).toBe('2')
    expect(result.recommendedCodes.map((c) => c.code)).toEqual(['D2392'])
  })
})
