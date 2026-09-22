import { extractSurfaces, parseSurfaceAnswer, surfaceToothConflicts, type Surface } from './surfaces'
import { extractTeeth, parseTooth, statedDentition, type Dentition, type ToothFacts } from './teeth'
import {
  GENERIC_KIND_FAMILIES,
  GENERIC_KINDS,
  PROCEDURE_KINDS,
  categoryForKind,
  type ProcedureKindDef,
} from './vocabulary'
import { emptyIntent, type AgeBand, type ExtractedFacts, type ProcedureIntent } from './facts'
import { span, type SourceSpan } from './evidence'

/**
 * Rule-based extraction of clinical facts from free text.
 *
 * This runs on every request, with or without an API key, and it is the
 * authority for anything a regular expression can settle: tooth numbers,
 * surfaces, surface counts, image counts, materials. The language model is
 * layered on top for prose the rules cannot parse — it fills gaps, it does not
 * overwrite what was matched here. See extract.ts for the merge.
 *
 * The practical effect is that the shorthand a practice types all day
 * ("MOD composite #30", "exam bwx cleaning fluoride") is handled with no
 * model call at all: instant, free, and identical every time.
 */

const MATERIALS: Array<[RegExp, string]> = [
  [/\bcomposites?\b/i, 'composite'],
  [/\bresin\b/i, 'composite'],
  [/\bamalgams?\b/i, 'amalgam'],
  [/\bzirconia?\b/i, 'zirconia'],
  [/\be\.?max\b/i, 'lithium disilicate'],
  [/\blithium disilicate\b/i, 'lithium disilicate'],
  [/\bporcelain fused to metal\b/i, 'porcelain fused to metal'],
  [/\bpfm\b/i, 'porcelain fused to metal'],
  [/\ball[- ]?ceramic\b/i, 'ceramic'],
  [/\bporcelain\b/i, 'porcelain'],
  [/\bceramic\b/i, 'ceramic'],
  [/\bgold\b/i, 'gold'],
  [/\bnoble metal\b/i, 'noble metal'],
  [/\bstainless steel\b/i, 'stainless steel'],
  [/\bglass ionomer\b/i, 'glass ionomer'],
  [/\bgi\b/, 'glass ionomer'],
]

const REASONS: Array<[RegExp, string]> = [
  [/\brecurrent (?:decay|caries)\b/i, 'recurrent decay'],
  [/\brecurrent\b/i, 'recurrent decay'],
  [/\b(?:gross )?decay\b/i, 'decay'],
  [/\bcaries\b/i, 'decay'],
  [/\bfractured?\b/i, 'fracture'],
  [/\bcracked?\b/i, 'crack'],
  [/\bbroken\b/i, 'fracture'],
  [/\bleaking\b/i, 'leaking restoration'],
  [/\bopen margin\b/i, 'open margin'],
  [/\bfail(?:ing|ed)\b/i, 'failing restoration'],
  [/\bwear\b/i, 'wear'],
  [/\bsensitiv(?:e|ity)\b/i, 'sensitivity'],
  [/\bpain(?:ful)?\b/i, 'pain'],
  [/\babscess\b/i, 'abscess'],
  [/\bnecrotic\b/i, 'necrotic pulp'],
  [/\birreversible pulpitis\b/i, 'irreversible pulpitis'],
  [/\bpulpitis\b/i, 'pulpitis'],
  [/\bperiapical (?:lesion|radiolucency)\b/i, 'periapical lesion'],
  [/\bmobility\b/i, 'mobility'],
  [/\bnon[- ]restorable\b/i, 'non-restorable'],
  [/\bimpacted\b/i, 'impaction'],
]

/** Phrases that indicate an existing restoration is being replaced. */
const REPLACEMENT_CUES = [
  /\bexisting (?:restoration|filling|crown|composite|amalgam)\b/i,
  /\bold (?:restoration|filling|crown|composite|amalgam)\b/i,
  /\bprevious (?:restoration|filling|crown)\b/i,
  /\breplac(?:e|ed|ing|ement)\b/i,
  /\bre-?do\b/i,
  /\brecurrent (?:decay|caries)\b/i,
  /\bremoved and replaced\b/i,
  /\b(?:restoration|filling|crown) removed\b/i,
]

const NEW_CUES = [/\bnew (?:decay|caries|lesion)\b/i, /\binitial (?:restoration|caries)\b/i, /\bvirgin tooth\b/i]

