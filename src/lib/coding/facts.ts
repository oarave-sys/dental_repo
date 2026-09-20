import { z } from 'zod'
import type { Surface } from './surfaces'
import type { Arch, Dentition, Quadrant, ToothRegion } from './teeth'
import type { ProcedureCategory } from './vocabulary'

/**
 * The structured clinical facts the rest of the engine reasons over.
 *
 * Two rules govern this file:
 *   1. Only facts actually supplied are represented. Absence is modelled
 *      explicitly as null or an empty array, never as a default that reads
 *      like a finding. "Surfaces unknown" and "no surfaces involved" are
 *      different states and must stay different.
 *   2. Every fact carries enough provenance to be shown back to the user, so
 *      a recommendation can always be explained in terms of what they wrote.
 */

export type AgeBand = 'CHILD' | 'ADULT'
export type RestorationIntent = 'NEW' | 'REPLACEMENT'

/**
 * One procedure the user described. A single input routinely contains several
 * ("exam bwx cleaning fluoride"), and each is coded independently.
 */
export interface ProcedureIntent {
  /** Stable within one analysis, used to tie questions back to a procedure. */
  id: string
  /** A key from the controlled vocabulary, or null when unrecognised. */
  procedureKind: string | null
  category: ProcedureCategory | null

  toothIds: string[]
  /** Derived from toothIds; null when no tooth is known. */
  toothRegion: ToothRegion | null
  dentition: Dentition | null

  surfaces: Surface[]
  /** null means "not stated". 0 would mean "stated as none", which never occurs. */
  surfaceCount: number | null

  materials: string[]
  restorationIntent: RestorationIntent | null
  existingRestoration: string | null
  clinicalReasons: string[]

  imageCount: number | null
  quadrants: Quadrant[]
  arches: Arch[]
  ageBand: AgeBand | null

  /**
   * Procedure-specific facts keyed by discriminator name, e.g.
   * { extraction_complexity: 'surgical', crown_material: 'zirconia' }.
   * Keeps the shape stable while the vocabulary grows.
   */
  attributes: Record<string, string>

  /** The span of the user's text this intent came from, for explanation. */
  sourceText: string
}

export interface ExtractedFacts {
  intents: ProcedureIntent[]
  dentition: Dentition | null
  ageBand: AgeBand | null
  /** Tooth references that are not real teeth, surfaced rather than dropped. */
  invalidTeeth: string[]
  /** Genuine ambiguities in what was written, phrased for the user. */
  ambiguities: string[]
  /** Deterministic observations, e.g. a surface that cannot exist on that tooth. */
  observations: string[]
}

export function emptyIntent(id: string): ProcedureIntent {
  return {
    id,
    procedureKind: null,
    category: null,
    toothIds: [],
    toothRegion: null,
    dentition: null,
    surfaces: [],
    surfaceCount: null,
    materials: [],
    restorationIntent: null,
    existingRestoration: null,
    clinicalReasons: [],
    imageCount: null,
    quadrants: [],
    arches: [],
    ageBand: null,
    attributes: {},
    sourceText: '',
  }
}

// ---------------------------------------------------------------------------
// The contract with the language model.
//
// Note what is NOT here: there is no field for a procedure code. The model
// classifies and extracts; it never names a code. Codes come only from the
// reference database. A model that returned a code would have nowhere to put
// it, and the schema below would reject the response.
// ---------------------------------------------------------------------------

export const AiProcedureSchema = z.object({
  /** Must be a key from PROCEDURE_KEYS; validated against it after parsing. */
  procedure_kind: z.string(),
  tooth_numbers: z.array(z.string()).default([]),
  surfaces: z.array(z.string()).default([]),
  materials: z.array(z.string()).default([]),
  existing_restoration: z.string().nullable().default(null),
  /** true = replacing an existing restoration, false = new, null = not stated. */
  is_replacement: z.boolean().nullable().default(null),
  clinical_reasons: z.array(z.string()).default([]),
  image_count: z.number().int().positive().nullable().default(null),
  quadrants: z.array(z.string()).default([]),
  arches: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.string()).default({}),
  source_text: z.string().default(''),
})

export const AiExtractionSchema = z.object({
  procedures: z.array(AiProcedureSchema).default([]),
  dentition: z.enum(['PERMANENT', 'PRIMARY']).nullable().default(null),
  age_band: z.enum(['CHILD', 'ADULT']).nullable().default(null),
  /** Things the note genuinely leaves open. Not a place to speculate. */
  ambiguities: z.array(z.string()).default([]),
})

export type AiExtraction = z.infer<typeof AiExtractionSchema>

// ---------------------------------------------------------------------------
// Facts as shown to the user ("Facts identified").
// ---------------------------------------------------------------------------

export interface DisplayFact {
  label: string
  value: string
  /** Where the fact came from, so a user can tell stated from derived. */
  source: 'stated' | 'derived'
}
