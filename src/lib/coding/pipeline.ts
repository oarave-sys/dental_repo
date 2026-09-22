import type { CodeRepository, ProcedureCodeRecord } from '@/lib/codes/types'
import { codeRepository } from '@/lib/codes'
import { extractionProvider, type ExtractionUsage } from './ai'
import { extractFacts } from './extract'
import { genericQuestion, questionOptions, reviewDocumentation } from './documentation'
import { rankCandidates, type CandidateScore } from './rank'
import { DISCRIMINATOR_TO_FACT, factLabel } from '@/lib/codes/attributes'
import { procedureLabel, type ProcedureCategory } from './vocabulary'
import { describeSurfaces, formatSurfaces } from './surfaces'
import { formatTeeth } from './teeth'
import { buildHighlights, reconcile } from './evidence'
import type { ExtractedFacts, DisplayFact, ProcedureIntent } from './facts'
import type {
  AlternativeCode,
  CandidateChoice,
  CandidateComparison,
  CodingResult,
  CodingWarning,
  Confidence,
  FollowUpQuestion,
  ProcedureResult,
  RecommendedCode,
} from './result'

/**
 * The coding pipeline.
 *
 * Steps 1-7 of the engine, in order. The language model appears in exactly one
 * of them (step 1). Everything after operates on structured facts and the
 * approved reference database, which is what makes the output reproducible and
 * auditable rather than a generated opinion.
 *
 *   1  extract clinical facts        extract.ts        (AI + rules)
 *   2  identify procedure family     vocabulary.ts     (rules)
 *   3  retrieve candidate codes      CodeRepository    (database only)
 *   4  determine missing information this file + rank  (rules)
 *   5  rank candidates               rank.ts           (rules)
 *   6  review documentation          documentation.ts  (rules)
 *   7  assemble validated output     this file         (rules)
 */

export interface AnalyseOptions {
  repository?: CodeRepository
  /** Pass null to force deterministic-only extraction. */
  useAi?: boolean
  /** Answers to previously asked clarifying questions, keyed "<intentId>:<factKey>". */
  answers?: Record<string, string>
  priorAnswers?: Array<{ question: string; answer: string }>
  /** Codes the user has already selected, for the mismatch check. */
  selectedCodes?: string[]
}

export interface AnalyseOutput {
  result: CodingResult
  usage: ExtractionUsage | null
}

