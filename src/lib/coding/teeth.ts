/**
 * Tooth identification, validated deterministically.
 *
 * Dentistry in the United States numbers permanent teeth 1–32 (Universal
 * Numbering System) and primary teeth A–T. Both are closed sets, so nothing
 * here is a judgement call and none of it belongs to the language model:
 * whether #30 is a posterior permanent tooth is a lookup, not an inference.
 *
 * Everything downstream — which codes are even candidates, whether an
 * anterior/posterior distinction matters, whether a primary-dentition code
 * applies — is derived from this module.
 */

export type Dentition = 'PERMANENT' | 'PRIMARY'
export type ToothRegion = 'ANTERIOR' | 'POSTERIOR'
export type Arch = 'MAXILLARY' | 'MANDIBULAR'
export type Quadrant = 'UR' | 'UL' | 'LL' | 'LR'

export interface ToothFacts {
  /** Canonical identifier: "30" for permanent, "A" for primary. */
  id: string
  dentition: Dentition
  region: ToothRegion
  arch: Arch
  quadrant: Quadrant
  /** True for permanent molars and premolars, and primary molars. */
  isMolar: boolean
}

const PERMANENT_ANTERIOR = new Set([6, 7, 8, 9, 10, 11, 22, 23, 24, 25, 26, 27])
const PERMANENT_MOLARS = new Set([1, 2, 3, 14, 15, 16, 17, 18, 19, 30, 31, 32])

/** Primary teeth run A–J across the upper arch and K–T across the lower. */
const PRIMARY_LETTERS = 'ABCDEFGHIJKLMNOPQRST'
const PRIMARY_ANTERIOR = new Set(['C', 'D', 'E', 'F', 'G', 'H', 'M', 'N', 'O', 'P', 'Q', 'R'])
const PRIMARY_MOLARS = new Set(['A', 'B', 'I', 'J', 'K', 'L', 'S', 'T'])

function permanentQuadrant(n: number): Quadrant {
  if (n <= 8) return 'UR'
  if (n <= 16) return 'UL'
  if (n <= 24) return 'LL'
  return 'LR'
}

function primaryQuadrant(letter: string): Quadrant {
  const i = PRIMARY_LETTERS.indexOf(letter)
  if (i < 5) return 'UR'
  if (i < 10) return 'UL'
  if (i < 15) return 'LL'
  return 'LR'
}

/**
 * Parses one tooth reference. Returns null for anything that is not a real
 * tooth — "#45" and "#Z" are rejected rather than guessed at, because a
 * fabricated tooth would silently steer code selection.
 */
export function parseTooth(raw: string): ToothFacts | null {
  const token = raw.trim().replace(/^#/, '').toUpperCase()
  if (!token) return null

  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token)
    if (n < 1 || n > 32) return null
    const arch: Arch = n <= 16 ? 'MAXILLARY' : 'MANDIBULAR'
    return {
      id: String(n),
      dentition: 'PERMANENT',
      region: PERMANENT_ANTERIOR.has(n) ? 'ANTERIOR' : 'POSTERIOR',
      arch,
      quadrant: permanentQuadrant(n),
      isMolar: PERMANENT_MOLARS.has(n),
    }
  }

  if (/^[A-T]$/.test(token)) {
    const i = PRIMARY_LETTERS.indexOf(token)
    const arch: Arch = i < 10 ? 'MAXILLARY' : 'MANDIBULAR'
    return {
      id: token,
      dentition: 'PRIMARY',
      region: PRIMARY_ANTERIOR.has(token) ? 'ANTERIOR' : 'POSTERIOR',
      arch,
      quadrant: primaryQuadrant(token),
      isMolar: PRIMARY_MOLARS.has(token),
    }
  }

  return null
}

export function isValidTooth(raw: string): boolean {
  return parseTooth(raw) !== null
}

/** A tooth reference together with where in the text it was written. */
export interface ToothMention {
  tooth: ToothFacts
  start: number
  end: number
}

/**
 * Extracts tooth references from free text.
 *
 * Handles the shorthand practices actually type: "#30", "# 30", "tooth 30",
 * "#3, 4, 5", "teeth #2-5", "#A". A bare number with no marker is deliberately
 * NOT treated as a tooth — "4 BW" means four bitewings, not tooth 4.
 */
