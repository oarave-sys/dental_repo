import type { CodeAttributes } from './types'

/**
 * Known structured attribute keys.
 *
 * Documented here rather than enforced as an enum in the database: a licensed
 * dataset may carry attributes we have not modelled yet, and dropping them on
 * import would lose information. Unknown keys are stored and ignored by the
 * ranker rather than rejected.
 */
export const ATTRIBUTE_KEYS = {
  /** Links a code to the controlled procedure vocabulary. Required for retrieval. */
  PROCEDURE_KIND: 'procedure_kind',

  // Requirements — what must be known before this code can be chosen.
  REQUIRES_TOOTH: 'requires_tooth',
  REQUIRES_SURFACES: 'requires_surfaces',
  REQUIRES_QUADRANT: 'requires_quadrant',
  REQUIRES_ARCH: 'requires_arch',

  // Discriminating values — what separates this code from its siblings.
  SURFACE_COUNT: 'surface_count',
  SURFACE_COUNT_MIN: 'surface_count_min',
  SURFACE_COUNT_MAX: 'surface_count_max',
  TOOTH_REGION: 'tooth_region',
  TOOTH_POSITION_CLASS: 'tooth_position_class',
  DENTITION: 'dentition',
  MATERIAL: 'material',
  CROWN_MATERIAL: 'crown_material',
  IMAGE_COUNT: 'image_count',
  IMAGE_SEQUENCE: 'image_sequence',
  BITEWING_ORIENTATION: 'bitewing_orientation',
  AGE_BAND: 'age_band',
  EVALUATION_TYPE: 'evaluation_type',
  FLUORIDE_FORM: 'fluoride_form',
  EXTRACTION_COMPLEXITY: 'extraction_complexity',
  ERUPTED_STATE: 'erupted_state',
  TEETH_PER_QUADRANT: 'teeth_per_quadrant',
  TEETH_PER_QUADRANT_MIN: 'teeth_per_quadrant_min',
  TEETH_PER_QUADRANT_MAX: 'teeth_per_quadrant_max',
  ARCH: 'arch',
  PROSTHESIS_TYPE: 'prosthesis_type',
  RELINE_SETTING: 'reline_setting',
  DENTURE_TIMING: 'denture_timing',
  FRAMEWORK_MATERIAL: 'framework_material',
  BRIDGE_PART: 'bridge_part',
  RETENTION_TYPE: 'retention_type',
  ABUTMENT_TYPE: 'abutment_type',
  POST_TYPE: 'post_type',
  PULP_CAP_TYPE: 'pulp_cap_type',
  GUARD_TYPE: 'guard_type',
  GUARD_COVERAGE: 'guard_coverage',
  PRIOR_PERIO_THERAPY: 'prior_perio_therapy',
  RESTORATION_SHAPE: 'restoration_shape',

  // Reporting units.
  PER_TOOTH: 'per_tooth',
  PER_QUADRANT: 'per_quadrant',
  PER_ARCH: 'per_arch',
  PER_VISIT: 'per_visit',
} as const

/**
 * Attributes that the ranker treats as DISCRIMINATORS: when two candidate
 * codes disagree on one of these and the note does not settle it, that is a
 * genuine ambiguity worth a question rather than a guess.
 *
 * Each maps to the fact key a question would resolve.
 */