const EXISTING_RESTORATION: Array<[RegExp, string]> = [
  [/\b(?:existing|old|previous|failing|fractured)\s+(?:mod\s+|do\s+|mo\s+)?composite\b/i, 'composite'],
  [/\b(?:existing|old|previous|failing|fractured)\s+(?:mod\s+|do\s+|mo\s+)?amalgam\b/i, 'amalgam'],
  [/\b(?:existing|old|previous|failing|fractured)\s+crown\b/i, 'crown'],
  [/\b(?:existing|old|previous|failing|fractured)\s+(?:restoration|filling)\b/i, 'restoration'],
]

const AGE_CUES: Array<[RegExp, AgeBand]> = [
  [/\badults?\b/i, 'ADULT'],
  [/\bchild(?:ren)?\b/i, 'CHILD'],
  [/\bpedo\b/i, 'CHILD'],
  [/\bpediatric\b/i, 'CHILD'],
]

const QUADRANT_CUES: Array<[RegExp, 'UR' | 'UL' | 'LL' | 'LR']> = [
  [/\bupper right\b|\bur quad\b|\bq1\b/i, 'UR'],
  [/\bupper left\b|\bul quad\b|\bq2\b/i, 'UL'],
  [/\blower left\b|\bll quad\b|\bq3\b/i, 'LL'],
  [/\blower right\b|\blr quad\b|\bq4\b/i, 'LR'],
]

const ARCH_CUES: Array<[RegExp, 'MAXILLARY' | 'MANDIBULAR']> = [
  [/\bmaxillary\b|\bupper arch\b/i, 'MAXILLARY'],
  [/\bmandibular\b|\blower arch\b/i, 'MANDIBULAR'],
]

interface KindMatch {
  def: ProcedureKindDef
  index: number
  matchLength: number
  matchedText: string
}

/**
 * Restorative kinds that can appear in a note as the restoration being
 * REMOVED rather than the one being placed.
 */
const REMOVABLE_RESTORATIVE = new Set([
  'composite_restoration',
  'amalgam_restoration',
  'restoration_unspecified',
  'crown',
  'inlay_onlay',
])

/**
 * True when a restorative mention describes the OLD restoration rather than
 * the work performed.
 *
 * "Existing MOD amalgam was removed. MOD composite placed." names two
 * restorations and one procedure. Without this, the note codes as an amalgam —
 * which is both wrong and exactly the phrasing dental notes use most.
 */
function describesExistingRestoration(text: string, match: KindMatch): boolean {
  const before = text.slice(Math.max(0, match.index - 45), match.index)
  const after = text.slice(
    match.index + match.matchLength,
    match.index + match.matchLength + 45,
  )

  const precededByExisting =
    /\b(?:existing|old|previous|prior|failing|fractured|defective|leaking)\b[^.;]{0,20}$/i.test(
      before,
    )
  // "removed" must attach to the restoration, not to decay removed beneath it.
  const followedByRemoval = /^[^.;]{0,25}\b(?:was |were )?(?:removed|taken off|cut off)\b/i.test(
    after,
  )
  const followedByReplacement = /^[^.;]{0,25}\b(?:was |were )?replaced\b/i.test(after)

  return precededByExisting || followedByRemoval || followedByReplacement
}

