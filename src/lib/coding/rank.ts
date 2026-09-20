import { ATTRIBUTE_KEYS, DISCRIMINATOR_TO_FACT } from '@/lib/codes/attributes'
import type { ProcedureCodeRecord } from '@/lib/codes/types'
import type { ProcedureIntent } from './facts'
import { formatSurfaces } from './surfaces'

/**
 * Deterministic ranking of retrieved candidate codes.
 *
 * This is where the product's central promise is kept: a recommendation is
 * high confidence only when the facts supplied actually distinguish it from
 * the alternatives. Nothing here consults a language model. Given the same
 * facts and the same dataset it returns the same answer every time, and every
 * point of score traces to a fact the user wrote.
 *
 * Two mechanisms do the work:
 *
 *   ELIMINATION — a candidate whose required attribute contradicts a stated
 *   fact is removed outright. A three-surface note cannot be a two-surface
 *   code; an anterior tooth cannot take a posterior code.
 *
 *   UNRESOLVED DISCRIMINATORS — where surviving candidates disagree on an
 *   attribute and the note does not settle it, that is recorded as an open
 *   question rather than broken by a tie-break. This is what makes the engine
 *   ask instead of guess.
 */

export interface CandidateScore {
  record: ProcedureCodeRecord
  score: number
  /** Facts that positively matched, phrased for display. */
  matchedOn: string[]
  /** Why this candidate was eliminated, if it was. */
  eliminatedBecause: string | null
  /** Fact keys that would separate this candidate from its rivals. */
  unresolvedFacts: string[]
}

export interface RankingOutcome {
  surviving: CandidateScore[]
  eliminated: CandidateScore[]
  /** Fact keys that remain genuinely open across surviving candidates. */
  openDiscriminators: string[]
  /** Conflicts between stated facts and every candidate, e.g. an impossible count. */
  conflicts: string[]
}

/** Reads the surface count a code requires, as a range. */
function surfaceRange(code: ProcedureCodeRecord): { min: number; max: number } | null {
  const exact = code.attributes.number(ATTRIBUTE_KEYS.SURFACE_COUNT)
  const min = code.attributes.number(ATTRIBUTE_KEYS.SURFACE_COUNT_MIN)
  const max = code.attributes.number(ATTRIBUTE_KEYS.SURFACE_COUNT_MAX)
  if (exact === null && min === null && max === null) return null
  return {
    min: min ?? exact ?? 0,
    max: max ?? (min !== null ? Number.POSITIVE_INFINITY : (exact ?? Number.POSITIVE_INFINITY)),
  }
}

function quadrantToothRange(code: ProcedureCodeRecord): { min: number; max: number } | null {
  const exact = code.attributes.number(ATTRIBUTE_KEYS.TEETH_PER_QUADRANT)
  const min = code.attributes.number(ATTRIBUTE_KEYS.TEETH_PER_QUADRANT_MIN)
  const max = code.attributes.number(ATTRIBUTE_KEYS.TEETH_PER_QUADRANT_MAX)
  if (exact === null && min === null && max === null) return null
  return { min: min ?? exact ?? 0, max: max ?? Number.POSITIVE_INFINITY }
}

/** Normalises a stated material to the vocabulary the dataset uses. */
function materialMatches(code: ProcedureCodeRecord, key: string, stated: string[]): boolean | null {
  const required = code.attributes.values(key)
  if (required.length === 0) return null
  if (stated.length === 0) return null
  return stated.some((m) => required.some((r) => r.toLowerCase() === m.toLowerCase()))
}