export async function analyse(input: string, options: AnalyseOptions = {}): Promise<AnalyseOutput> {
  const repository = options.repository ?? codeRepository()
  const provider = options.useAi === false ? null : extractionProvider()

  // ---- Step 1: facts -----------------------------------------------------
  const { facts, aiAssisted, usage } = await extractFacts(input, {
    provider,
    answers: options.answers ?? {},
    priorAnswers: options.priorAnswers ?? [],
  })

  const warnings: CodingWarning[] = []
  for (const observation of facts.observations) {
    warnings.push({ severity: 'REVIEW', message: observation, intentId: null })
  }
  for (const ambiguity of facts.ambiguities) {
    warnings.push({ severity: 'INFO', message: ambiguity, intentId: null })
  }

  const procedures: ProcedureResult[] = []
  const followUps: FollowUpQuestion[] = []
  const codesByIntent = new Map<string, string[]>()

  for (const intent of facts.intents) {
    // ---- Steps 2 and 3: family, then retrieval from the database ---------
    const candidates = intent.procedureKind
      ? await repository.findByProcedureKind(intent.procedureKind)
      : []

    if (candidates.length === 0) {
      procedures.push({
        intentId: intent.id,
        procedureSummary: summariseIntent(intent),
        category: intent.category,
        recommended: [],
        alternatives: [],
        factsUsed: displayFacts(intent, input),
        confidence: 'LOW',
        awaitingAnswer: false,
        choice: null,
      })
      warnings.push({
        severity: 'REVIEW',
        message: intent.procedureKind
          ? `No code for ${procedureLabel(intent.procedureKind).toLowerCase()} was found in the active reference dataset. This tool only returns codes present in that dataset.`
          : 'The procedure performed could not be identified from this description. Try describing what was done in a little more detail.',
        intentId: intent.id,
      })
      continue
    }

    // ---- Steps 4 and 5: rank, and notice what remains open ---------------
    const ranking = rankCandidates(candidates, intent)
    for (const conflict of ranking.conflicts) {
      warnings.push({ severity: 'CONFLICT', message: conflict, intentId: intent.id })
    }

    const surviving = ranking.surviving
    const blocking = ranking.openDiscriminators

    // A question is asked only when answering it would actually change the
    // recommendation. Anything else would be a question for its own sake.
    for (const factKey of blocking) {
      followUps.push({
        key: `${intent.id}:${factKey}`,
        factKey,
        intentId: intent.id,
        question: await questionFor(repository, intent, factKey),
        options: questionOptions(factKey),
        blockingCodes: surviving.map((s) => s.record.code),
      })
    }

    const awaitingAnswer = blocking.length > 0
    const confidence = confidenceFor(surviving, blocking)

    const recommended: RecommendedCode[] = awaitingAnswer
      ? []
      : surviving.slice(0, 1).map((s) => toRecommended(s, intent, confidence))

    const alternatives = awaitingAnswer
      ? []
      : buildAlternatives(surviving, candidates, intent)

    codesByIntent.set(intent.id, [
      ...recommended.map((r) => r.code),
      ...(awaitingAnswer ? surviving.map((s) => s.record.code) : []),
    ])

    procedures.push({
      intentId: intent.id,
      procedureSummary: summariseIntent(intent),
      category: intent.category,
      recommended,
      alternatives,
      factsUsed: displayFacts(intent, input),
      confidence,
      awaitingAnswer,
      choice: awaitingAnswer ? buildChoice(intent.id, surviving, blocking) : null,
    })
  }

  // ---- Step 6: documentation review -------------------------------------
  const review = await reviewDocumentation(repository, facts.intents, codesByIntent)

  // A required coding fact that is missing but was not already asked about
  // still needs asking — the ranker only notices facts its candidates disagree
  // on, and a fact can be required without being discriminating.
  for (const key of review.unmetRequiredFactKeys) {
    if (followUps.some((f) => f.key === key)) continue
    const [intentId, factKey] = key.split(':')
    if (!intentId || !factKey) continue
    const intent = facts.intents.find((i) => i.id === intentId)
    if (!intent) continue
    followUps.push({
      key,
      factKey,
      intentId,
      question: await questionFor(repository, intent, factKey),
      options: questionOptions(factKey),
      blockingCodes: codesByIntent.get(intentId) ?? [],
    })
  }

  // Two rules can arrive at the same question by different routes. Ask once.
  const deduped: FollowUpQuestion[] = []
  const seen = new Set<string>()
  for (const q of followUps) {
    const signature = `${q.intentId}::${q.question.toLowerCase()}`
    if (seen.has(signature)) continue
    seen.add(signature)
    deduped.push(q)
  }
  followUps.length = 0
  followUps.push(...deduped)

  // ---- Selected-code comparison (Check a Code) --------------------------
  if (options.selectedCodes && options.selectedCodes.length > 0) {
    warnings.push(
      ...(await compareSelected(repository, options.selectedCodes, procedures, facts)),
    )
  }

  // ---- Step 7: assemble, then validate before returning ------------------
  const info = await repository.info()
  const allRecommended = procedures.flatMap((p) => p.recommended)
  const allAlternatives = procedures.flatMap((p) => p.alternatives)
  // Any procedure still holding back a recommendation makes the whole
  // analysis incomplete — a resolved sibling does not settle it.
  const status =
    procedures.some((p) => p.awaitingAnswer) ||
    (followUps.length > 0 && allRecommended.length === 0)
      ? 'NEEDS_INPUT'
      : 'COMPLETE'

  const result: CodingResult = {
    procedures,
    recommendedCodes: allRecommended,
    alternativeCodes: allAlternatives,
    confidence: overallConfidence(procedures),
    procedureSummary: procedures.map((p) => p.procedureSummary).join('; ') || 'No procedure identified',
    factsUsed: procedures.flatMap((p) => p.factsUsed),
    missingInformation: review.score.needsReview.map((item) => item.detail),
    followUpQuestions: followUps,
    documentation: review.score,
    warnings,
    reasoningSummary: buildReasoningSummary(procedures, followUps, facts),
    status,
    dataset: { key: info.key, kind: info.kind, name: info.name },
    aiAssisted,
    evidence: {
      source: input,
      segments: buildHighlights(
        input,
        procedures.flatMap((p) =>
          p.factsUsed
            .filter((f) => f.spans.length > 0)
            .map((f) => ({ factKey: `${p.intentId}:${f.factKey}`, spans: f.spans })),
        ),
      ),
    },
  }

  return { result: await validateResult(result, repository), usage }
}