/** Finds every procedure the text mentions, preferring specific over generic. */
function matchProcedureKinds(text: string): KindMatch[] {
  const matches: KindMatch[] = []
  // Matched case-insensitively: practices type "Composite #12" and "MOD
  // composite" interchangeably. Surface detection above still requires
  // uppercase, because there the case IS the signal.
  const haystack = text.toLowerCase()

  for (const def of PROCEDURE_KINDS) {
    for (const pattern of def.patterns) {
      const re = new RegExp(pattern.source, 'gi')
      for (const m of haystack.matchAll(re)) {
        if (m.index === undefined) continue
        matches.push({
          def,
          index: m.index,
          matchLength: m[0].length,
          matchedText: m[0],
        })
        break // one hit per pattern is enough to establish the procedure
      }
    }
  }

  // Collapse duplicates of the same kind, keeping the earliest mention.
  const byKind = new Map<string, KindMatch>()
  for (const m of matches) {
    const prior = byKind.get(m.def.key)
    if (!prior || m.index < prior.index) byKind.set(m.def.key, m)
  }

  const chosen = [...byKind.values()]

  // Drop a generic kind only when a member of its own family also matched.
  const matchedKeys = new Set(chosen.map((m) => m.def.key))
  const filtered = chosen.filter((m) => {
    if (!GENERIC_KINDS.has(m.def.key)) return true
    const family = GENERIC_KIND_FAMILIES[m.def.key] ?? []
    return !family.some((k) => matchedKeys.has(k))
  })

  // "crown" inside a bridge description is not a single crown; the bridge wins.
  const hasBridge = filtered.some((m) => m.def.key === 'bridge')
  const afterBridge = hasBridge ? filtered.filter((m) => m.def.key !== 'crown') : filtered

  // Drop restorations the note describes as removed, but only when some other
  // restorative procedure remains. If removing the old restoration is the only
  // restorative mention, it is still the best evidence of what was done.
  const existingContext = afterBridge.filter(
    (m) => REMOVABLE_RESTORATIVE.has(m.def.key) && describesExistingRestoration(text, m),
  )
  const restorativeCount = afterBridge.filter((m) => REMOVABLE_RESTORATIVE.has(m.def.key)).length
  const result =
    existingContext.length > 0 && restorativeCount > existingContext.length
      ? afterBridge.filter((m) => !existingContext.includes(m))
      : afterBridge

  return result.sort((a, b) => a.index - b.index)
}

/** Bitewing counts: "4 BW", "four bitewings", "BWX4". */
function extractImageCount(text: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

  const numeric = text.match(/\b(\d{1,2})\s*(?:x\s*)?(?:bite ?wings?|bwx?|bws|pas?|periapicals?|images?|films?|x-?rays?)\b/i)
  if (numeric?.[1]) return Number(numeric[1])

  const trailing = text.match(/\b(?:bite ?wings?|bwx|pas?)\s*(\d{1,2})\b/i)
  if (trailing?.[1]) return Number(trailing[1])

  const worded = text.match(/\b(one|two|three|four|five|six|seven|eight)\s+(?:bite ?wings?|bwx?|pas?|periapicals?|images?|films?)\b/i)
  const w = worded?.[1]?.toLowerCase()
  if (w && words[w]) return words[w] ?? null

  return null
}

function firstMatch<T>(text: string, table: Array<[RegExp, T]>): T | null {
  for (const [pattern, value] of table) if (pattern.test(text)) return value
  return null
}

function allMatches<T>(text: string, table: Array<[RegExp, T]>): T[] {
  const out: T[] = []
  for (const [pattern, value] of table) {
    if (pattern.test(text) && !out.includes(value)) out.push(value)
  }
  return out
}

/** Like allMatches, but also reports where each value was found. */
function allMatchesWithSpans<T>(
  text: string,
  table: Array<[RegExp, T]>,
  offset = 0,
): { values: T[]; spans: SourceSpan[] } {
  const values: T[] = []
  const spans: SourceSpan[] = []
  for (const [pattern, value] of table) {
    const re = new RegExp(pattern.source, pattern.flags.includes('i') ? 'gi' : 'g')
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue
      if (!values.includes(value)) values.push(value)
      spans.push(span(text, m.index, m.index + m[0].length))
    }
  }
  // Offsets are relative to `text`; shift them into the original input.
  return {
    values,
    spans: offset === 0 ? spans : spans.map((sp) => ({ ...sp, start: sp.start + offset, end: sp.end + offset })),
  }
}

/**
 * True when a phrase is negated in the text.
 *
 * Clinical notes routinely record the absence of something — "no bone removal
 * required", "without sectioning". Reading those as positive findings would
 * turn a simple extraction into a surgical one, so negation is checked before
 * any phrase is believed.
 */
function negated(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `\\b(?:no|not|without|denies|negative for|free of)\\b[^.;]{0,30}?\\b${escaped}`,
    'i',
  )
  return pattern.test(text)
}

/** Finds a phrase only where it is not negated. */
function statedPositively(text: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
    if (re.test(text) && !negated(text, phrase)) return phrase
  }
  return null
}