export function rankCandidates(
  candidates: readonly ProcedureCodeRecord[],
  intent: ProcedureIntent,
): RankingOutcome {
  const scored: CandidateScore[] = []
  const conflicts: string[] = []

  for (const record of candidates) {
    const matchedOn: string[] = []
    const unresolvedFacts: string[] = []
    let score = 0
    let eliminatedBecause: string | null = null

    // ---- Surfaces ------------------------------------------------------
    const range = surfaceRange(record)
    if (range) {
      if (intent.surfaceCount === null) {
        unresolvedFacts.push('surfaces')
      } else if (intent.surfaceCount < range.min || intent.surfaceCount > range.max) {
        eliminatedBecause = `${intent.surfaceCount} surface${intent.surfaceCount === 1 ? '' : 's'} documented (${formatSurfaces(intent.surfaces)}), which does not match this code's surface count.`
      } else {
        score += 40
        matchedOn.push(
          `${intent.surfaceCount} surface${intent.surfaceCount === 1 ? '' : 's'} documented (${formatSurfaces(intent.surfaces)})`,
        )
      }
    }

    // ---- Tooth region (anterior vs posterior) --------------------------
    const region = record.attributes.get(ATTRIBUTE_KEYS.TOOTH_REGION)
    if (region) {
      if (intent.toothRegion === null) {
        unresolvedFacts.push('tooth_numbers')
      } else if (region.toUpperCase() !== intent.toothRegion) {
        eliminatedBecause = `Tooth ${intent.toothIds.map((t) => `#${t}`).join(', ')} is ${intent.toothRegion.toLowerCase()}, and this code applies to ${region} teeth.`
      } else {
        score += 30
        matchedOn.push(`${intent.toothRegion.toLowerCase()} tooth`)
      }
    }

    // ---- Root canal position class -------------------------------------
    const posClass = record.attributes.get(ATTRIBUTE_KEYS.TOOTH_POSITION_CLASS)
    if (posClass) {
      const actual = toothPositionClass(intent)
      if (actual === null) unresolvedFacts.push('tooth_numbers')
      else if (actual !== posClass) {
        eliminatedBecause = `Tooth ${intent.toothIds.map((t) => `#${t}`).join(', ')} is ${actual === 'premolar' ? 'a premolar' : `${actual === 'anterior' ? 'an' : 'a'} ${actual}`}, and this code applies to ${posClass} teeth.`
      } else {
        score += 30
        matchedOn.push(`${actual} tooth`)
      }
    }

    // ---- Dentition ------------------------------------------------------
    const dentition = record.attributes.get(ATTRIBUTE_KEYS.DENTITION)
    if (dentition) {
      if (intent.dentition === null) {
        unresolvedFacts.push('dentition')
      } else if (dentition.toUpperCase() !== intent.dentition) {
        eliminatedBecause = `The tooth is ${intent.dentition.toLowerCase()} and this code applies to the ${dentition} dentition.`
      } else {
        score += 20
        matchedOn.push(`${dentition} dentition`)
      }
    }

    // ---- Materials -------------------------------------------------------
    for (const key of [ATTRIBUTE_KEYS.MATERIAL, ATTRIBUTE_KEYS.CROWN_MATERIAL]) {
      const stated =
        key === ATTRIBUTE_KEYS.CROWN_MATERIAL && intent.attributes.crown_material
          ? [intent.attributes.crown_material]
          : intent.materials
      const outcome = materialMatches(record, key, stated)
      if (outcome === null) {
        if (record.attributes.values(key).length > 0 && stated.length === 0) {
          unresolvedFacts.push('material')
        }
        continue
      }
      if (outcome) {
        score += 25
        matchedOn.push(`${stated.join(', ')} recorded as the material`)
      } else {
        eliminatedBecause = `The material documented (${stated.join(', ')}) does not match this code.`
      }
    }

    // ---- Image counts ----------------------------------------------------
    const imageCount = record.attributes.number(ATTRIBUTE_KEYS.IMAGE_COUNT)
    const orientation = record.attributes.get(ATTRIBUTE_KEYS.BITEWING_ORIENTATION)
    if (imageCount !== null && record.category === 'DIAGNOSTIC') {
      if (intent.imageCount === null) {
        unresolvedFacts.push('image_count')
      } else if (orientation === 'vertical' && intent.imageCount < 7) {
        eliminatedBecause = `${intent.imageCount} images documented, fewer than this code covers.`
      } else if (orientation !== 'vertical' && intent.imageCount !== imageCount) {
        eliminatedBecause = `${intent.imageCount} image${intent.imageCount === 1 ? '' : 's'} documented, and this code covers ${imageCount}.`
      } else {
        score += 40
        matchedOn.push(`${intent.imageCount} images documented`)
      }
    }

    // ---- Teeth per quadrant (periodontal) --------------------------------
    const quadRange = quadrantToothRange(record)
    if (quadRange) {
      const stated = Number(intent.attributes.tooth_count_in_quadrant ?? NaN)
      if (!Number.isFinite(stated)) {
        unresolvedFacts.push('tooth_count_in_quadrant')
      } else if (stated < quadRange.min || stated > quadRange.max) {
        eliminatedBecause = `${stated} teeth documented in the quadrant, which does not match this code.`
      } else {
        score += 35
        matchedOn.push(`${stated} teeth treated in the quadrant`)
      }
    }

    // ---- Arch -------------------------------------------------------------
    const arch = record.attributes.get(ATTRIBUTE_KEYS.ARCH)
    if (arch) {
      const stated = intent.arches[0]
      if (!stated) unresolvedFacts.push('arch')
      else if (stated.toLowerCase() !== arch.toLowerCase()) {
        eliminatedBecause = `The ${stated.toLowerCase()} arch is documented and this code applies to the ${arch} arch.`
      } else {
        score += 30
        matchedOn.push(`${arch} arch`)
      }
    }

    // ---- Free-form discriminators from the intent's attributes ------------
    for (const [attrKey, factKey] of Object.entries(DISCRIMINATOR_TO_FACT)) {
      if (HANDLED_EXPLICITLY.has(attrKey)) continue
      const required = record.attributes.values(attrKey)
      if (required.length === 0) continue
      const stated = intent.attributes[attrKey]
      if (!stated) {
        unresolvedFacts.push(factKey)
        continue
      }
      if (required.some((r) => r.toLowerCase() === stated.toLowerCase())) {
        score += 25
        matchedOn.push(`${attrKey.replace(/_/g, ' ')}: ${stated}`)
      } else {
        eliminatedBecause = `The note records ${attrKey.replace(/_/g, ' ')} as "${stated}", which does not match this code.`
      }
    }

    // A tooth being present at all is weak positive evidence for a per-tooth code.
    if (record.attributes.boolean(ATTRIBUTE_KEYS.REQUIRES_TOOTH) && intent.toothIds.length > 0) {
      score += 5
    }

    scored.push({
      record,
      score,
      matchedOn,
      eliminatedBecause,
      unresolvedFacts: [...new Set(unresolvedFacts)],
    })
  }

  const surviving = scored
    .filter((s) => s.eliminatedBecause === null)
    .sort((a, b) => b.score - a.score || a.record.code.localeCompare(b.record.code))
  const eliminated = scored.filter((s) => s.eliminatedBecause !== null)

  // A fact is genuinely open only when the surviving candidates actually
  // disagree about it. If one candidate remains, nothing is open — asking
  // would be a question with only one possible outcome.
  const openDiscriminators = surviving.length > 1
    ? [...new Set(surviving.flatMap((s) => s.unresolvedFacts))].filter((fact) =>
        discriminatesAmong(surviving, fact),
      )
    : []

  // Every candidate eliminated means the facts contradict the whole family.
  if (surviving.length === 0 && eliminated.length > 0) {
    const reasons = [...new Set(eliminated.map((e) => e.eliminatedBecause).filter(Boolean))]
    conflicts.push(
      `No code in this family matches the combination of facts documented. ${reasons[0] ?? ''}`.trim(),
    )
  }

  return { surviving, eliminated, openDiscriminators, conflicts }
}

