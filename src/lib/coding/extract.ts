import { PROCEDURE_KEYS, categoryForKind } from './vocabulary'
import { applyAnswers, extractDeterministic } from './extract-deterministic'
import { parseTooth } from './teeth'
import { parseSurfaceAnswer } from './surfaces'
import { emptyIntent, type AiExtraction, type ExtractedFacts } from './facts'
import { locateQuote } from './evidence'
import type { ExtractionUsage, FactExtractionProvider } from './ai'

/**
 * Step 1 — clinical fact extraction.
 *
 * Deterministic rules run first and always. The language model runs second and
 * is allowed to ADD facts the rules missed, never to overwrite one they found.
 * The asymmetry is deliberate: a regular expression that matched "#30" is more
 * trustworthy about the tooth than a model is, and the failure mode we care
 * most about — a confidently wrong fact silently steering code selection — is
 * the one this ordering removes.
 *
 * Everything the model returns is re-validated before it is believed: tooth
 * numbers through the tooth parser, surfaces through the surface parser,
 * procedure kinds against the controlled vocabulary. A hallucinated tooth "#45"
 * or a made-up procedure key is dropped here, not rendered.
 */

export interface ExtractionResult {
  facts: ExtractedFacts
  aiAssisted: boolean
  usage: ExtractionUsage | null
}

export interface ExtractOptions {
  provider?: FactExtractionProvider | null
  answers?: Record<string, string>
  priorAnswers?: Array<{ question: string; answer: string }>
}

export async function extractFacts(
  input: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const deterministic = extractDeterministic(input, { answers: options.answers })

  const provider = options.provider
  if (!provider) return { facts: deterministic, aiAssisted: false, usage: null }

  const { extraction, usage } = await provider.extract({
    text: input,
    priorAnswers: options.priorAnswers ?? [],
  })

  if (!extraction) return { facts: deterministic, aiAssisted: false, usage }

  const merged = merge(deterministic, extraction, options.answers ?? {}, input)
  return { facts: merged, aiAssisted: true, usage }
}

/**
 * Folds model output into the deterministic facts.
 *
 * Matching is by procedure kind: where both found the same procedure, the
 * model fills only the empty fields. Where only the model found a procedure,
 * it is added — but every value still passes the validators first.
 */