/** Extraction complexity, only when the note actually says so. */
function extractionComplexity(text: string): string | null {
  const classified = statedPositively(text, [
    'soft tissue',
    'partially bony',
    'completely bony',
    'full bony',
  ])
  if (classified) return classified === 'full bony' ? 'completely bony' : classified

  if (statedPositively(text, ['impacted'])) return 'impacted'
  if (statedPositively(text, ['surgical', 'flap', 'sectioned', 'sectioning', 'bone removal', 'removal of bone'])) {
    return 'surgical'
  }
  if (statedPositively(text, ['simple', 'routine', 'forceps'])) return 'simple'
  // "no bone removal or sectioning" describes a simple extraction by exclusion.
  if (negated(text, 'bone removal') || negated(text, 'sectioning')) return 'simple'
  return null
}

/** Whether the tooth was erupted, impacted, or a residual root. */
function eruptedState(text: string): string | null {
  if (/\b(?:residual|retained)\s+(?:tooth\s+)?roots?\b/i.test(text)) return 'residual_root'
  if (statedPositively(text, ['impacted'])) return 'impacted'
  if (statedPositively(text, ['erupted', 'exposed root'])) return 'erupted'
  return null
}

function crownMaterial(materials: string[]): string | null {
  if (materials.includes('zirconia')) return 'zirconia'
  if (materials.includes('lithium disilicate')) return 'lithium disilicate'
  if (materials.includes('porcelain fused to metal')) return 'porcelain fused to metal'
  if (materials.includes('ceramic') || materials.includes('porcelain')) return 'ceramic'
  if (materials.includes('gold') || materials.includes('noble metal')) return 'noble metal'
  if (materials.includes('stainless steel')) return 'stainless steel'
  return null
}

/**
 * Splits input into segments so facts attach to the right procedure. Practices
 * write runs like "#3 MOD composite, #19 DO amalgam" and both teeth must not
 * end up on both procedures.
 */
export interface TextSegment {
  text: string
  /** Absolute offset of this segment within the original input. */
  offset: number
}

/**
 * Splits input so facts attach to the right procedure, keeping each piece's
 * absolute offset. The offsets are what let a highlighted span point at the
 * original text rather than at a fragment of it.
 */
