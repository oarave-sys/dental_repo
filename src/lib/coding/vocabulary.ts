/**
 * The controlled vocabulary of procedures the engine understands.
 *
 * This matters more than it looks. The language model is allowed to classify
 * free text into one of these keys — and nothing else. It is never allowed to
 * emit a procedure code. Retrieval then maps a key to candidate codes through
 * the reference database, so a model that has never heard of our dataset still
 * cannot invent a code: the worst it can do is pick the wrong key, which the
 * ranker and the user both get to see and correct.
 *
 * Scope is general dentistry. Procedures that a general dentist refers out
 * are deliberately absent rather than half-supported.
 */

export type ProcedureCategory =
  | 'DIAGNOSTIC'
  | 'PREVENTIVE'
  | 'RESTORATIVE'
  | 'ENDODONTICS'
  | 'PERIODONTICS'
  | 'PROSTHODONTICS_REMOVABLE'
  | 'PROSTHODONTICS_FIXED'
  | 'IMPLANT_SERVICES'
  | 'ORAL_SURGERY'
  | 'ADJUNCTIVE'

export const CATEGORY_LABELS: Record<ProcedureCategory, string> = {
  DIAGNOSTIC: 'Diagnostic',
  PREVENTIVE: 'Preventive',
  RESTORATIVE: 'Restorative',
  ENDODONTICS: 'Endodontics',
  PERIODONTICS: 'Periodontics',
  PROSTHODONTICS_REMOVABLE: 'Prosthodontics — removable',
  PROSTHODONTICS_FIXED: 'Prosthodontics — fixed',
  IMPLANT_SERVICES: 'Implant services',
  ORAL_SURGERY: 'Oral surgery',
  ADJUNCTIVE: 'Adjunctive services',
}

export interface ProcedureKindDef {
  key: string
  label: string
  category: ProcedureCategory
  /** Patterns that identify this procedure in shorthand or prose. */
  patterns: RegExp[]
  /**
   * Facts that materially change which code applies. Drives the clarifying
   * questions: a fact listed here and absent from the note is worth asking
   * about, and a fact not listed here is not.
   */
  discriminators: string[]
}

/**
 * Written as a flat list so adding a procedure is one entry, not a refactor.
 * Order matters only for tie-breaking in the matcher, which prefers the
 * longest matched phrase rather than list position.
 */
