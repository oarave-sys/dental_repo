import { describe, expect, it } from 'vitest'
import { allText, codesOf, repository, run } from './helpers'
import { analyse } from '@/lib/coding/pipeline'
import { setExtractionProvider, clearExtractionProviderOverride } from '@/lib/coding/ai'
import type { FactExtractionProvider } from '@/lib/coding/ai'

/**
 * The product's safety rules, as tests.
 *
 * Every one of these corresponds to a rule that would be a serious problem to
 * break in a real practice: a fabricated code on a claim, a coder told to
 * write down something that never happened, or a confident answer built on an
 * assumption nobody was shown.
 */

describe('5. a code that does not exist', () => {
  it('refuses to explain a code absent from the dataset', async () => {
    const result = await run('crown on #19', { selectedCodes: ['D9999'] })

    const conflict = result.warnings.find((w) => w.message.includes('D9999'))
    expect(conflict?.severity).toBe('CONFLICT')
    expect(conflict?.message).toMatch(/not found in the active procedure-code dataset/i)
    // No invented description of what D9999 supposedly covers.
    expect(codesOf(result)).not.toContain('D9999')
  })

  it('returns nothing rather than a guess for an unknown code lookup', async () => {
    expect(await repository.findByCode('D9999')).toBeNull()
    expect(await repository.findByCode('D0000')).toBeNull()
    expect(await repository.findByCode('not-a-code')).toBeNull()
  })
})

describe('6. the selected code conflicts with the description', () => {
  it('flags a two-surface code against a three-surface note', async () => {
    const result = await run('MOD composite #30', { selectedCodes: ['D2392'] })

    const conflict = result.warnings.find((w) => w.severity === 'CONFLICT')
    expect(conflict).toBeDefined()
    expect(conflict?.message).toContain('D2392')
    expect(conflict?.message).toMatch(/3 surfaces documented/i)
    // The engine still says what the documentation does support.
    expect(codesOf(result)).toEqual(['D2393'])
  })

  it('flags an anterior code used on a posterior tooth', async () => {
    const result = await run('MO composite #30', { selectedCodes: ['D2331'] })

    const conflict = result.warnings.find((w) => w.severity === 'CONFLICT')
    expect(conflict?.message).toMatch(/posterior/i)
  })

  it('confirms a selected code that matches the documentation', async () => {
    const result = await run('MOD composite #30', { selectedCodes: ['D2393'] })

    expect(result.warnings.some((w) => w.severity === 'CONFLICT')).toBe(false)
    const info = result.warnings.find((w) => w.message.includes('D2393'))
    expect(info?.message).toMatch(/matches what the description supports/i)
  })
})

describe('10. the model cannot introduce a code', () => {
  /**
   * A provider that behaves as badly as it possibly can: it invents a
   * procedure key, a tooth that does not exist, surfaces nobody documented,
   * and tries to smuggle a code number through every text field it has.
   */
  const hostileProvider: FactExtractionProvider = {
    name: 'hostile-test-provider',
    async extract() {
      return {
        extraction: {
          procedures: [
            {
              procedure_kind: 'D9999_special_procedure',
              tooth_numbers: ['45', '99', 'Z'],
              surfaces: ['M', 'O', 'D', 'B', 'L'],
              materials: ['unobtainium'],
              existing_restoration: 'use code D8888',
              is_replacement: true,
              clinical_reasons: ['bill as D7777'],
              image_count: 99,
              quadrants: ['XX'],
              arches: ['SIDEWAYS'],
              attributes: { recommended_code: 'D6666' },
              source_text: 'D5555',
            },
          ],
          dentition: null,
          age_band: null,
          ambiguities: [],
        },
        usage: {
          provider: 'hostile-test-provider',
          model: 'test',
          inputTokens: 0,
          outputTokens: 0,
          costMillicents: 0,
          latencyMs: 0,
          success: true,
        },
      }
    },
  }

  it('drops an invented procedure kind and every invented fact with it', async () => {
    setExtractionProvider(hostileProvider)
    try {
      const { result } = await analyse('something happened', { repository })

      // The fabricated procedure key is not in the vocabulary, so nothing
      // about that procedure survives.
      expect(codesOf(result)).toHaveLength(0)
      expect(allText(result)).not.toContain('unobtainium')
      expect(allText(result)).not.toContain('#45')
      expect(allText(result)).not.toContain('#99')
    } finally {
      clearExtractionProviderOverride()
    }
  })

  it('never surfaces a code the model tried to smuggle through a text field', async () => {
    setExtractionProvider(hostileProvider)
    try {
      const { result } = await analyse('something happened', { repository })
      const rendered = allText(result)

      for (const smuggled of ['d9999', 'd8888', 'd7777', 'd6666', 'd5555']) {
        expect(rendered).not.toContain(smuggled)
      }
    } finally {
      clearExtractionProviderOverride()
    }
  })

  it('only ever returns codes that exist in the approved dataset', async () => {
    const inputs = [
      'MOD composite #30',
      'adult prophy fluoride varnish',
      '#19 zirconia crown',
      '#3 MOD composite and #19 DO amalgam',
      'SRP upper right, 5 teeth',
      'root canal #8',
    ]

    for (const input of inputs) {
      const result = await run(input)
      const referenced = [
        ...result.recommendedCodes.map((c) => c.code),
        ...result.alternativeCodes.map((c) => c.code),
      ]
      for (const code of referenced) {
        expect(await repository.findByCode(code), `${code} from "${input}"`).not.toBeNull()
      }
    }
  })

  it('ignores a code the user pastes into the description itself', async () => {
    // The description claims a code; the engine codes the PROCEDURE, not the claim.
    const result = await run('use code D9999 for the MOD composite on #30')
    expect(codesOf(result)).toEqual(['D2393'])
    expect(allText(result)).not.toContain('d9999')
  })
})