/** Attributes scored by dedicated branches above, so the generic loop skips them. */
const HANDLED_EXPLICITLY = new Set<string>([
  ATTRIBUTE_KEYS.SURFACE_COUNT,
  ATTRIBUTE_KEYS.TOOTH_REGION,
  ATTRIBUTE_KEYS.TOOTH_POSITION_CLASS,
  ATTRIBUTE_KEYS.DENTITION,
  ATTRIBUTE_KEYS.MATERIAL,
  ATTRIBUTE_KEYS.CROWN_MATERIAL,
  ATTRIBUTE_KEYS.IMAGE_COUNT,
  ATTRIBUTE_KEYS.BITEWING_ORIENTATION,
  ATTRIBUTE_KEYS.TEETH_PER_QUADRANT,
  ATTRIBUTE_KEYS.ARCH,
  ATTRIBUTE_KEYS.IMAGE_SEQUENCE,
])

/**
 * True when candidates hold different values for the attributes a fact
 * controls — i.e. answering it would actually narrow the field.
 */
function discriminatesAmong(candidates: readonly CandidateScore[], factKey: string): boolean {
  const attrKeys = Object.entries(DISCRIMINATOR_TO_FACT)
    .filter(([, f]) => f === factKey)
    .map(([a]) => a)

  for (const attrKey of attrKeys) {
    const seen = new Set<string>()
    for (const c of candidates) {
      const values = c.record.attributes.values(attrKey)
      seen.add(values.length > 0 ? [...values].sort().join('|') : '')
    }
    if (seen.size > 1) return true
  }
  return false
}

/** Anterior / premolar / molar, for the root canal family. */
function toothPositionClass(intent: ProcedureIntent): string | null {
  if (intent.toothIds.length === 0) return null
  const classes = new Set(
    intent.toothIds.map((id) => {
      const n = Number(id)
      if (Number.isNaN(n)) return 'anterior'
      if ([1, 2, 3, 14, 15, 16, 17, 18, 19, 30, 31, 32].includes(n)) return 'molar'
      if ([4, 5, 12, 13, 20, 21, 28, 29].includes(n)) return 'premolar'
      return 'anterior'
    }),
  )
  return classes.size === 1 ? ([...classes][0] ?? null) : null
}
