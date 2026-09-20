import { describe, expect, it } from 'vitest'
import { checkCode, checkCodeAgainstDescription } from '@/lib/coding/tools'
import { repository } from './helpers'

describe('Check a Code', () => {
  it('explains a known code with all the fields the UI promises', async () => {
    const result = await checkCode('D2393', { repository })
    expect(result.found).toBe(true)
    if (!result.found) return

    expect(result.code).toBe('D2393')
    expect(result.categoryLabel).toBe('Restorative')
    expect(result.plainLanguage).toBeTruthy()
    expect(result.documentationConsiderations.length).toBeGreaterThan(0)
    expect(result.verifyQuestions.length).toBeGreaterThan(0)
    expect(result.commonlyConfusedWith.length + result.relatedCodes.length).toBeGreaterThan(0)
  })

  it('normalises a lowercase code', async () => {
    const result = await checkCode(' d2393 ', { repository })
    expect(result.found).toBe(true)
  })

  it('declines to describe an unknown code and offers near matches', async () => {
    const result = await checkCode('D2399', { repository })
    expect(result.found).toBe(false)
    if (result.found) return

    expect(result.message).toMatch(/not in the active procedure-code dataset/i)
    // A typo should still be recoverable.
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.every((s) => s.code.startsWith('D23'))).toBe(true)
  })

  it('invents nothing for a code shaped like a real one', async () => {
    const result = await checkCode('D9999', { repository })
    expect(result.found).toBe(false)
    if (result.found) return
    expect(JSON.stringify(result)).not.toMatch(/plainLanguage|descriptor/i)
  })

  it('reports the dataset the explanation came from', async () => {
    const result = await checkCode('D1110', { repository })
    if (!result.found) throw new Error('expected D1110')
    expect(result.dataset.kind).toBe('DEMO')
  })

  it('carries no official descriptor while the demo dataset is active', async () => {
    const result = await checkCode('D2393', { repository })
    if (!result.found) throw new Error('expected D2393')
    expect(result.officialDescriptor).toBeNull()
  })
})

describe('Check a Code, compared with a description', () => {
  it('confirms a matching code', async () => {
    const { explanation, analysis } = await checkCodeAgainstDescription(
      'D2393',
      'MOD composite #30',
      { repository, useAi: false },
    )

    expect(explanation.found).toBe(true)
    expect(analysis?.warnings.some((w) => w.severity === 'CONFLICT')).toBe(false)
  })

  it('surfaces a surface-count mismatch', async () => {
    const { analysis } = await checkCodeAgainstDescription('D2392', 'MOD composite #30', {
      repository,
      useAi: false,
    })

    const conflict = analysis?.warnings.find((w) => w.severity === 'CONFLICT')
    expect(conflict?.message).toMatch(/3 surfaces documented/i)
  })

  it('surfaces a material mismatch', async () => {
    const { analysis } = await checkCodeAgainstDescription('D2160', 'MOD composite #30', {
      repository,
      useAi: false,
    })

    const warning = analysis?.warnings.find(
      (w) => w.severity === 'CONFLICT' || w.severity === 'REVIEW',
    )
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('D2160')
  })

  it('returns no analysis when no description is supplied', async () => {
    const { analysis } = await checkCodeAgainstDescription('D2393', '   ', { repository })
    expect(analysis).toBeNull()
  })
})