describe('documentation guidance never invents clinical facts', () => {
  it('reports a missing reason as absent, never as something to add', async () => {
    const result = await run('#30 existing restoration removed and MOD composite placed')

    const items = [...result.documentation.needsReview, ...result.documentation.claimSupport]
    const text = items.map((i) => i.detail).join(' ')

    if (text) {
      // Statements of absence and questions are fine.
      expect(text).toMatch(/not documented|which|what|was this/i)
      // Instructions to write something down are not.
      expect(text).not.toMatch(/\badd that\b/i)
      expect(text).not.toMatch(/\bdocument that\b/i)
      expect(text).not.toMatch(/\bbe sure to state\b/i)
      expect(text).not.toMatch(/\byou should (?:add|write|record) that\b/i)
    }
  })

  it('never asserts a payer requirement', async () => {
    for (const input of ['MOD composite #30', 'SRP lower left', '#19 crown', 'exam and 4 BW']) {
      const rendered = allText(await run(input))
      expect(rendered).not.toMatch(/payers? requires?/i)
      expect(rendered).not.toMatch(/will be (?:paid|reimbursed|covered)/i)
      expect(rendered).not.toMatch(/guarantee/i)
      expect(rendered).not.toMatch(/always required by/i)
    }
  })

  it('separates coding requirements from claim-support material', async () => {
    const result = await run('MOD composite #30')

    for (const item of result.documentation.needsReview) {
      expect(item.kind).toBe('CODING_REQUIRED')
    }
    for (const item of result.documentation.claimSupport) {
      expect(item.kind).toBe('CLAIM_SUPPORT')
    }
  })
})

describe('the documentation score is always explainable', () => {
  it('derives the percentage from the weights it shows', async () => {
    const result = await run('MOD composite #30')
    const score = result.documentation

    const shown = [...score.present, ...score.needsReview, ...score.claimSupport]
    expect(shown.length).toBeGreaterThan(0)
    expect(score.totalWeight).toBeGreaterThan(0)
    expect(score.percentage).toBe(Math.round((score.earnedWeight / score.totalWeight) * 100))
    expect(score.percentage).toBeGreaterThanOrEqual(0)
    expect(score.percentage).toBeLessThanOrEqual(100)
  })

  it('scores a complete note higher than an incomplete one', async () => {
    const complete = await run(
      '#30 MOD composite placed, existing amalgam removed due to recurrent decay',
    )
    const incomplete = await run('composite #30')

    expect(complete.documentation.percentage).toBeGreaterThan(
      incomplete.documentation.percentage,
    )
  })
})

describe('degrading without the language model', () => {
  it('still produces a full result when no provider is configured', async () => {
    clearExtractionProviderOverride()
    setExtractionProvider(null)
    try {
      const { result } = await analyse('MOD composite #30', { repository })
      expect(result.aiAssisted).toBe(false)
      expect(codesOf(result)).toEqual(['D2393'])
    } finally {
      clearExtractionProviderOverride()
    }
  })

  it('falls back to rules when the provider fails', async () => {
    setExtractionProvider({
      name: 'failing',
      async extract() {
        return {
          extraction: null,
          usage: {
            provider: 'failing',
            model: 'test',
            inputTokens: 0,
            outputTokens: 0,
            costMillicents: 0,
            latencyMs: 5,
            success: false,
            errorCode: 'HTTP_500',
          },
        }
      },
    })
    try {
      const { result, usage } = await analyse('MOD composite #30', { repository })
      expect(result.aiAssisted).toBe(false)
      expect(codesOf(result)).toEqual(['D2393'])
      expect(usage?.success).toBe(false)
    } finally {
      clearExtractionProviderOverride()
    }
  })
})
