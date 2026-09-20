/**
 * Tooth surface normalisation and counting.
 *
 * Surface count is the single most common driver of restorative code
 * selection, and it is fully determined by the note — so it is computed here,
 * deterministically, and never inferred by the language model.
 *
 * Five surfaces exist per tooth. Posterior teeth have an occlusal surface;
 * anterior teeth have an incisal edge instead. Facial and buccal name the same
 * surface, as do facial and labial, so they normalise to one value — otherwise
 * "MB" and "MF" would count as different two-surface restorations.
 */

import type { ToothFacts } from './teeth'

export type Surface = 'M' | 'O' | 'D' | 'B' | 'L' | 'I'

export const SURFACE_NAMES: Record<Surface, string> = {
  M: 'Mesial',
  O: 'Occlusal',
  D: 'Distal',
  B: 'Buccal/Facial',
  L: 'Lingual',
  I: 'Incisal',
}

/** Canonical display order, mesial through distal then outward. */
const ORDER: Surface[] = ['M', 'O', 'I', 'D', 'B', 'L']

const WORD_TO_SURFACE: Array<[RegExp, Surface]> = [
  [/\bmesial\b/g, 'M'],
  [/\bocclusal\b/g, 'O'],
  [/\bdistal\b/g, 'D'],
  [/\b(?:buccal|facial|labial)\b/g, 'B'],
  [/\blingual\b/g, 'L'],
  [/\bpalatal\b/g, 'L'],
  [/\bincisal\b/g, 'I'],
]

/** Letters that may appear inside a surface shorthand token such as "MODBL". */
const SURFACE_LETTERS = /^[MODBLIF]+$/

/**
 * Shorthand tokens that are real words or abbreviations, not surfaces.
 * Without this, "DO" in "DO NOT" and the "MOD" in "moderate" become
 * restorations. The engine must not invent surfaces that were never written.
 */
const NOT_SURFACES = new Set([
  'OD', // "OD" is an eye abbreviation far more often than distal-occlusal here
  'ID',
  'MD',
  'DOB',
  'LOL',
  'BM',
  'FMD',
])

function normaliseLetter(ch: string): Surface | null {
  switch (ch) {
    case 'M':
      return 'M'
    case 'O':
      return 'O'
    case 'D':
      return 'D'
    case 'B':
    case 'F':
      return 'B'
    case 'L':
      return 'L'
    case 'I':
      return 'I'
    default:
      return null
  }
}

export interface SurfaceExtraction {
  surfaces: Surface[]
  /** Number of distinct surfaces documented. */
  count: number
  /** True when the text used a shorthand token such as "MOD". */
  fromShorthand: boolean
  /** Tokens that looked like surfaces but were rejected. */
  rejected: string[]
}

export function extractSurfaces(text: string): SurfaceExtraction {
  const set = new Set<Surface>()
  const rejected: string[] = []
  let fromShorthand = false

  // Spelled-out surface names are unambiguous; take them first.
  const lower = text.toLowerCase()
  for (const [pattern, surface] of WORD_TO_SURFACE) {
    if (new RegExp(pattern.source, 'g').test(lower)) set.add(surface)
  }

  // Shorthand runs: an uppercase token made only of surface letters. Requiring
  // uppercase is what keeps "mod" in "moderate decay" from becoming M-O-D.
  for (const m of text.matchAll(/\b([A-Z]{1,5})\b/g)) {
    const token = m[1]
    if (!token) continue
    if (!SURFACE_LETTERS.test(token)) continue
    if (NOT_SURFACES.has(token)) {
      rejected.push(token)
      continue
    }
    // A single letter is too weak on its own — "B" is as likely to be an
    // initial or a list marker as a buccal surface.
    if (token.length === 1) {
      rejected.push(token)
      continue
    }
    const letters = [...token].map(normaliseLetter)
    if (letters.some((l) => l === null)) continue
    for (const l of letters) if (l) set.add(l)
    fromShorthand = true
  }

  const surfaces = [...set].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  return { surfaces, count: surfaces.length, fromShorthand, rejected: [...new Set(rejected)] }
}

/** Parses a user's answer to "which surfaces?" — more permissive than free text. */
export function parseSurfaceAnswer(answer: string): Surface[] {
  const set = new Set<Surface>()
  const lower = answer.toLowerCase()
  for (const [pattern, surface] of WORD_TO_SURFACE) {
    if (new RegExp(pattern.source, 'g').test(lower)) set.add(surface)
  }
  // Here a bare letter run IS the answer, so single letters are accepted.
  for (const m of answer.toUpperCase().matchAll(/[MODBLIF]+/g)) {
    const token = m[0]
    if (NOT_SURFACES.has(token) && token.length > 1) continue
    for (const ch of token) {
      const s = normaliseLetter(ch)
      if (s) set.add(s)
    }
  }
  return [...set].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
}

export function formatSurfaces(surfaces: readonly Surface[]): string {
  return surfaces.join('')
}

export function describeSurfaces(surfaces: readonly Surface[]): string {
  return surfaces.map((s) => SURFACE_NAMES[s]).join(', ')
}

/**
 * Flags surfaces that cannot belong to the tooth they were recorded against:
 * an occlusal surface on an incisor, or an incisal edge on a molar. This is a
 * documentation inconsistency worth surfacing, not something to silently fix.
 */
export function surfaceToothConflicts(
  surfaces: readonly Surface[],
  tooth: ToothFacts,
): string[] {
  const problems: string[] = []
  if (tooth.region === 'ANTERIOR' && surfaces.includes('O')) {
    problems.push(
      `An occlusal surface is recorded for #${tooth.id}, which is an anterior tooth. Anterior teeth have an incisal edge rather than an occlusal surface. Confirm which surface was treated.`,
    )
  }
  if (tooth.region === 'POSTERIOR' && surfaces.includes('I')) {
    problems.push(
      `An incisal surface is recorded for #${tooth.id}, which is a posterior tooth. Confirm which surface was treated.`,
    )
  }
  return problems
}
