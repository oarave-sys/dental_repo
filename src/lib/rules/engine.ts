import { matchCode, matchText, normalizeCode, MATCH_STRENGTH, isInRange } from '@/lib/icd10'
import type {
  CompiledRule, CompiledRuleSet, DiagnosisFact, DimensionResult, RuleAction,
  RuleCondition, TriageDimension, TriageEvaluationResult, TriageFacts, TriageOutcome,
} from './types'

/**
 * The deterministic triage engine.
 *
 * Pure: facts in, result out. No database, no network, no clock. That is what
 * makes the whole §58 test matrix a set of fixtures rather than an integration
 * suite, and what makes a historical evaluation reproducible years later.
 *
 * AI does not decide what a practice accepts. It identifies evidence; this
 * applies the organization's own policy to that evidence.
 */
export const ENGINE_VERSION = 'triage-engine@1.0.0'

const ALL_DIMENSIONS: TriageDimension[] = [
  'DIAGNOSIS', 'PAYER', 'DOCUMENTATION', 'REFERRAL_SOURCE',
  'PATIENT_STATUS', 'ORG_EXCEPTION', 'PROVIDER_REVIEW',
]

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

interface ConditionContext {
  facts: TriageFacts
}

function candidateMatches(
  candidate: DiagnosisFact,
  condition: Extract<RuleCondition, { type: 'DIAGNOSIS_CATEGORY' }>,
): boolean {
  if (candidate.categoryKey !== condition.categoryKey) return false
  if (candidate.confidence < (condition.minConfidence ?? 0)) return false
  if (condition.allowedContexts?.length && !condition.allowedContexts.includes(candidate.strongestContext)) {
    return false
  }
  if (condition.allowedPolarities?.length) {
    if (!condition.allowedPolarities.includes(candidate.polarity)) return false
  } else if (candidate.polarity !== 'AFFIRMED') {
    // A hedged, ruled-out, historical or family-history mention does not
    // satisfy a rule unless the rule says so explicitly.
    return false
  }
  return true
}

export function evaluateCondition(condition: RuleCondition, ctx: ConditionContext): boolean {
  const { facts } = ctx
  switch (condition.type) {
    case 'ALWAYS':
      return true

    case 'DIAGNOSIS_CATEGORY': {
      const pool =
        (condition.position ?? 'ANY') === 'PRIMARY'
          ? facts.diagnosisCandidates.filter((c) => c.isPrimary)
          : facts.diagnosisCandidates
      return pool.some((c) => candidateMatches(c, condition))
    }

    case 'ICD10_EXACT': {
      const wanted = new Set(condition.codes.map(normalizeCode))
      return facts.diagnosisCandidates.some((c) =>
        c.codes.some((code) => wanted.has(normalizeCode(code))),
      )
    }

    case 'ICD10_FAMILY': {
      const prefixes = condition.prefixes.map(normalizeCode)
      return facts.diagnosisCandidates.some((c) =>
        c.codes.some((code) => prefixes.some((p) => normalizeCode(code).startsWith(p))),
      )
    }

    case 'ICD10_RANGE':
      return facts.diagnosisCandidates.some((c) =>
        c.codes.some((code) => isInRange(code, condition.from, condition.to)),
      )

    case 'TEXT_MATCH': {
      const haystack = condition.scope === 'PACKET'
        ? facts.referralReasonText
        : facts.referralReasonText
      return matchText(
        haystack,
        condition.terms.map((term) => ({ categoryKey: '', term, matchMode: 'PHRASE' as const })),
      ).length > 0
    }

    case 'PAYER_IN':
      return facts.payer.payerId != null && condition.payerIds.includes(facts.payer.payerId)

    case 'PAYER_CATEGORY':
      return facts.payer.category != null && condition.categories.includes(facts.payer.category)

    case 'REQUIREMENT_MISSING':
      // Only a confirmed absence satisfies this. "Not yet checked" is not a
      // missing document, and a rule that treated it as one would fire on
      // every referral before anyone had opened the fax.
      return condition.keys.some((key) =>
        facts.requirements.some((r) => r.key === key && r.status === 'ABSENT'),
      )

    case 'REFERRAL_SOURCE_IN':
      return (
        facts.referralSource.organizationId != null &&
        condition.referringOrganizationIds.includes(facts.referralSource.organizationId)
      )

    case 'PATIENT_STATUS':
      return condition.values.includes(facts.patientStatus)

    case 'ALL_OF':
      return condition.of.every((c) => evaluateCondition(c, ctx))
    case 'ANY_OF':
      return condition.of.some((c) => evaluateCondition(c, ctx))
    case 'NOT':
      return !evaluateCondition(condition.of, ctx)
  }
}