function segment(text: string): TextSegment[] {
  const separator = /(?:[.;\n]|,\s*(?=#)|\band\b(?=\s+#))/gi
  const out: TextSegment[] = []
  let cursor = 0

  for (const m of text.matchAll(separator)) {
    if (m.index === undefined) continue
    pushSegment(out, text, cursor, m.index)
    cursor = m.index + m[0].length
  }
  pushSegment(out, text, cursor, text.length)

  return out.length > 0 ? out : [{ text, offset: 0 }]
}

/** Trims a slice and records where the trimmed text actually starts. */
function pushSegment(out: TextSegment[], source: string, from: number, to: number): void {
  const raw = source.slice(from, to)
  const leading = raw.length - raw.trimStart().length
  const trimmed = raw.trim()
  if (trimmed) out.push({ text: trimmed, offset: from + leading })
}

export interface DeterministicOptions {
  /** Answers already given to clarifying questions, keyed by fact key. */
  answers?: Record<string, string>
}

export function extractDeterministic(
  input: string,
  options: DeterministicOptions = {},
): ExtractedFacts {
  const text = input.trim()
  const observations: string[] = []
  const ambiguities: string[] = []

  const globalTeeth = extractTeeth(text)
  const globalDentitionStated = statedDentition(text)
  const ageBand = firstMatch(text, AGE_CUES)

  const segments = segment(text)

  // Per-segment facts, so a tooth mentioned beside one procedure does not leak
  // onto another. Falls back to the whole text when a segment carries none.
  interface SegmentFacts {
    text: string
    offset: number
    teeth: ToothFacts[]
    toothSpans: SourceSpan[]
    surfaces: Surface[]
    surfaceSpans: SourceSpan[]
    materials: string[]
    materialSpans: SourceSpan[]
  }

  const shift = (spans: Array<{ start: number; end: number }>, offset: number, source: string) =>
    spans.map((sp) => span(source, sp.start + offset, sp.end + offset))

  const segmentFacts: SegmentFacts[] = segments.map((seg) => {
    const teeth = extractTeeth(seg.text)
    const surfaces = extractSurfaces(seg.text)
    const materials = allMatchesWithSpans(seg.text, MATERIALS, seg.offset)
    return {
      text: seg.text,
      offset: seg.offset,
      teeth: teeth.teeth,
      toothSpans: shift(teeth.mentions, seg.offset, text),
      surfaces: surfaces.surfaces,
      surfaceSpans: shift(surfaces.mentions, seg.offset, text),
      materials: materials.values,
      materialSpans: materials.spans,
    }
  })

  const kindMatches = matchProcedureKinds(text)
  const intents: ProcedureIntent[] = []

  kindMatches.forEach((match, i) => {
    const intent = emptyIntent(`p${i + 1}`)
    intent.procedureKind = match.def.key
    intent.category = categoryForKind(match.def.key)

    // Attach the segment that actually contains this procedure mention.
    const owning =
      segmentFacts.find((s) => s.text.toLowerCase().includes(match.matchedText.toLowerCase())) ??
      segmentFacts[0]

    intent.sourceText = owning?.text ?? text
    intent.evidence.procedure = [span(text, match.index, match.index + match.matchLength)]

    const scoped =
      owning ?? {
        text,
        offset: 0,
        teeth: globalTeeth.teeth,
        toothSpans: shift(globalTeeth.mentions, 0, text),
        surfaces: [],
        surfaceSpans: [],
        materials: [],
        materialSpans: [],
      }

    // Teeth: prefer the owning segment, fall back to the whole input when the
    // segment names none and the input names exactly one.
    let teeth = scoped.teeth
    let toothSpans = scoped.toothSpans
    if (teeth.length === 0 && globalTeeth.teeth.length === 1) {
      teeth = globalTeeth.teeth
      toothSpans = shift(globalTeeth.mentions, 0, text)
    }
    if (teeth.length === 0 && kindMatches.length === 1) {
      teeth = globalTeeth.teeth
      toothSpans = shift(globalTeeth.mentions, 0, text)
    }

    intent.toothIds = teeth.map((t) => t.id)
    if (toothSpans.length > 0) intent.evidence.tooth_numbers = toothSpans

    if (teeth.length > 0) {
      const regions = new Set(teeth.map((t) => t.region))
      intent.toothRegion = regions.size === 1 ? (teeth[0]?.region ?? null) : null
      const dentitions = new Set(teeth.map((t) => t.dentition))
      intent.dentition = dentitions.size === 1 ? (teeth[0]?.dentition ?? null) : null
      intent.quadrants = [...new Set(teeth.map((t) => t.quadrant))]
      intent.arches = [...new Set(teeth.map((t) => t.arch))]
    }
    if (globalDentitionStated) intent.dentition = globalDentitionStated

    // Surfaces apply to restorative work only. A "MOD" in a preventive
    // sentence is noise, and attaching it would fabricate a finding.
    const surfaceRelevant =
      intent.category === 'RESTORATIVE' ||
      match.def.key === 'sealant' ||
      match.def.key === 'inlay_onlay'
    if (surfaceRelevant) {
      let surfaces = scoped.surfaces
      let surfaceSpans = scoped.surfaceSpans
      if (surfaces.length === 0 && kindMatches.length === 1) {
        const whole = extractSurfaces(text)
        surfaces = whole.surfaces
        surfaceSpans = shift(whole.mentions, 0, text)
      }
      intent.surfaces = surfaces
      intent.surfaceCount = surfaces.length > 0 ? surfaces.length : null
      if (surfaceSpans.length > 0) intent.evidence.surfaces = surfaceSpans

      for (const tooth of teeth) {
        observations.push(...surfaceToothConflicts(surfaces, tooth))
      }
    }

    let materials = scoped.materials
    let materialSpans = scoped.materialSpans
    if (materials.length === 0 && kindMatches.length === 1) {
      const whole = allMatchesWithSpans(text, MATERIALS)
      materials = whole.values
      materialSpans = whole.spans
    }
    intent.materials = materials
    if (materialSpans.length > 0) intent.evidence.material = materialSpans

    const scopedReasons = allMatchesWithSpans(scoped.text, REASONS, scoped.offset)
    const reasons =
      scopedReasons.values.length > 0 ? scopedReasons : allMatchesWithSpans(text, REASONS)
    intent.clinicalReasons = reasons.values
    if (reasons.spans.length > 0) intent.evidence.clinical_reasons = reasons.spans

    // Replacement vs new. Only set when the text says so.
    const scope = `${scoped.text} ${text}`
    if (REPLACEMENT_CUES.some((c) => c.test(scope))) intent.restorationIntent = 'REPLACEMENT'
    else if (NEW_CUES.some((c) => c.test(scope))) intent.restorationIntent = 'NEW'

    if (intent.restorationIntent) {
      const cues = intent.restorationIntent === 'REPLACEMENT' ? REPLACEMENT_CUES : NEW_CUES
      const cueSpans = allMatchesWithSpans(
        text,
        cues.map((c) => [c, true] as [RegExp, boolean]),
      ).spans
      if (cueSpans.length > 0) intent.evidence.restoration_intent = cueSpans
    }

    intent.existingRestoration = firstMatch(scope, EXISTING_RESTORATION)
    if (intent.existingRestoration) {
      const existingSpans = allMatchesWithSpans(text, EXISTING_RESTORATION).spans
      if (existingSpans.length > 0) intent.evidence.existing_restoration = existingSpans
    }

    if (intent.category === 'DIAGNOSTIC') {
      intent.imageCount = extractImageCount(scoped.text) ?? extractImageCount(text)
    }

    intent.ageBand = ageBand

    const quadCues = allMatches(text, QUADRANT_CUES)
    if (quadCues.length > 0) intent.quadrants = [...new Set([...intent.quadrants, ...quadCues])]
    const archCues = allMatches(text, ARCH_CUES)
    if (archCues.length > 0) intent.arches = [...new Set([...intent.arches, ...archCues])]

    // Procedure-specific attributes.
    if (match.def.key === 'extraction') {
      const complexity = extractionComplexity(text)
      if (complexity) intent.attributes.extraction_complexity = complexity
      const state = eruptedState(text)
      if (state) intent.attributes.erupted_state = state
      // An impaction classification implies the tooth was impacted.
      if (['soft tissue', 'partially bony', 'completely bony'].includes(complexity ?? '')) {
        intent.attributes.erupted_state = 'impacted'
      }
    }
    if (match.def.key === 'crown' || match.def.key === 'implant_crown') {
      const cm = crownMaterial(intent.materials)
      if (cm) intent.attributes.crown_material = cm
    }
    if (match.def.key === 'fluoride_treatment') {
      if (/\bvarnish\b/i.test(text)) intent.attributes.fluoride_form = 'varnish'
      else if (/\b(?:gel|foam|tray)\b/i.test(text)) intent.attributes.fluoride_form = 'gel_or_foam'
    }
    if (match.def.key === 'prophylaxis' && ageBand) {
      intent.attributes.age_band = ageBand.toLowerCase()
    }
    if (match.def.key === 'inlay_onlay') {
      if (/\bonlays?\b/i.test(text)) intent.attributes.restoration_shape = 'onlay'
      else if (/\binlays?\b/i.test(text)) intent.attributes.restoration_shape = 'inlay'
    }
    if (match.def.key === 'complete_denture' || match.def.key === 'partial_denture') {
      if (/\bimmediate\b/i.test(text)) intent.attributes.denture_timing = 'immediate'
    }
    if (match.def.key === 'pulp_cap') {
      if (/\bdirect\b/i.test(text)) intent.attributes.pulp_cap_type = 'direct'
      else if (/\bindirect\b/i.test(text)) intent.attributes.pulp_cap_type = 'indirect'
    }
    if (match.def.key === 'bitewing_radiographs' || match.def.key === 'periapical_radiograph') {
      intent.imageCount = extractImageCount(text)
    }
    if (match.def.key === 'occlusal_guard') {
      if (/\bhard\b/i.test(text)) intent.attributes.guard_type = 'hard'
      else if (/\bsoft\b/i.test(text)) intent.attributes.guard_type = 'soft'
    }

    intents.push(intent)
  })

  applyAnswers(intents, options.answers ?? {})

  if (globalTeeth.invalid.length > 0) {
    for (const bad of globalTeeth.invalid) {
      observations.push(
        `"${bad}" was read as a tooth reference but is not a valid tooth number. Permanent teeth are 1–32 and primary teeth are A–T. Confirm the tooth.`,
      )
    }
  }

  if (kindMatches.length === 0 && text.length > 0) {
    ambiguities.push('The procedure performed could not be identified from this description.')
  }

  return {
    intents,
    dentition: globalDentitionStated ?? inferDentition(intents),
    ageBand,
    invalidTeeth: globalTeeth.invalid,
    ambiguities,
    observations: [...new Set(observations)],
  }
}

function inferDentition(intents: ProcedureIntent[]): Dentition | null {
  const set = new Set(intents.map((i) => i.dentition).filter((d): d is Dentition => d !== null))
  return set.size === 1 ? ([...set][0] ?? null) : null
}

/**
 * Folds answers to clarifying questions back into the facts. Answers are
 * treated exactly like original input: parsed, validated, and never trusted
 * as free text.
 */
export function applyAnswers(
  intents: ProcedureIntent[],
  answers: Record<string, string>,
): void {
  for (const [key, rawAnswer] of Object.entries(answers)) {
    const answer = rawAnswer.trim()
    if (!answer) continue

    // Keys are "<intentId>:<factKey>", or a bare factKey for single-procedure input.
    const [maybeId, maybeFact] = key.includes(':') ? key.split(':') : [null, key]
    const factKey = maybeFact ?? key
    const targets = maybeId ? intents.filter((i) => i.id === maybeId) : intents

    for (const intent of targets) {
      switch (factKey) {
        case 'surfaces': {
          const surfaces = parseSurfaceAnswer(answer)
          if (surfaces.length > 0) {
            intent.surfaces = surfaces
            intent.surfaceCount = surfaces.length
          }
          break
        }
        case 'tooth_numbers': {
          const found = extractTeeth(answer)
          const teeth =
            found.teeth.length > 0
              ? found.teeth
              : ([parseTooth(answer)].filter(Boolean) as ToothFacts[])
          if (teeth.length > 0) {
            intent.toothIds = teeth.map((t) => t.id)
            const regions = new Set(teeth.map((t) => t.region))
            intent.toothRegion = regions.size === 1 ? (teeth[0]?.region ?? null) : null
            const dents = new Set(teeth.map((t) => t.dentition))
            intent.dentition = dents.size === 1 ? (teeth[0]?.dentition ?? null) : null
            intent.quadrants = [...new Set(teeth.map((t) => t.quadrant))]
            intent.arches = [...new Set(teeth.map((t) => t.arch))]
          }
          break
        }
        case 'material': {
          const materials = allMatches(answer, MATERIALS)
          if (materials.length > 0) intent.materials = materials
          const cm = crownMaterial(materials)
          if (cm) intent.attributes.crown_material = cm
          break
        }
        case 'dentition': {
          const d = statedDentition(answer)
          if (d) intent.dentition = d
          break
        }
        case 'age_band': {
          const band = firstMatch(answer, AGE_CUES)
          if (band) {
            intent.ageBand = band
            intent.attributes.age_band = band.toLowerCase()
          }
          break
        }
        case 'image_count': {
          const count = extractImageCount(answer) ?? Number(answer.match(/\d{1,2}/)?.[0] ?? NaN)
          if (Number.isFinite(count) && count > 0) intent.imageCount = count
          break
        }
        case 'restoration_intent': {
          if (REPLACEMENT_CUES.some((c) => c.test(answer)) || /\byes\b/i.test(answer)) {
            intent.restorationIntent = 'REPLACEMENT'
          } else if (NEW_CUES.some((c) => c.test(answer)) || /\bno\b|\bnew\b/i.test(answer)) {
            intent.restorationIntent = 'NEW'
          }
          break
        }
        case 'extraction_complexity': {
          const complexity = extractionComplexity(answer)
          if (complexity) intent.attributes.extraction_complexity = complexity
          const state = eruptedState(answer)
          if (state) intent.attributes.erupted_state = state
          else if (complexity === 'simple' || complexity === 'surgical') {
            intent.attributes.erupted_state = 'erupted'
          } else if (complexity && complexity !== 'impacted') {
            intent.attributes.erupted_state = 'impacted'
          }
          break
        }
        case 'evaluation_type': {
          const lower = answer.toLowerCase()
          if (/comprehensive|new patient/.test(lower)) intent.procedureKind = 'comprehensive_oral_evaluation'
          else if (/periodic|recall/.test(lower)) intent.procedureKind = 'periodic_oral_evaluation'
          else if (/limited|emergency|problem/.test(lower)) intent.procedureKind = 'limited_oral_evaluation'
          if (intent.procedureKind) intent.category = categoryForKind(intent.procedureKind)
          break
        }
        default: {
          // Unknown discriminators are recorded verbatim so the ranker can use
          // them if a code declares that attribute.
          intent.attributes[factKey] = answer.toLowerCase()
        }
      }
    }
  }
}