export function extractTeeth(text: string): {
  teeth: ToothFacts[]
  invalid: string[]
  /** Where each tooth was written, for tracing a fact back to the source. */
  mentions: ToothMention[]
} {
  const found = new Map<string, ToothFacts>()
  const invalid: string[] = []
  const mentions: ToothMention[] = []

  const add = (token: string, start?: number, end?: number) => {
    const tooth = parseTooth(token)
    if (tooth) {
      found.set(tooth.id, tooth)
      if (start !== undefined && end !== undefined) mentions.push({ tooth, start, end })
    } else if (token.trim()) {
      invalid.push(token.trim().replace(/^#/, '').toUpperCase())
    }
  }

  // Ranges first, so "#2-5" does not read as two separate teeth.
  for (const m of text.matchAll(/#\s*(\d{1,2})\s*(?:-|–|to|through)\s*#?\s*(\d{1,2})/gi)) {
    const from = Number(m[1])
    const to = Number(m[2])
    if (from >= 1 && to <= 32 && from < to && to - from <= 15) {
      // The whole range is the evidence for every tooth it covers.
      const start = m.index ?? 0
      const end = start + m[0].length
      for (let n = from; n <= to; n += 1) add(String(n), start, end)
    } else {
      invalid.push(`${m[1]}-${m[2]}`)
    }
  }

  // "#30", "#A", and comma/space runs following one marker: "#3, 4 and 5".
  for (const m of text.matchAll(/#\s*([0-9A-Ta-t]{1,2}(?:\s*(?:,|and|&|\/)\s*#?\s*[0-9A-Ta-t]{1,2})*)/g)) {
    const run = m[1]
    if (!run || m.index === undefined) continue
    addRun(run, m.index, m[0], add)
  }

  // "tooth 30", "teeth 2 and 3" — the word is the marker instead of a hash.
  for (const m of text.matchAll(/\b(?:tooth|teeth|tth)\s*#?\s*([0-9A-Ta-t]{1,2}(?:\s*(?:,|and|&|\/)\s*#?\s*[0-9A-Ta-t]{1,2})*)/gi)) {
    const run = m[1]
    if (!run || m.index === undefined) continue
    addRun(run, m.index, m[0], add)
  }

  return {
    teeth: [...found.values()].sort(compareTeeth),
    invalid: [...new Set(invalid)],
    mentions,
  }
}

/**
 * Splits a run like "3, 4 and 5" and attributes each tooth to its own offset
 * within the overall match, so "#3, 4 and 5" highlights three separate teeth
 * rather than one undifferentiated blob.
 */
function addRun(
  run: string,
  matchStart: number,
  matchText: string,
  add: (token: string, start?: number, end?: number) => void,
): void {
  // Offsets are located within the WHOLE match ("#3, 4 and 5"), not within the
  // captured run ("3, 4 and 5") — the two differ by the marker, and measuring
  // against the wrong one shifts every span.
  let cursor = 0
  for (const part of run.split(/\s*(?:,|and|&|\/)\s*/i)) {
    if (!part) continue
    const found = matchText.indexOf(part, cursor)
    if (found < 0) {
      add(part)
      continue
    }
    // Pull in an adjacent '#' so "#12" highlights as one token rather than
    // leaving the marker stranded outside the highlight.
    const withMarker = found > 0 && matchText[found - 1] === '#' ? found - 1 : found
    const start = matchStart + withMarker
    add(part, start, matchStart + found + part.length)
    cursor = found + part.length
  }
}

function compareTeeth(a: ToothFacts, b: ToothFacts): number {
  const an = Number(a.id)
  const bn = Number(b.id)
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
  if (!Number.isNaN(an)) return -1
  if (!Number.isNaN(bn)) return 1
  return a.id.localeCompare(b.id)
}

export function formatTooth(id: string): string {
  return `#${id}`
}

export function formatTeeth(ids: readonly string[]): string {
  return ids.map(formatTooth).join(', ')
}

/** Detects an explicitly stated dentition, e.g. "primary tooth" or "adult tooth". */
export function statedDentition(text: string): Dentition | null {
  const t = text.toLowerCase()
  if (/\b(primary|deciduous|baby|pedo)\b/.test(t)) return 'PRIMARY'
  if (/\b(permanent|adult\s+tooth|succedaneous)\b/.test(t)) return 'PERMANENT'
  return null
}