// ---------------------------------------------------------------------------
// Dimension evaluation
// ---------------------------------------------------------------------------

/** Worst-first, so a dimension's outcome is the most restrictive rule that fired. */
const SEVERITY: Record<TriageOutcome, number> = {
  RED: 6, INCOMPLETE: 5, REVIEW: 4, YELLOW: 3, UNKNOWN: 2, GREEN: 1, NO_EFFECT: 0,
}

/** Does this condition reference the given category anywhere in its tree? */
function conditionMentionsCategory(condition: RuleCondition, categoryKey: string): boolean {
  switch (condition.type) {
    case 'DIAGNOSIS_CATEGORY':
      return condition.categoryKey === categoryKey
    case 'ALL_OF':
    case 'ANY_OF':
      return condition.of.some((c) => conditionMentionsCategory(c, categoryKey))
    case 'NOT':
      return conditionMentionsCategory(condition.of, categoryKey)
    default:
      return false
  }
}

function sortRules(rules: readonly CompiledRule[]): CompiledRule[] {
  // Priority, then name: ties must resolve the same way on every run, or a
  // historical evaluation stops being reproducible.
  return [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

function evaluateDimension(
  dimension: TriageDimension,
  ruleSet: CompiledRuleSet,
  facts: TriageFacts,
): { result: DimensionResult; actions: RuleAction[]; competing: boolean } {
  const rules = sortRules(ruleSet.rules.filter((r) => r.dimension === dimension))
  const fired = rules.filter((r) => evaluateCondition(r.condition, { facts }))

  if (fired.length === 0) {
    return {
      result: {
        dimension,
        outcome: 'NO_EFFECT',
        summary: 'No rule applies.',
        matchedRuleIds: [],
        blocking: false,
        decisive: false,
        insufficientData: false,
      },
      actions: [],
      competing: false,
    }
  }

  const worst = fired.reduce((a, b) => (SEVERITY[b.outcome] > SEVERITY[a.outcome] ? b : a))
  // Two rules at the same priority disagreeing is a policy conflict, not a
  // result. It lowers confidence rather than being silently resolved.
  const competing = fired.some(
    (r) => r.priority === worst.priority && r.outcome !== worst.outcome,
  )

  return {
    result: {
      dimension,
      outcome: worst.outcome,
      summary: worst.rationale,
      matchedRuleIds: fired.map((r) => r.id),
      blocking: fired.some((r) => r.blocking),
      decisive: false,
      insufficientData: false,
    },
    actions: fired.flatMap((r) => r.actions),
    competing,
  }
}

/** Payer rules live in their own table; a specific payer beats a category rule. */
function evaluatePayer(ruleSet: CompiledRuleSet, facts: TriageFacts): DimensionResult {
  if (!facts.payer.payerId && !facts.payer.category) {
    return {
      dimension: 'PAYER',
      outcome: 'UNKNOWN',
      summary: 'No payer recorded on this referral.',
      matchedRuleIds: [],
      blocking: false,
      decisive: false,
      insufficientData: true,
    }
  }

  const specific = ruleSet.payerRules.find(
    (r) => r.payerId && r.payerId === facts.payer.payerId,
  )
  const byCategory = ruleSet.payerRules.find(
    (r) => !r.payerId && r.payerCategory && r.payerCategory === facts.payer.category,
  )
  const rule = specific ?? byCategory

  if (!rule) {
    return {
      dimension: 'PAYER',
      outcome: 'GREEN',
      summary: 'No payer restriction applies.',
      matchedRuleIds: [],
      blocking: false,
      decisive: false,
      insufficientData: false,
    }
  }

  return {
    dimension: 'PAYER',
    outcome: rule.outcome,
    summary: rule.rationale,
    matchedRuleIds: [rule.id],
    blocking: rule.outcome === 'RED',
    decisive: false,
    insufficientData: false,
  }
}

function evaluateDocumentation(ruleSet: CompiledRuleSet, facts: TriageFacts): DimensionResult {
  const primaryKey = facts.diagnosisCandidates.find((c) => c.isPrimary)?.categoryKey ?? null

  const applicable = ruleSet.requirements.filter(
    (r) => !r.appliesToCategoryKey || r.appliesToCategoryKey === primaryKey,
  )
  const required = applicable.filter((r) => r.level === 'REQUIRED')

  if (required.length === 0) {
    return {
      dimension: 'DOCUMENTATION',
      outcome: 'GREEN',
      summary: 'No required documents are configured for this referral.',
      matchedRuleIds: [],
      blocking: false,
      decisive: false,
      insufficientData: false,
    }
  }

  const statusOf = (key: string) =>
    facts.requirements.find((f) => f.key === key)?.status ?? 'UNCHECKED'

  const absent = required.filter((r) => statusOf(r.key) === 'ABSENT')
  const unchecked = required.filter((r) => statusOf(r.key) === 'UNCHECKED')

  if (absent.length > 0) {
    return {
      dimension: 'DOCUMENTATION',
      outcome: 'INCOMPLETE',
      // Naming the items is the point: this sentence becomes the records request.
      summary: `Missing: ${absent.map((m) => m.label).join(', ')}.`,
      matchedRuleIds: [],
      blocking: true,
      decisive: false,
      insufficientData: facts.packetCoverage < 90,
    }
  }

  if (unchecked.length > 0) {
    /**
     * Not established as missing — nobody has looked yet. Reporting this as
     * INCOMPLETE would assert an absence no one has checked, and would send a
     * records request for documents that are very likely already in the fax.
     * It does not block; it changes the next action to "check".
     */
    return {
      dimension: 'DOCUMENTATION',
      outcome: 'UNKNOWN',
      summary: `Not yet checked: ${unchecked.map((m) => m.label).join(', ')}.`,
      matchedRuleIds: [],
      blocking: false,
      decisive: false,
      insufficientData: true,
    }
  }

  return {
    dimension: 'DOCUMENTATION',
    outcome: 'GREEN',
    summary: `All ${required.length} required items are present.`,
    matchedRuleIds: [],
    blocking: false,
    decisive: false,
    insufficientData: false,
  }
}

/**
 * The diagnosis dimension, and the place the primary-diagnosis rule lives.
 *
 * Only the PRIMARY candidate can produce RED. A category that appears further
 * down the packet is reported but never blocks — see docs/ARCHITECTURE.md §5.5.
 */
function evaluateDiagnosis(
  ruleSet: CompiledRuleSet,
  facts: TriageFacts,
): { result: DimensionResult; actions: RuleAction[]; noted: TriageEvaluationResult['noted']; competing: boolean } {
  const noted: TriageEvaluationResult['noted'] = []

  if (facts.diagnosisCandidates.length === 0 || facts.primaryDeterminacy === 'NONE') {
    return {
      result: {
        dimension: 'DIAGNOSIS',
        outcome: 'UNKNOWN',
        summary: 'No diagnosis could be identified from the referral.',
        matchedRuleIds: [],
        blocking: false,
        decisive: false,
        insufficientData: true,
      },
      actions: [],
      noted,
      competing: false,
    }
  }

  const rules = sortRules(ruleSet.rules.filter((r) => r.dimension === 'DIAGNOSIS'))
  const primary = facts.diagnosisCandidates.find((c) => c.isPrimary) ?? null

  // Categories present but not primary. Surfaced, never acted on — staff can
  // see them and override the ranking if they disagree.
  //
  // Note this deliberately ignores the context and polarity filters the RED
  // rules carry. Those filters decide whether a category may BLOCK; whether it
  // is worth telling a coordinator about is a different question, and a
  // fibromyalgia line in a problem list is worth telling them about.
  for (const candidate of facts.diagnosisCandidates.filter((c) => !c.isPrimary)) {
    const rule = rules.find(
      (r) =>
        (r.outcome === 'RED' || r.outcome === 'YELLOW') &&
        conditionMentionsCategory(r.condition, candidate.categoryKey),
    )
    if (rule) {
      noted.push({
        categoryKey: candidate.categoryKey,
        outcome: rule.outcome,
        note:
          `Also documented (${candidate.strongestContext.replaceAll('_', ' ').toLowerCase()}) — ` +
          'not the primary diagnosis, not blocking.',
      })
    }
  }

  // Contested primary: the system refuses to pick. False confidence is worse
  // than uncertainty (brief §53).
  if (facts.primaryDeterminacy === 'CONTESTED') {
    const [first, second] = facts.diagnosisCandidates
    return {
      result: {
        dimension: 'DIAGNOSIS',
        outcome: 'REVIEW',
        summary:
          `Two candidates are too close to separate: ${first?.categoryKey} and ${second?.categoryKey}. ` +
          'Physician review required.',
        matchedRuleIds: [],
        blocking: false,
        decisive: false,
        insufficientData: false,
      },
      actions: [{ type: 'FLAG_PHYSICIAN_REVIEW' }],
      noted,
      competing: false,
    }
  }

  if (!primary) {
    return {
      result: {
        dimension: 'DIAGNOSIS',
        outcome: ruleSet.unknownBehavior === 'YELLOW' ? 'YELLOW' : 'UNKNOWN',
        summary: 'No primary diagnosis could be established.',
        matchedRuleIds: [],
        blocking: false,
        decisive: false,
        insufficientData: true,
      },
      actions: [],
      noted,
      competing: false,
    }
  }

  if (primary.confidence < ruleSet.diagnosisConfidenceFloor) {
    return {
      result: {
        dimension: 'DIAGNOSIS',
        outcome: ruleSet.unknownBehavior === 'YELLOW' ? 'YELLOW' : 'UNKNOWN',
        summary:
          `${primary.categoryKey} is the likely diagnosis, but confidence ` +
          `(${primary.confidence}) is below the organization's floor of ${ruleSet.diagnosisConfidenceFloor}.`,
        matchedRuleIds: [],
        blocking: false,
        decisive: false,
        insufficientData: true,
      },
      actions: [],
      noted,
      competing: false,
    }
  }

  const fired = rules.filter((r) => evaluateCondition(r.condition, { facts }))
  if (fired.length === 0) {
    return {
      result: {
        dimension: 'DIAGNOSIS',
        outcome: ruleSet.unknownBehavior === 'YELLOW' ? 'YELLOW' : 'UNKNOWN',
        summary: `No triage rule covers ${primary.categoryKey}.`,
        matchedRuleIds: [],
        blocking: false,
        decisive: false,
        insufficientData: false,
      },
      actions: [],
      noted,
      competing: false,
    }
  }

  const worst = fired.reduce((a, b) => (SEVERITY[b.outcome] > SEVERITY[a.outcome] ? b : a))
  const competing = fired.some((r) => r.priority === worst.priority && r.outcome !== worst.outcome)

  return {
    result: {
      dimension: 'DIAGNOSIS',
      outcome: worst.outcome,
      summary: worst.rationale,
      matchedRuleIds: fired.map((r) => r.id),
      blocking: fired.some((r) => r.blocking),
      decisive: false,
      insufficientData: false,
    },
    actions: fired.flatMap((r) => r.actions),
    noted,
    competing,
  }
}

// ---------------------------------------------------------------------------
// Disposition confidence (docs/ARCHITECTURE.md §7.2)
// ---------------------------------------------------------------------------

const RULE_STRENGTH_BASE: Record<string, number> = {
  EXACT_CODE: 95,
  CODE_FAMILY: 88,
  CODE_RANGE: 86,
  DIAGNOSIS_CATEGORY: 82,
  TEXT_SYNONYM: 70,
  NONE: 60,
}

function dispositionConfidence(params: {
  decisive: TriageDimension | null
  dimensions: DimensionResult[]
  facts: TriageFacts
  competing: boolean
}): number {
  const { decisive, dimensions, facts, competing } = params

  // Payer, documentation and source dimensions rest on recorded facts, not on
  // an inference about what the patient has.
  let base: number
  if (decisive === 'DIAGNOSIS') {
    const primary = facts.diagnosisCandidates.find((c) => c.isPrimary)
    base = RULE_STRENGTH_BASE[primary?.matchType ?? 'NONE'] ?? 60
  } else if (decisive === null) {
    base = 60
  } else {
    base = 95
  }

  /**
   * Penalise only the insufficiency the decision actually rests on.
   *
   * An earlier version subtracted for every thin dimension, which quietly
   * undermined the whole point of separating the scores: a payer exclusion was
   * losing confidence because the DIAGNOSIS was unclear, when an excluded payer
   * is excluded whatever the patient turns out to have.
   */
  const byDim = new Map(dimensions.map((d) => [d.dimension, d]))
  if (decisive && byDim.get(decisive)?.insufficientData) base -= 8
  if (decisive === 'DOCUMENTATION') {
    // Which documents are required depends on the primary category, so an
    // unclear diagnosis genuinely does weaken a documentation-based routing.
    if (byDim.get('DIAGNOSIS')?.insufficientData) base -= 8
    if (facts.packetCoverage < 90) base -= 8
  }
  if (competing) base -= 20

  /**
   * The dependency ceiling. A routing that rests on the diagnosis cannot be
   * more certain than the diagnosis is. A routing that rests on the payer can:
   * an excluded payer is excluded whatever the patient turns out to have.
   */
  if (decisive === 'DIAGNOSIS') {
    const primary = facts.diagnosisCandidates.find((c) => c.isPrimary)
    if (primary) base = Math.min(base, primary.confidence + 3)
  }

  return Math.max(0, Math.min(99, Math.round(base)))
}

// ---------------------------------------------------------------------------
// Combination
// ---------------------------------------------------------------------------

function nextActionFor(outcome: TriageOutcome, documentation: DimensionResult): string {
  switch (outcome) {
    case 'GREEN':
      // A green diagnosis on an unverified packet is not yet ready to call.
      return documentation.outcome === 'UNKNOWN'
        ? 'Confirm the required documents, then contact patient'
        : 'Contact patient'
    case 'YELLOW': return 'Submit to physician for review'
    case 'RED': return 'Do not schedule — confirm with staff before any contact'
    case 'INCOMPLETE': return `Request records — ${documentation.summary}`
    case 'UNKNOWN': return 'Review referral manually'
    default: return 'Review referral manually'
  }
}

export function evaluateTriage(
  facts: TriageFacts,
  ruleSet: CompiledRuleSet,
): TriageEvaluationResult {
  const diagnosis = evaluateDiagnosis(ruleSet, facts)
  const payer = evaluatePayer(ruleSet, facts)
  const documentation = evaluateDocumentation(ruleSet, facts)

  const others = (['REFERRAL_SOURCE', 'PATIENT_STATUS', 'ORG_EXCEPTION', 'PROVIDER_REVIEW'] as const)
    .map((d) => evaluateDimension(d, ruleSet, facts))

  const dimensions: DimensionResult[] = [
    diagnosis.result,
    payer,
    documentation,
    ...others.map((o) => o.result),
  ]
  const actions: RuleAction[] = [...diagnosis.actions, ...others.flatMap((o) => o.actions)]
  const competing = diagnosis.competing || others.some((o) => o.competing)

  const byDimension = new Map(dimensions.map((d) => [d.dimension, d]))
  const blocking = dimensions.find((d) => d.blocking && d.outcome === 'RED')

  let finalDisposition: TriageOutcome = 'UNKNOWN'
  let decisive: TriageDimension | null = null
  let decisiveReason = ''

  for (const step of ruleSet.precedence) {
    if (step === 'BLOCKING' && blocking && blocking.dimension !== 'PAYER') {
      finalDisposition = 'RED'; decisive = blocking.dimension; decisiveReason = blocking.summary; break
    }
    if (step === 'PAYER_RED' && payer.outcome === 'RED') {
      finalDisposition = 'RED'; decisive = 'PAYER'; decisiveReason = payer.summary; break
    }
    if (step === 'DIAGNOSIS_RED' && diagnosis.result.outcome === 'RED') {
      finalDisposition = 'RED'; decisive = 'DIAGNOSIS'; decisiveReason = diagnosis.result.summary; break
    }
    if (step === 'DOCUMENTATION_INCOMPLETE' && documentation.outcome === 'INCOMPLETE') {
      finalDisposition = 'INCOMPLETE'; decisive = 'DOCUMENTATION'; decisiveReason = documentation.summary; break
    }
    if (step === 'PROVIDER_REVIEW') {
      const review = dimensions.find((d) => d.outcome === 'REVIEW')
      if (review) {
        finalDisposition = 'YELLOW'; decisive = review.dimension; decisiveReason = review.summary; break
      }
    }
    if (step === 'DIAGNOSIS_YELLOW' && diagnosis.result.outcome === 'YELLOW') {
      finalDisposition = 'YELLOW'; decisive = 'DIAGNOSIS'; decisiveReason = diagnosis.result.summary; break
    }
    if (step === 'DIAGNOSIS_UNKNOWN' && diagnosis.result.outcome === 'UNKNOWN') {
      finalDisposition = ruleSet.unknownBehavior === 'YELLOW' ? 'YELLOW' : 'UNKNOWN'
      decisive = 'DIAGNOSIS'; decisiveReason = diagnosis.result.summary; break
    }
    if (step === 'ALL_GREEN') {
      const anyYellow = dimensions.find((d) => d.outcome === 'YELLOW')
      if (anyYellow) {
        finalDisposition = 'YELLOW'; decisive = anyYellow.dimension; decisiveReason = anyYellow.summary; break
      }
      if (diagnosis.result.outcome === 'GREEN') {
        finalDisposition = 'GREEN'; decisive = 'DIAGNOSIS'; decisiveReason = diagnosis.result.summary; break
      }
      finalDisposition = ruleSet.unknownBehavior === 'YELLOW' ? 'YELLOW' : 'UNKNOWN'
      decisive = 'DIAGNOSIS'; decisiveReason = diagnosis.result.summary
      break
    }
  }

  const decided = decisive ? byDimension.get(decisive) : undefined
  if (decided) decided.decisive = true

  return {
    finalDisposition,
    dispositionConfidence: dispositionConfidence({ decisive, dimensions, facts, competing }),
    nextAction: nextActionFor(finalDisposition, documentation),
    decisiveDimension: decisive,
    decisiveReason,
    dimensions: dimensions.filter(
      (d) => d.outcome !== 'NO_EFFECT' || ALL_DIMENSIONS.indexOf(d.dimension) < 3,
    ),
    actions,
    primaryCandidate: facts.diagnosisCandidates.find((c) => c.isPrimary) ?? null,
    noted: diagnosis.noted,
    engineVersion: ENGINE_VERSION,
  }
}

export { matchCode, matchText, MATCH_STRENGTH }
