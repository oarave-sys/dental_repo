/**
 * ICD-10-CM matching. Pure: codes and maps in, matches out.
 *
 * Five strategies, ranked by how much they justify. An exact code is a claim
 * someone made deliberately; a synonym in free text is a hint.
 */

export type CodeMatchType =
  | 'EXACT_CODE'
  | 'CODE_FAMILY'
  | 'CODE_RANGE'
  | 'DIAGNOSIS_CATEGORY'
  | 'TEXT_SYNONYM'
  | 'NONE'

/** How much each strategy justifies. Used for ranking and for confidence. */
export const MATCH_STRENGTH: Record<CodeMatchType, number> = {
  EXACT_CODE: 100,
  CODE_FAMILY: 88,
  CODE_RANGE: 84,
  DIAGNOSIS_CATEGORY: 78,
  TEXT_SYNONYM: 62,
  NONE: 0,
}

export interface CategoryCodeMap {
  categoryKey: string
  matchType: 'EXACT_CODE' | 'CODE_FAMILY' | 'CODE_RANGE'
  value: string
  valueTo?: string | null
  weight?: number
  specificityNote?: string | null
}

export interface CodeMatch {
  categoryKey: string
  matchType: CodeMatchType
  strength: number
  weight: number
  specificityNote?: string | null
}

/** Uppercase, no dot, no whitespace. `m05.79` and `M0579` are the same code. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[.\s]/g, '')
}

/** Display form: three-character category, then a dot, then the remainder. */
export function formatCode(code: string): string {
  const n = normalizeCode(code)
  return n.length > 3 ? `${n.slice(0, 3)}.${n.slice(3)}` : n
}

/**
 * Structurally valid ICD-10-CM. A validity check against the reference table
 * still has to happen — this only discards the obvious non-codes that regex
 * extraction pulls out of fax text.
 */
export const ICD10_PATTERN = /^[A-TV-Z][0-9][0-9AB](?:[0-9A-TV-Z]{1,4})?$/

export function isStructurallyValidCode(code: string): boolean {
  return ICD10_PATTERN.test(normalizeCode(code))
}

/** The three-character category, which is the unit ICD-10 ranges are defined in. */
export function categoryOf(code: string): string {
  return normalizeCode(code).slice(0, 3)
}

/**
 * ICD-10 ranges are written at category level ("M15-M19"), so range membership
 * is decided on the three-character category — not on the full code. Comparing
 * full codes lexicographically gets M19.9 wrong, because "M199" sorts after
 * "M19".
 */
export function isInRange(code: string, from: string, to: string): boolean {
  const c = categoryOf(code)
  const lo = categoryOf(from)
  const hi = categoryOf(to)
  if (c[0] !== lo[0] && c[0] !== hi[0]) return false
  return c >= lo && c <= hi
}

/** Every category a single code maps to, strongest first. */
export function matchCode(code: string, maps: readonly CategoryCodeMap[]): CodeMatch[] {
  const normalized = normalizeCode(code)
  if (!normalized) return []

  const out: CodeMatch[] = []
  for (const map of maps) {
    const value = normalizeCode(map.value)
    let hit = false
    switch (map.matchType) {
      case 'EXACT_CODE':
        hit = normalized === value
        break
      case 'CODE_FAMILY':
        hit = normalized.startsWith(value)
        break
      case 'CODE_RANGE':
        hit = map.valueTo ? isInRange(normalized, value, normalizeCode(map.valueTo)) : false
        break
    }
    if (!hit) continue
    out.push({
      categoryKey: map.categoryKey,
      matchType: map.matchType,
      strength: MATCH_STRENGTH[map.matchType],
      weight: map.weight ?? 100,
      specificityNote: map.specificityNote ?? null,
    })
  }

  // A more specific map wins: an exact code beats the family that contains it.
  return out.sort(
    (a, b) => b.strength - a.strength || b.weight - a.weight || a.categoryKey.localeCompare(b.categoryKey),
  )
}

// ---------------------------------------------------------------------------
// Text and synonym matching
// ---------------------------------------------------------------------------

export interface Synonym {
  categoryKey: string
  term: string
  matchMode: 'PHRASE' | 'ABBREVIATION' | 'TOKEN'
  weight?: number
}

export interface TextMatch {
  categoryKey: string
  term: string
  weight: number
  matchMode: Synonym['matchMode']
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Matches synonyms in free text.
 *
 * Abbreviations are matched case-SENSITIVELY on word boundaries and carry a low
 * weight by design. "RA" appears inside ordinary words and inside unrelated
 * acronyms; on its own it never establishes rheumatoid arthritis, it
 * corroborates a code or a phrase that does.
 */
export function matchText(text: string, synonyms: readonly Synonym[]): TextMatch[] {
  if (!text.trim()) return []
  const lowered = normalizeText(text)
  const out: TextMatch[] = []

  for (const synonym of synonyms) {
    const weight = synonym.weight ?? 60
    if (synonym.matchMode === 'ABBREVIATION') {
      // Case-sensitive against the ORIGINAL text: "RA" is an abbreviation,
      // "ra" in "surgical" is not.
      const re = new RegExp(`\\b${escapeRegExp(synonym.term)}\\b`)
      if (re.test(text)) out.push({ ...synonym, weight, matchMode: synonym.matchMode })
      continue
    }
    const needle = normalizeText(synonym.term)
    if (!needle) continue
    const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`)
    if (re.test(lowered)) out.push({ ...synonym, weight, matchMode: synonym.matchMode })
  }

  return out.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
}