/**
 * Builds the side-by-side view of what is still possible.
 *
 * Reads the actual attribute values off each surviving candidate, so the
 * comparison shows the real difference between the codes rather than a
 * restatement of the question.
 */
function buildChoice(
  intentId: string,
  surviving: CandidateScore[],
  blockingFactKeys: string[],
): CandidateChoice | null {
  if (surviving.length < 2 || blockingFactKeys.length === 0) return null

  // Attribute keys, grouped by the fact that would resolve them.
  const attrKeysByFact = new Map<string, string[]>()
  for (const [attrKey, factKey] of Object.entries(DISCRIMINATOR_TO_FACT)) {
    if (!blockingFactKeys.includes(factKey)) continue
    attrKeysByFact.set(factKey, [...(attrKeysByFact.get(factKey) ?? []), attrKey])
  }

  const factKeys = blockingFactKeys.filter((f) => attrKeysByFact.has(f))
  if (factKeys.length === 0) return null

  const candidates: CandidateComparison[] = surviving.slice(0, 6).map((scored, index) => {
    const distinguishingValues: Record<string, string> = {}
    for (const factKey of factKeys) {
      const values: string[] = []
      for (const attrKey of attrKeysByFact.get(factKey) ?? []) {
        for (const value of scored.record.attributes.values(attrKey)) {
          values.push(describeAttributeValue(attrKey, value))
        }
      }
      distinguishingValues[factKey] = values.length > 0 ? [...new Set(values)].join(', ') : '—'
    }
    return {
      code: scored.record.code,
      shortLabel: scored.record.shortLabel,
      distinguishingValues,
      leading: index === 0,
    }
  })

  const names = factKeys.map((f) => factLabel(f).toLowerCase()).join(' and ')
  return {
    intentId,
    distinguishingFactKeys: factKeys,
    candidates,
    specificityNote: `Which code applies depends on ${names}. ${candidates.length} candidates shown.`,
  }
}