export const PROCEDURE_KINDS: ProcedureKindDef[] = [
  // ---- Diagnostic -------------------------------------------------------
  {
    key: 'periodic_oral_evaluation',
    label: 'Periodic oral evaluation',
    category: 'DIAGNOSTIC',
    patterns: [/\bperiodic (?:oral )?(?:eval|evaluation|exam)\b/, /\brecall exam\b/, /\bperio exam\b/],
    discriminators: ['evaluation_type'],
  },
  {
    key: 'comprehensive_oral_evaluation',
    label: 'Comprehensive oral evaluation',
    category: 'DIAGNOSTIC',
    patterns: [/\bcomprehensive (?:oral )?(?:eval|evaluation|exam)\b/, /\bnew patient exam\b/, /\bce\b/],
    discriminators: ['evaluation_type'],
  },
  {
    key: 'limited_oral_evaluation',
    label: 'Limited oral evaluation (problem focused)',
    category: 'DIAGNOSTIC',
    patterns: [/\blimited (?:oral )?(?:eval|evaluation|exam)\b/, /\bemergency exam\b/, /\bproblem focus(?:ed)?\b/],
    discriminators: ['evaluation_type'],
  },
  {
    key: 'oral_evaluation_unspecified',
    label: 'Oral evaluation',
    category: 'DIAGNOSTIC',
    patterns: [/\bexams?\b/, /\bevaluation\b/, /\bcheck ?up\b/],
    discriminators: ['evaluation_type'],
  },
  {
    key: 'bitewing_radiographs',
    label: 'Bitewing radiographs',
    category: 'DIAGNOSTIC',
    patterns: [/\bbite ?wings?\b/, /\bbwx?\b/, /\bbws\b/, /\b\d\s*bw\b/],
    discriminators: ['image_count'],
  },
  {
    key: 'periapical_radiograph',
    label: 'Periapical radiograph',
    category: 'DIAGNOSTIC',
    patterns: [/\bperiapical\b/, /\bpa x-?ray\b/, /\bpas?\b(?! ?system)/],
    discriminators: ['image_count'],
  },
  {
    key: 'panoramic_radiograph',
    label: 'Panoramic radiograph',
    category: 'DIAGNOSTIC',
    patterns: [/\bpanoramic\b/, /\bpano\b/, /\bpanorex\b/],
    discriminators: [],
  },
  {
    key: 'full_mouth_series',
    label: 'Full mouth radiographic series',
    category: 'DIAGNOSTIC',
    patterns: [/\bfull mouth (?:series|x-?rays?|radiograph)/, /\bfmx\b/, /\bfms\b/],
    discriminators: [],
  },
  // ---- Preventive -------------------------------------------------------
  {
    key: 'prophylaxis',
    label: 'Prophylaxis (cleaning)',
    category: 'PREVENTIVE',
    patterns: [/\bprophy(?:laxis)?\b/, /\bcleanings?\b/, /\bscale and polish\b/],
    discriminators: ['age_band'],
  },
  {
    key: 'fluoride_treatment',
    label: 'Topical fluoride',
    category: 'PREVENTIVE',
    patterns: [/\bfluorides?\b/, /\bf\/?varnish\b/, /\bfl varnish\b/],
    discriminators: ['fluoride_form'],
  },
  {
    key: 'sealant',
    label: 'Sealant',
    category: 'PREVENTIVE',
    patterns: [/\bsealants?\b/, /\bsealed\b/],
    discriminators: ['tooth_numbers'],
  },
  {
    key: 'space_maintainer',
    label: 'Space maintainer',
    category: 'PREVENTIVE',
    patterns: [/\bspace maintainer\b/, /\bband and loop\b/],
    discriminators: ['appliance_type'],
  },
  // ---- Restorative ------------------------------------------------------
  {
    key: 'composite_restoration',
    label: 'Composite restoration',
    category: 'RESTORATIVE',
    patterns: [
      /\bcomposites?\b/,
      /\bresin(?:-based)? composite\b/,
      /\btooth[- ]colou?red (?:filling|restoration)\b/,
      /\bwhite filling\b/,
    ],
    discriminators: ['surfaces', 'tooth_numbers', 'tooth_region', 'dentition', 'material'],
  },
  {
    key: 'amalgam_restoration',
    label: 'Amalgam restoration',
    category: 'RESTORATIVE',
    patterns: [/\bamalgams?\b/, /\bsilver filling\b/],
    discriminators: ['surfaces', 'tooth_numbers', 'dentition', 'material'],
  },
  {
    key: 'restoration_unspecified',
    label: 'Restoration (material not stated)',
    category: 'RESTORATIVE',
    patterns: [/\bfillings?\b/, /\brestorations?\b/, /\brestored\b/],
    discriminators: ['material', 'surfaces', 'tooth_numbers'],
  },
  {
    key: 'crown',
    label: 'Single crown',
    category: 'RESTORATIVE',
    patterns: [/\bcrowns?\b/, /\bcap\b/, /\bfull covera?ge restoration\b/],
    discriminators: ['material', 'tooth_numbers', 'dentition'],
  },
  {
    key: 'core_buildup',
    label: 'Core buildup',
    category: 'RESTORATIVE',
    patterns: [/\bcore build[- ]?up\b/, /\bbuild[- ]?up\b/, /\bcore\b(?! ?and ?post)/],
    discriminators: ['tooth_numbers'],
  },
  {
    key: 'post_and_core',
    label: 'Post and core',
    category: 'RESTORATIVE',
    patterns: [/\bpost and core\b/, /\bpost ?& ?core\b/, /\bprefab(?:ricated)? post\b/],
    discriminators: ['tooth_numbers', 'post_type'],
  },
  {
    key: 'crown_recement',
    label: 'Recement crown',
    category: 'RESTORATIVE',
    patterns: [/\bre-?cement(?:ed|ation)? (?:of )?crown\b/, /\bre-?bond(?:ed)? crown\b/],
    discriminators: ['tooth_numbers'],
  },
  {
    key: 'inlay_onlay',
    label: 'Inlay or onlay',
    category: 'RESTORATIVE',
    patterns: [/\binlays?\b/, /\bonlays?\b/],
    discriminators: ['surfaces', 'restoration_shape', 'material'],
  },
  {
    key: 'sedative_filling',
    label: 'Sedative / interim restoration',
    category: 'RESTORATIVE',
    patterns: [/\bsedative (?:filling|restoration)\b/, /\bimr\b/, /\binterim restoration\b/, /\btemp(?:orary)? filling\b/],
    discriminators: ['tooth_numbers'],
  },
  // ---- Endodontics ------------------------------------------------------
  {
    key: 'root_canal',
    label: 'Root canal therapy',
    category: 'ENDODONTICS',
    patterns: [/\broot canals?\b/, /\brct\b/, /\bendo(?:dontic)? (?:therapy|treatment)\b/],
    discriminators: ['tooth_numbers', 'tooth_position_class'],
  },
  {
    key: 'pulpotomy',
    label: 'Pulpotomy',
    category: 'ENDODONTICS',
    patterns: [/\bpulpotomy\b/],
    discriminators: ['tooth_numbers', 'dentition'],
  },
  {
    key: 'pulp_cap',
    label: 'Pulp cap',
    category: 'ENDODONTICS',
    patterns: [/\bpulp cap\b/, /\bdirect pulp cap\b/, /\bindirect pulp cap\b/],
    discriminators: ['pulp_cap_type'],
  },
  {
    key: 'endodontic_retreatment',
    label: 'Endodontic retreatment',
    category: 'ENDODONTICS',
    patterns: [/\bre-?treat(?:ment)? (?:of )?(?:root canal|endo)\b/, /\bendo re-?treatment\b/],
    discriminators: ['tooth_numbers'],
  },
  // ---- Periodontics -----------------------------------------------------
  {
    key: 'scaling_root_planing',
    label: 'Scaling and root planing',
    category: 'PERIODONTICS',
    patterns: [/\bscaling and root planing\b/, /\bsrp\b/, /\bdeep cleaning\b/, /\broot plan(?:e|ing)\b/],
    discriminators: ['quadrants', 'tooth_count_in_quadrant'],
  },
  {
    key: 'periodontal_maintenance',
    label: 'Periodontal maintenance',
    category: 'PERIODONTICS',
    patterns: [/\bperio(?:dontal)? maintenance\b/, /\bperio maint\b/],
    discriminators: ['prior_perio_therapy'],
  },
  {
    key: 'full_mouth_debridement',
    label: 'Full mouth debridement',
    category: 'PERIODONTICS',
    patterns: [/\bfull mouth debridement\b/, /\bdebridement\b/, /\bfmd\b/],
    discriminators: [],
  },
  {
    key: 'scaling_gingival_inflammation',
    label: 'Scaling in the presence of gingival inflammation',
    category: 'PERIODONTICS',
    patterns: [/\bscaling in (?:the )?presence of\b/, /\bgingival inflammation\b/],
    discriminators: [],
  },
  // ---- Removable prosthodontics -----------------------------------------
  {
    key: 'complete_denture',
    label: 'Complete denture',
    category: 'PROSTHODONTICS_REMOVABLE',
    patterns: [/\bcomplete dentures?\b/, /\bfull dentures?\b/, /\bimmediate dentures?\b/],
    discriminators: ['arch', 'denture_timing'],
  },
  {
    key: 'partial_denture',
    label: 'Partial denture',
    category: 'PROSTHODONTICS_REMOVABLE',
    patterns: [/\bpartial dentures?\b/, /\brpd\b/, /\bpartials?\b/],
    discriminators: ['arch', 'framework_material'],
  },
  {
    key: 'denture_reline',
    label: 'Denture reline',
    category: 'PROSTHODONTICS_REMOVABLE',
    patterns: [/\breline\b/, /\brebase\b/],
    discriminators: ['arch', 'prosthesis_type', 'reline_setting'],
  },
  {
    key: 'denture_repair',
    label: 'Denture repair or adjustment',
    category: 'PROSTHODONTICS_REMOVABLE',
    patterns: [/\bdenture repair\b/, /\bdenture adjust(?:ment)?\b/, /\brepair(?:ed)? (?:the )?denture\b/],
    discriminators: ['arch', 'prosthesis_type'],
  },
  // ---- Fixed prosthodontics ---------------------------------------------
  {
    key: 'bridge',
    label: 'Fixed bridge',
    category: 'PROSTHODONTICS_FIXED',
    patterns: [/\bbridges?\b/, /\bfixed partial denture\b/, /\bfpd\b/, /\bpontics?\b/],
    discriminators: ['abutment_teeth', 'pontic_teeth', 'material'],
  },
  {
    key: 'bridge_recement',
    label: 'Recement bridge',
    category: 'PROSTHODONTICS_FIXED',
    patterns: [/\bre-?cement(?:ed)? (?:the )?bridge\b/],
    discriminators: [],
  },
  // ---- Implant services -------------------------------------------------
  {
    key: 'implant_crown',
    label: 'Implant-supported crown',
    category: 'IMPLANT_SERVICES',
    patterns: [/\bimplant crown\b/, /\bcrown on (?:the )?implant\b/, /\bimplant[- ]supported crown\b/],
    discriminators: ['tooth_numbers', 'material', 'retention_type'],
  },
  {
    key: 'implant_placement',
    label: 'Implant placement',
    category: 'IMPLANT_SERVICES',
    patterns: [/\bimplant placement\b/, /\bplaced (?:an? )?implant\b/, /\bimplant surgery\b/],
    discriminators: ['tooth_numbers', 'implant_type'],
  },
  {
    key: 'implant_abutment',
    label: 'Implant abutment',
    category: 'IMPLANT_SERVICES',
    patterns: [/\babutment\b/],
    discriminators: ['abutment_type'],
  },
  // ---- Oral surgery -----------------------------------------------------
  {
    key: 'extraction',
    label: 'Extraction',
    category: 'ORAL_SURGERY',
    patterns: [/\bextractions?\b/, /\bextracted?\b/, /\bexo\b/, /\bremoved tooth\b/, /\bext\b/],
    discriminators: ['extraction_complexity', 'tooth_numbers'],
  },
  {
    key: 'alveoloplasty',
    label: 'Alveoloplasty',
    category: 'ORAL_SURGERY',
    patterns: [/\balveoloplasty\b/, /\bbone (?:re)?contour(?:ing)?\b/],
    discriminators: ['quadrants', 'with_extraction'],
  },
  {
    key: 'biopsy',
    label: 'Biopsy',
    category: 'ORAL_SURGERY',
    patterns: [/\bbiops(?:y|ies)\b/],
    discriminators: ['biopsy_type'],
  },
  // ---- Adjunctive -------------------------------------------------------
  {
    key: 'palliative_treatment',
    label: 'Palliative treatment',
    category: 'ADJUNCTIVE',
    patterns: [/\bpalliative\b/, /\bemergency (?:treatment|relief)\b/, /\bpain relief visit\b/],
    discriminators: [],
  },
  {
    key: 'occlusal_guard',
    label: 'Occlusal guard',
    category: 'ADJUNCTIVE',
    patterns: [/\bocclusal guard\b/, /\bnight ?guard\b/, /\bbruxism appliance\b/, /\bbite guard\b/],
    discriminators: ['guard_type'],
  },
  {
    key: 'nitrous_oxide',
    label: 'Nitrous oxide',
    category: 'ADJUNCTIVE',
    patterns: [/\bnitrous\b/, /\bn2o\b/, /\blaughing gas\b/],
    discriminators: [],
  },
  {
    key: 'desensitizing',
    label: 'Desensitising treatment',
    category: 'ADJUNCTIVE',
    patterns: [/\bdesensitiz(?:ing|er)\b/, /\bdesensitis(?:ing|er)\b/],
    discriminators: ['application_scope'],
  },
]