function merge(
  base: ExtractedFacts,
  ai: AiExtraction,
  answers: Record<string, string>,
  source: string,
): ExtractedFacts {
  const intents = [...base.intents]
  const observations = [...base.observations]

  for (const aiProc of ai.procedures) {
    const kind = PROCEDURE_KEYS.includes(aiProc.procedure_kind)
      ? aiProc.procedure_kind
      : null
    // A procedure key outside the vocabulary is not a fact; it is noise.
    if (!kind) continue

    const existing = intents.find((i) => i.procedureKind === kind)
    const intent = existing ?? emptyIntent(`p${intents.length + 1}`)
    let newlyAdded = false
    if (!existing) {
      intent.procedureKind = kind
      intent.category = categoryForKind(kind)
      intent.sourceText = aiProc.source_text || base.intents[0]?.sourceText || ''
      intents.push(intent)
      newlyAdded = true
    }

    /**
     * Records evidence for a fact the model supplied.
     *
     * The model's quote is LOCATED in the source rather than trusted as an
     * offset, because an offset it invented would highlight the wrong words
     * with total confidence. A quote that cannot be found leaves the fact
     * without a span, and the UI says so.
     */
    const noteQuoted = (factKey: string) => {
      if (intent.evidence[factKey]?.length) return
      const located = aiProc.source_text ? locateQuote(source, aiProc.source_text) : null
      if (located) {
        intent.evidence[factKey] = [located]
        if (!intent.quotedFacts.includes(factKey)) intent.quotedFacts.push(factKey)
      }
    }

    // Teeth — validated, and only when the rules found none.
    if (intent.toothIds.length === 0) {
      const teeth = aiProc.tooth_numbers
        .map((t) => parseTooth(t))
        .filter((t): t is NonNullable<typeof t> => t !== null)
      if (teeth.length > 0) {
        intent.toothIds = teeth.map((t) => t.id)
        noteQuoted('tooth_numbers')
        const regions = new Set(teeth.map((t) => t.region))
        intent.toothRegion = regions.size === 1 ? (teeth[0]?.region ?? null) : null
        const dents = new Set(teeth.map((t) => t.dentition))
        intent.dentition = intent.dentition ?? (dents.size === 1 ? (teeth[0]?.dentition ?? null) : null)
        intent.quadrants = [...new Set(teeth.map((t) => t.quadrant))]
        intent.arches = [...new Set(teeth.map((t) => t.arch))]
      }
    }

    // Surfaces — only for procedures where surfaces are meaningful, and only
    // when the rules found none. This is the field a model is most tempted to
    // fill in from the procedure name, so it is guarded hardest.
    if (intent.surfaces.length === 0 && aiProc.surfaces.length > 0) {
      const surfaces = parseSurfaceAnswer(aiProc.surfaces.join(''))
      const relevant =
        intent.category === 'RESTORATIVE' ||
        intent.procedureKind === 'sealant' ||
        intent.procedureKind === 'inlay_onlay'
      if (relevant && surfaces.length > 0) {
        intent.surfaces = surfaces
        intent.surfaceCount = surfaces.length
        noteQuoted('surfaces')
      }
    }

    if (newlyAdded) noteQuoted('procedure')

    if (intent.materials.length === 0 && aiProc.materials.length > 0) {
      intent.materials = aiProc.materials.map((m) => m.toLowerCase())
      noteQuoted('material')
    }
    if (intent.clinicalReasons.length === 0 && aiProc.clinical_reasons.length > 0) {
      intent.clinicalReasons = aiProc.clinical_reasons.map((r) => r.toLowerCase())
      noteQuoted('clinical_reasons')
    }
    if (intent.existingRestoration === null) {
      intent.existingRestoration = aiProc.existing_restoration
    }
    if (intent.restorationIntent === null && aiProc.is_replacement !== null) {
      intent.restorationIntent = aiProc.is_replacement ? 'REPLACEMENT' : 'NEW'
    }
    if (intent.imageCount === null && aiProc.image_count !== null) {
      intent.imageCount = aiProc.image_count
    }
    if (intent.arches.length === 0) {
      intent.arches = aiProc.arches
        .map((a) => a.toUpperCase())
        .filter((a): a is 'MAXILLARY' | 'MANDIBULAR' => a === 'MAXILLARY' || a === 'MANDIBULAR')
    }
    if (intent.quadrants.length === 0) {
      intent.quadrants = aiProc.quadrants
        .map((q) => q.toUpperCase())
        .filter((q): q is 'UR' | 'UL' | 'LL' | 'LR' =>
          q === 'UR' || q === 'UL' || q === 'LL' || q === 'LR',
        )
    }
    for (const [key, value] of Object.entries(aiProc.attributes)) {
      if (!(key in intent.attributes)) intent.attributes[key] = String(value).toLowerCase()
    }
  }

  const dentition = base.dentition ?? ai.dentition
  const ageBand = base.ageBand ?? ai.age_band
  for (const intent of intents) {
    if (!intent.dentition && dentition) intent.dentition = dentition
    if (!intent.ageBand && ageBand) intent.ageBand = ageBand
    if (ageBand && !intent.attributes.age_band && intent.procedureKind === 'prophylaxis') {
      intent.attributes.age_band = ageBand.toLowerCase()
    }
  }

  // Answers are applied last so a clarification always wins, including over
  // anything the model supplied for the same fact.
  if (Object.keys(answers).length > 0) applyAnswers(intents, answers)

  return {
    intents,
    dentition,
    ageBand,
    invalidTeeth: base.invalidTeeth,
    ambiguities: [...new Set([...base.ambiguities, ...ai.ambiguities])],
    observations,
  }
}