/** Turns a raw attribute value into something a person reads comfortably. */
function describeAttributeValue(attrKey: string, value: string): string {
  if (attrKey === 'surface_count') {
    return value === '4' ? 'four or more surfaces' : `${value} surface${value === '1' ? '' : 's'}`
  }
  if (attrKey === 'surface_count_min') return `${value}+ surfaces`
  if (attrKey === 'teeth_per_quadrant_min') return `${value}+ teeth per quadrant`
  if (attrKey === 'teeth_per_quadrant_max') return `up to ${value} teeth per quadrant`
  if (attrKey === 'image_count') return `${value} image${value === '1' ? '' : 's'}`
  return value.replace(/_/g, ' ')
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * High confidence requires that the facts supplied actually separate the
 * recommendation from its rivals — a single surviving candidate with nothing
 * left open. Anything less says so.
 */
function confidenceFor(surviving: CandidateScore[], openFacts: string[]): Confidence {
  if (surviving.length === 0) return 'LOW'
  if (openFacts.length > 0) return 'LOW'
  if (surviving.length === 1) return 'HIGH'

  const top = surviving[0]
  const next = surviving[1]
  if (!top || !next) return 'MEDIUM'
  // A clear scoring gap with no open questions means the facts did the work.
  return top.score - next.score >= 30 ? 'HIGH' : 'MEDIUM'
}

function overallConfidence(procedures: ProcedureResult[]): Confidence {
  if (procedures.length === 0) return 'LOW'
  const scale: Confidence[] = ['HIGH', 'MEDIUM', 'LOW']
  return procedures
    .map((p) => p.confidence)
    .reduce((worst, c) => (scale.indexOf(c) > scale.indexOf(worst) ? c : worst), 'HIGH' as Confidence)
}

// ---------------------------------------------------------------------------
// Presentation helpers — all deterministic, all traceable to a fact.
// ---------------------------------------------------------------------------

function toRecommended(
  scored: CandidateScore,
  intent: ProcedureIntent,
  confidence: Confidence,
): RecommendedCode {
  const reasons = scored.matchedOn.length > 0 ? scored.matchedOn.join(', ') : 'the procedure described'
  return {
    code: scored.record.code,
    shortLabel: scored.record.shortLabel,
    plainLanguage: scored.record.plainLanguage,
    officialDescriptor: scored.record.officialDescriptor,
    category: scored.record.category,
    confidence,
    why: `Based on the information provided: ${reasons}.`,
    matchedOn: scored.matchedOn,
    intentId: intent.id,
  }
}

/**
 * Alternatives are shown only when legitimately relevant: a candidate that
 * survived the facts, or one eliminated by a single fact the user might have
 * recorded differently. A list of everything in the family would be noise.
 */
function buildAlternatives(
  surviving: CandidateScore[],
  candidates: readonly ProcedureCodeRecord[],
  intent: ProcedureIntent,
): AlternativeCode[] {
  const out: AlternativeCode[] = []
  const chosen = surviving[0]

  for (const other of surviving.slice(1, 4)) {
    out.push({
      code: other.record.code,
      shortLabel: other.record.shortLabel,
      distinction:
        chosen?.record.relationships.find((r) => r.toCode === other.record.code)?.note ??
        other.record.distinctions ??
        'A different code within the same procedure family.',
      intentId: intent.id,
    })
  }

  // Where exactly one code survived, the near-misses are still worth showing:
  // they are what the practice should check if a fact was mis-recorded.
  if (out.length === 0 && chosen) {
    const related = chosen.record.relationships.filter(
      (r) => r.type === 'SAME_FAMILY_DIFFERENT_COUNT' || r.type === 'COMMONLY_CONFUSED_WITH',
    )
    for (const rel of related.slice(0, 3)) {
      const record = candidates.find((c) => c.code === rel.toCode)
      out.push({
        code: rel.toCode,
        shortLabel: record?.shortLabel ?? rel.toCode,
        distinction: rel.note ?? 'A closely related code.',
        intentId: intent.id,
      })
    }
  }

  return out
}

function summariseIntent(intent: ProcedureIntent): string {
  const parts: string[] = []
  if (intent.procedureKind) parts.push(procedureLabel(intent.procedureKind))
  else parts.push('Unidentified procedure')
  if (intent.toothIds.length > 0) parts.push(formatTeeth(intent.toothIds))
  if (intent.surfaces.length > 0) parts.push(formatSurfaces(intent.surfaces))
  return parts.join(' · ')
}

/**
 * Builds the "Facts identified" rows, each carrying the span of the input it
 * was read from.
 *
 * A fact is `derived` when it follows from another fact rather than being
 * written down — #30 being posterior is a lookup, not something the note says
 * — and derived facts deliberately carry no span. Showing a highlight for
 * them would claim the user wrote something they did not.
 */
function displayFacts(intent: ProcedureIntent, source: string): DisplayFact[] {
  const facts: DisplayFact[] = []

  const add = (
    label: string,
    value: string | null,
    factKey: string,
    source_: 'stated' | 'derived' = 'stated',
  ) => {
    if (!value) return
    const spans = source_ === 'derived' ? [] : reconcile(source, intent.evidence[factKey] ?? [])
    const origin: DisplayFact['origin'] =
      source_ === 'derived' ? 'derived' : spans.length > 0 ? (intent.quotedFacts?.includes(factKey) ? 'quoted' : 'matched') : 'unlocated'
    facts.push({ label, value, source: source_, factKey, spans, origin })
  }

  if (intent.procedureKind) add('Procedure', procedureLabel(intent.procedureKind), 'procedure')
  if (intent.toothIds.length > 0) add('Tooth', formatTeeth(intent.toothIds), 'tooth_numbers')
  if (intent.surfaces.length > 0) {
    add(
      'Surfaces',
      `${formatSurfaces(intent.surfaces)} — ${describeSurfaces(intent.surfaces)}`,
      'surfaces',
    )
    add('Surface count', String(intent.surfaceCount), 'surfaces', 'derived')
  }
  if (intent.materials.length > 0) add('Material', intent.materials.join(', '), 'material')
  if (intent.toothRegion) add('Tooth position', intent.toothRegion.toLowerCase(), 'tooth_numbers', 'derived')
  if (intent.dentition) add('Dentition', intent.dentition.toLowerCase(), 'dentition', 'derived')
  if (intent.existingRestoration) {
    add('Existing restoration', intent.existingRestoration, 'existing_restoration')
  }
  if (intent.restorationIntent) {
    add(
      'New or replacement',
      intent.restorationIntent === 'REPLACEMENT' ? 'replacement' : 'new restoration',
      'restoration_intent',
    )
  }
  if (intent.clinicalReasons.length > 0) {
    add('Reason for treatment', intent.clinicalReasons.join(', '), 'clinical_reasons')
  }
  if (intent.imageCount !== null) add('Images', String(intent.imageCount), 'image_count')
  if (intent.quadrants.length > 0) add('Quadrant', intent.quadrants.join(', '), 'quadrants', 'derived')
  if (intent.arches.length > 0) add('Arch', intent.arches.join(', ').toLowerCase(), 'arch', 'derived')
  if (intent.ageBand) add('Dentition age band', intent.ageBand.toLowerCase(), 'age_band')
  for (const [key, value] of Object.entries(intent.attributes)) {
    add(key.replace(/_/g, ' '), value, key)
  }
  return facts
}

/** Prefers the dataset's own wording for a question, falling back to a generic one. */
async function questionFor(
  repository: CodeRepository,
  intent: ProcedureIntent,
  factKey: string,
): Promise<string> {
  const rules = intent.category
    ? await repository.documentationRules({ category: intent.category })
    : []
  const rule = rules.find((r) => r.factKey === factKey)
  const base = rule?.promptQuestion ?? genericQuestion(factKey)
  // Name the tooth when one is known, so a multi-procedure answer is unambiguous.
  if (intent.toothIds.length === 1 && factKey === 'surfaces') {
    return `Which surface or surfaces were restored on ${formatTeeth(intent.toothIds)}?`
  }
  return base
}

function buildReasoningSummary(
  procedures: ProcedureResult[],
  followUps: FollowUpQuestion[],
  facts: ExtractedFacts,
): string {
  if (procedures.length === 0) {
    return 'No procedure could be identified from the description provided.'
  }

  const lines: string[] = []
  const named =
    procedures.length === 1 ? 'one procedure' : `${procedures.length} procedures`
  lines.push(`Identified ${named} in the description.`)

  for (const procedure of procedures) {
    const top = procedure.recommended[0]
    // The summary is not lowercased: it carries tooth numbers and surface
    // shorthand, and "mod" reads as a word where "MOD" reads as surfaces.
    if (top) {
      lines.push(
        `For ${procedure.procedureSummary}, ${top.code} is the most likely code based on ${top.matchedOn.join(' and ') || 'the procedure described'}.`,
      )
    } else if (procedure.awaitingAnswer) {
      lines.push(
        `For ${procedure.procedureSummary}, more than one code remains possible until one more detail is confirmed.`,
      )
    }
  }

  // Only worth saying when it is not already obvious from the lines above:
  // with a single procedure, the per-procedure line has said it.
  if (followUps.length > 1 || procedures.length > 1) {
    lines.push(
      followUps.length === 1
        ? 'One detail is needed before a code can be confirmed.'
        : `${followUps.length} details are needed before codes can be confirmed.`,
    )
  }

  if (facts.invalidTeeth.length > 0) {
    lines.push('A tooth reference in the description is not a valid tooth number.')
  }

  return lines.join(' ')
}

// ---------------------------------------------------------------------------
// Check a Code — comparing a selected code with what was documented.
// ---------------------------------------------------------------------------

async function compareSelected(
  repository: CodeRepository,
  selected: string[],
  procedures: ProcedureResult[],
  facts: ExtractedFacts,
): Promise<CodingWarning[]> {
  const warnings: CodingWarning[] = []

  for (const raw of selected) {
    const code = raw.trim().toUpperCase()
    const record = await repository.findByCode(code)

    if (!record) {
      warnings.push({
        severity: 'CONFLICT',
        message: `${code} was not found in the active procedure-code dataset. No explanation can be given for a code this tool cannot verify.`,
        intentId: null,
      })
      continue
    }

    const engineCodes = procedures.flatMap((p) => p.recommended.map((r) => r.code))
    if (engineCodes.includes(code)) {
      warnings.push({
        severity: 'INFO',
        message: `${code} matches what the description supports.`,
        intentId: null,
      })
      continue
    }

    // Re-rank this specific code against the facts to explain the mismatch.
    const intent = facts.intents.find(
      (i) => i.procedureKind && record.attributes.has('procedure_kind', i.procedureKind),
    )

    if (!intent) {
      warnings.push({
        severity: 'REVIEW',
        message: `${code} (${record.shortLabel}) does not appear to describe the procedure in this note. Confirm which procedure the claim is for.`,
        intentId: null,
      })
      continue
    }

    const ranked = rankCandidates([record], intent)
    const eliminated = ranked.eliminated[0]
    if (eliminated?.eliminatedBecause) {
      warnings.push({
        severity: 'CONFLICT',
        message: `${code} (${record.shortLabel}) appears inconsistent with the documentation. ${eliminated.eliminatedBecause}`,
        intentId: intent.id,
      })
    } else if (engineCodes.length > 0) {
      warnings.push({
        severity: 'REVIEW',
        message: `${code} is possible, but the documentation most closely supports ${engineCodes.join(', ')}. Confirm which reflects what was done.`,
        intentId: intent.id,
      })
    }
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Final validation. Nothing is rendered that has not passed this.
// ---------------------------------------------------------------------------

/**
 * The last line of defence before the result reaches a screen.
 *
 * Re-checks every code in the assembled output against the database. If a code
 * cannot be found — however it got there — it is removed and a warning takes
 * its place. This should never fire; it exists so that if it ever does, the
 * failure is a missing recommendation rather than an invented one.
 */
export async function validateResult(
  result: CodingResult,
  repository: CodeRepository,
): Promise<CodingResult> {
  const referenced = [
    ...result.recommendedCodes.map((c) => c.code),
    ...result.alternativeCodes.map((c) => c.code),
  ]
  if (referenced.length === 0) return result

  const found = new Set(
    (await repository.findManyByCode([...new Set(referenced)])).map((r) => r.code),
  )
  const unknown = referenced.filter((c) => !found.has(c))
  if (unknown.length === 0) return result

  const warnings: CodingWarning[] = [
    ...result.warnings,
    {
      severity: 'CONFLICT',
      message: `An internal check removed ${unknown.length} code reference that could not be verified against the active dataset. Please re-run this analysis.`,
      intentId: null,
    },
  ]

  return {
    ...result,
    warnings,
    recommendedCodes: result.recommendedCodes.filter((c) => found.has(c.code)),
    alternativeCodes: result.alternativeCodes.filter((c) => found.has(c.code)),
    procedures: result.procedures.map((p) => ({
      ...p,
      recommended: p.recommended.filter((c) => found.has(c.code)),
      alternatives: p.alternatives.filter((c) => found.has(c.code)),
    })),
  }
}

export type { ProcedureCategory }
