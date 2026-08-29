import { describe, expect, it } from 'vitest'
import {
  normalizeCode, formatCode, isStructurallyValidCode, isInRange, categoryOf,
  matchCode, matchText, type CategoryCodeMap, type Synonym,
} from '@/lib/icd10'

describe('code normalisation', () => {
  it('is indifferent to dots, case and whitespace', () => {
    expect(normalizeCode('m05.79')).toBe('M0579')
    expect(normalizeCode(' M05.79 ')).toBe('M0579')
    expect(normalizeCode('M0579')).toBe('M0579')
  })

  it('formats back to the display form', () => {
    expect(formatCode('M0579')).toBe('M05.79')
    expect(formatCode('I10')).toBe('I10')
  })

  it('rejects the shapes that are not ICD-10 codes', () => {
    expect(isStructurallyValidCode('M05.79')).toBe(true)
    expect(isStructurallyValidCode('I10')).toBe(true)
    // U codes and the letter U are excluded from the first position.
    expect(isStructurallyValidCode('U07.1')).toBe(false)
    expect(isStructurallyValidCode('2024')).toBe(false)
    expect(isStructurallyValidCode('ABC')).toBe(false)
    expect(isStructurallyValidCode('')).toBe(false)
  })
})

describe('ranges', () => {
  const inRange = (c: string) => isInRange(c, 'M15', 'M19')

  it('covers the whole span at category level', () => {
    expect(inRange('M15.0')).toBe(true)
    expect(inRange('M17.0')).toBe(true)
    // The case that a naive lexicographic compare gets wrong: "M199" sorts
    // after "M19", so comparing full codes would exclude M19.9.
    expect(inRange('M19.90')).toBe(true)
    expect(inRange('M19')).toBe(true)
  })

  it('excludes what sits outside it', () => {
    expect(inRange('M14.9')).toBe(false)
    expect(inRange('M20.0')).toBe(false)
    expect(inRange('L40.5')).toBe(false)
  })

  it('reads the three-character category', () => {
    expect(categoryOf('M05.79')).toBe('M05')
    expect(categoryOf('I10')).toBe('I10')
  })
})

describe('matching a code to categories', () => {
  const maps: CategoryCodeMap[] = [
    { categoryKey: 'RA', matchType: 'CODE_FAMILY', value: 'M05' },
    { categoryKey: 'RA', matchType: 'CODE_FAMILY', value: 'M06' },
    { categoryKey: 'GCA', matchType: 'EXACT_CODE', value: 'M31.6' },
    { categoryKey: 'VASCULITIS', matchType: 'CODE_FAMILY', value: 'M31', weight: 80 },
    { categoryKey: 'OA', matchType: 'CODE_RANGE', value: 'M15', valueTo: 'M19' },
  ]

  it('matches a family', () => {
    const matches = matchCode('M05.79', maps)
    expect(matches[0]?.categoryKey).toBe('RA')
    expect(matches[0]?.matchType).toBe('CODE_FAMILY')
  })

  it('prefers the exact code over the family that contains it', () => {
    // M31.6 is giant cell arteritis and also sits inside the M31 vasculitis
    // family. Specificity has to win, or every GCA referral reads as vasculitis.
    const matches = matchCode('M31.6', maps)
    expect(matches[0]?.categoryKey).toBe('GCA')
    expect(matches[0]?.matchType).toBe('EXACT_CODE')
    expect(matches.map((m) => m.categoryKey)).toContain('VASCULITIS')
  })

  it('matches a range', () => {
    expect(matchCode('M17.11', maps)[0]?.categoryKey).toBe('OA')
  })

  it('returns nothing for an unmapped code', () => {
    expect(matchCode('E11.9', maps)).toEqual([])
  })
})

describe('synonym matching', () => {
  const synonyms: Synonym[] = [
    { categoryKey: 'RA', term: 'rheumatoid arthritis', matchMode: 'PHRASE', weight: 90 },
    { categoryKey: 'RA', term: 'RA', matchMode: 'ABBREVIATION', weight: 30 },
    { categoryKey: 'GCA', term: 'temporal arteritis', matchMode: 'PHRASE', weight: 90 },
  ]

  it('matches a phrase regardless of case and accent', () => {
    expect(matchText('Suspected Rheumatoid Arthritis', synonyms)[0]?.categoryKey).toBe('RA')
  })

  it('matches an abbreviation only on a word boundary, case-sensitively', () => {
    expect(matchText('Dx: RA, seropositive', synonyms).some((m) => m.term === 'RA')).toBe(true)
    // The trap: "ra" inside ordinary words must not match.
    expect(matchText('surgical drainage', synonyms).some((m) => m.term === 'RA')).toBe(false)
    expect(matchText('patient has ra somewhere', synonyms).some((m) => m.term === 'RA')).toBe(false)
  })

  it('gives an abbreviation a low weight so it corroborates rather than establishes', () => {
    const abbreviation = matchText('RA', synonyms).find((m) => m.term === 'RA')
    const phrase = matchText('rheumatoid arthritis', synonyms).find((m) => m.term !== 'RA')
    expect(abbreviation!.weight).toBeLessThan(phrase!.weight / 2)
  })

  it('finds a synonym that is not the category name', () => {
    expect(matchText('temporal arteritis, urgent', synonyms)[0]?.categoryKey).toBe('GCA')
  })

  it('returns nothing for unrelated text', () => {
    expect(matchText('routine follow up', synonyms)).toEqual([])
  })
})