const BY_KEY = new Map(PROCEDURE_KINDS.map((p) => [p.key, p]))

export function procedureKind(key: string): ProcedureKindDef | undefined {
  return BY_KEY.get(key)
}

export function procedureLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key
}

export function categoryForKind(key: string): ProcedureCategory | null {
  return BY_KEY.get(key)?.category ?? null
}

export const PROCEDURE_KEYS = PROCEDURE_KINDS.map((p) => p.key)

/**
 * Generic keys, and the specific keys that supersede them.
 *
 * A generic match is dropped only when a member of its OWN family also
 * matched: "comprehensive exam" supersedes a bare "exam". Suppressing on
 * category alone was wrong — bitewings and an evaluation are both diagnostic,
 * and "exam and 4 BW" is two procedures, not one.
 */
export const GENERIC_KIND_FAMILIES: Record<string, readonly string[]> = {
  oral_evaluation_unspecified: [
    'periodic_oral_evaluation',
    'comprehensive_oral_evaluation',
    'limited_oral_evaluation',
  ],
  restoration_unspecified: ['composite_restoration', 'amalgam_restoration', 'inlay_onlay'],
}

export const GENERIC_KINDS = new Set(Object.keys(GENERIC_KIND_FAMILIES))


/**
 * Fact keys always worth reviewing for a procedure, regardless of whether they
 * change the code. These are the CLAIM_SUPPORT elements — reported in their own
 * section, never presented as requirements.
 */
export const UNIVERSAL_FACT_KEYS = new Set([
  'clinical_reasons',
  'restoration_intent',
])

/**
 * Whether a documentation rule is relevant to a procedure.
 *
 * This is what stops the engine asking a crown about its surfaces. A rule
 * attached to a whole category only applies to a procedure within it if that
 * procedure's own discriminators say the fact matters — which is exactly the
 * "do not ask irrelevant questions" requirement, enforced in one place.
 */
export function factRelevantToKind(kindKey: string | null, factKey: string): boolean {
  if (UNIVERSAL_FACT_KEYS.has(factKey)) return true
  if (!kindKey) return true
  const def = BY_KEY.get(kindKey)
  if (!def) return true
  return def.discriminators.includes(factKey)
}