export const DISCRIMINATOR_TO_FACT: Record<string, string> = {
  [ATTRIBUTE_KEYS.SURFACE_COUNT]: 'surfaces',
  [ATTRIBUTE_KEYS.TOOTH_REGION]: 'tooth_numbers',
  [ATTRIBUTE_KEYS.TOOTH_POSITION_CLASS]: 'tooth_numbers',
  [ATTRIBUTE_KEYS.DENTITION]: 'dentition',
  [ATTRIBUTE_KEYS.MATERIAL]: 'material',
  [ATTRIBUTE_KEYS.CROWN_MATERIAL]: 'material',
  [ATTRIBUTE_KEYS.IMAGE_COUNT]: 'image_count',
  [ATTRIBUTE_KEYS.BITEWING_ORIENTATION]: 'bitewing_orientation',
  [ATTRIBUTE_KEYS.AGE_BAND]: 'age_band',
  [ATTRIBUTE_KEYS.EVALUATION_TYPE]: 'evaluation_type',
  [ATTRIBUTE_KEYS.FLUORIDE_FORM]: 'fluoride_form',
  [ATTRIBUTE_KEYS.EXTRACTION_COMPLEXITY]: 'extraction_complexity',
  [ATTRIBUTE_KEYS.ERUPTED_STATE]: 'extraction_complexity',
  [ATTRIBUTE_KEYS.TEETH_PER_QUADRANT]: 'tooth_count_in_quadrant',
  [ATTRIBUTE_KEYS.ARCH]: 'arch',
  [ATTRIBUTE_KEYS.PROSTHESIS_TYPE]: 'prosthesis_type',
  [ATTRIBUTE_KEYS.RELINE_SETTING]: 'reline_setting',
  [ATTRIBUTE_KEYS.DENTURE_TIMING]: 'denture_timing',
  [ATTRIBUTE_KEYS.RETENTION_TYPE]: 'retention_type',
  [ATTRIBUTE_KEYS.ABUTMENT_TYPE]: 'abutment_type',
  [ATTRIBUTE_KEYS.POST_TYPE]: 'post_type',
  [ATTRIBUTE_KEYS.PULP_CAP_TYPE]: 'pulp_cap_type',
  [ATTRIBUTE_KEYS.GUARD_TYPE]: 'guard_type',
  [ATTRIBUTE_KEYS.IMAGE_SEQUENCE]: 'image_count',
  [ATTRIBUTE_KEYS.RESTORATION_SHAPE]: 'restoration_shape',
}

/** Human-readable names for the questions and explanations. */
export const FACT_LABELS: Record<string, string> = {
  tooth_numbers: 'Tooth',
  surfaces: 'Surfaces',
  material: 'Material',
  dentition: 'Dentition',
  age_band: 'Adult or child dentition',
  image_count: 'Number of images',
  bitewing_orientation: 'Bitewing orientation',
  evaluation_type: 'Type of evaluation',
  fluoride_form: 'Form of fluoride',
  extraction_complexity: 'Extraction technique',
  tooth_count_in_quadrant: 'Teeth treated in the quadrant',
  quadrants: 'Quadrant',
  arch: 'Arch',
  prosthesis_type: 'Type of prosthesis',
  reline_setting: 'Chairside or laboratory',
  denture_timing: 'Immediate or conventional',
  retention_type: 'How the crown is retained',
  abutment_type: 'Type of abutment',
  post_type: 'Type of post',
  pulp_cap_type: 'Direct or indirect',
  guard_type: 'Hard or soft appliance',
  restoration_shape: 'Inlay or onlay',
  restoration_intent: 'New or replacement',
  clinical_reasons: 'Reason for treatment',
}

export function factLabel(key: string): string {
  return FACT_LABELS[key] ?? key.replace(/_/g, ' ')
}

/** Builds the typed reader used throughout the ranker. */
export function buildAttributes(
  rows: ReadonlyArray<{ key: string; value: string }>,
): CodeAttributes {
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const list = map.get(row.key)
    if (list) list.push(row.value)
    else map.set(row.key, [row.value])
  }

  return {
    all: map as ReadonlyMap<string, readonly string[]>,
    has(key, value) {
      const list = map.get(key)
      if (!list) return false
      return value === undefined ? true : list.includes(value)
    },
    get(key) {
      return map.get(key)?.[0] ?? null
    },
    values(key) {
      return map.get(key) ?? []
    },
    number(key) {
      const raw = map.get(key)?.[0]
      if (raw === undefined) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    },
    boolean(key) {
      return map.get(key)?.[0] === 'true'
    },
  }
}
