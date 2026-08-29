import { z } from 'zod'
import type { CodeMatchType } from '@/lib/icd10'

/**
 * Rule conditions. Stored as JSON, validated by this discriminated union on
 * save, so a malformed rule cannot reach the engine.
 */
export const ruleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('DIAGNOSIS_CATEGORY'),
      categoryKey: z.string().min(1),
      minConfidence: z.number().int().min(0).max(100).default(0),
      /**
       * PRIMARY is what makes a RED rule safe. A packet for a rheumatoid
       * arthritis patient will often mention fibromyalgia somewhere; only the
       * primary diagnosis may block a referral. See docs/ARCHITECTURE.md §5.5.
       */
      position: z.enum(['PRIMARY', 'ANY']).default('ANY'),
      allowedContexts: z.array(z.string()).optional(),
      allowedPolarities: z.array(z.string()).optional(),
    }),
    z.object({ type: z.literal('ICD10_EXACT'), codes: z.array(z.string()).min(1) }),
    z.object({ type: z.literal('ICD10_FAMILY'), prefixes: z.array(z.string()).min(1) }),
    z.object({ type: z.literal('ICD10_RANGE'), from: z.string(), to: z.string() }),
    z.object({
      type: z.literal('TEXT_MATCH'),
      terms: z.array(z.string()).min(1),
      scope: z.enum(['REFERRAL_REASON', 'PACKET']).default('REFERRAL_REASON'),
    }),
    z.object({ type: z.literal('PAYER_IN'), payerIds: z.array(z.string()).min(1) }),
    z.object({ type: z.literal('PAYER_CATEGORY'), categories: z.array(z.string()).min(1) }),
    z.object({ type: z.literal('REQUIREMENT_MISSING'), keys: z.array(z.string()).min(1) }),
    z.object({
      type: z.literal('REFERRAL_SOURCE_IN'),
      referringOrganizationIds: z.array(z.string()).min(1),
    }),
    z.object({
      type: z.literal('PATIENT_STATUS'),
      values: z.array(z.enum(['NEW', 'CURRENT_PATIENT', 'FORMER_PATIENT', 'UNKNOWN'])).min(1),
    }),
    z.object({ type: z.literal('ALWAYS') }),
    z.object({ type: z.literal('ALL_OF'), of: z.array(ruleConditionSchema).min(1) }),
    z.object({ type: z.literal('ANY_OF'), of: z.array(ruleConditionSchema).min(1) }),
    z.object({ type: z.literal('NOT'), of: ruleConditionSchema }),
  ]),
)

export type RuleCondition =
  | {
      type: 'DIAGNOSIS_CATEGORY'
      categoryKey: string
      minConfidence?: number
      position?: 'PRIMARY' | 'ANY'
      allowedContexts?: string[]
      allowedPolarities?: string[]
    }
  | { type: 'ICD10_EXACT'; codes: string[] }
  | { type: 'ICD10_FAMILY'; prefixes: string[] }
  | { type: 'ICD10_RANGE'; from: string; to: string }
  | { type: 'TEXT_MATCH'; terms: string[]; scope?: 'REFERRAL_REASON' | 'PACKET' }
  | { type: 'PAYER_IN'; payerIds: string[] }
  | { type: 'PAYER_CATEGORY'; categories: string[] }
  | { type: 'REQUIREMENT_MISSING'; keys: string[] }
  | { type: 'REFERRAL_SOURCE_IN'; referringOrganizationIds: string[] }
  | { type: 'PATIENT_STATUS'; values: PatientStatus[] }
  | { type: 'ALWAYS' }
  | { type: 'ALL_OF'; of: RuleCondition[] }
  | { type: 'ANY_OF'; of: RuleCondition[] }
  | { type: 'NOT'; of: RuleCondition }

export type PatientStatus = 'NEW' | 'CURRENT_PATIENT' | 'FORMER_PATIENT' | 'UNKNOWN'

export type TriageDimension =
  | 'DIAGNOSIS'
  | 'PAYER'
  | 'DOCUMENTATION'
  | 'REFERRAL_SOURCE'
  | 'PATIENT_STATUS'
  | 'ORG_EXCEPTION'
  | 'PROVIDER_REVIEW'

export type TriageOutcome =
  | 'GREEN' | 'YELLOW' | 'RED' | 'INCOMPLETE' | 'UNKNOWN' | 'REVIEW' | 'NO_EFFECT'

export type RequirementLevel = 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL'

export type EvidenceContext =
  | 'REFERRAL_REASON' | 'ASSESSMENT_PLAN' | 'ENCOUNTER_DIAGNOSIS' | 'PROBLEM_LIST'
  | 'HPI' | 'PAST_HISTORY' | 'FAMILY_HISTORY' | 'BILLING' | 'UNKNOWN'

export type EvidencePolarity =
  | 'AFFIRMED' | 'HEDGED' | 'RULED_OUT' | 'HISTORICAL' | 'FAMILY' | 'CONTRADICTS'

export interface RuleAction {
  type:
    | 'REQUIRE_DOCUMENT' | 'SET_PRIORITY' | 'ADD_TAG'
    | 'ROUTE_TO_ROLE' | 'REQUEST_INFO_TEMPLATE' | 'FLAG_PHYSICIAN_REVIEW'
  params?: Record<string, unknown>
}

export interface CompiledRule {
  id: string
  dimension: TriageDimension
  name: string
  priority: number
  condition: RuleCondition
  outcome: TriageOutcome
  blocking: boolean
  rationale: string
  actions: RuleAction[]
}

export interface CompiledPayerRule {
  id: string
  payerId?: string | null
  payerCategory?: string | null
  outcome: TriageOutcome
  rationale: string
}

export interface CompiledRequirement {
  key: string
  label: string
  level: RequirementLevel
  appliesToCategoryKey?: string | null
}

/** Which dimension outranks which. Organization-editable, with a stated default. */
export type PrecedenceStep =
  | 'BLOCKING'
  | 'PAYER_RED'
  | 'DIAGNOSIS_RED'
  | 'DOCUMENTATION_INCOMPLETE'
  | 'PROVIDER_REVIEW'
  | 'DIAGNOSIS_YELLOW'
  | 'DIAGNOSIS_UNKNOWN'
  | 'ALL_GREEN'

export const DEFAULT_PRECEDENCE: readonly PrecedenceStep[] = [
  'BLOCKING',
  // Payer outranks documentation on purpose: chasing a DXA report for a
  // patient the practice cannot accept is wasted staff time.
  'PAYER_RED',
  'DIAGNOSIS_RED',
  'DOCUMENTATION_INCOMPLETE',
  'PROVIDER_REVIEW',
  'DIAGNOSIS_YELLOW',
  'DIAGNOSIS_UNKNOWN',
  'ALL_GREEN',
]

export interface CompiledRuleSet {
  versionId: string
  version: number
  rules: CompiledRule[]
  payerRules: CompiledPayerRule[]
  requirements: CompiledRequirement[]
  precedence: readonly PrecedenceStep[]
  /** What an unidentifiable diagnosis produces. */
  unknownBehavior: 'YELLOW' | 'UNKNOWN'
  /** Below this, a diagnosis is not confident enough to act on. */
  diagnosisConfidenceFloor: number
  /**
   * When the top two candidates sit within this many points AND disagree on
   * outcome, the system refuses to pick and routes to physician review.
   */
  contestedMargin: number
}

export interface DiagnosisFact {
  categoryKey: string
  rank: number
  isPrimary: boolean
  confidence: number
  matchType: CodeMatchType
  strongestContext: EvidenceContext
  polarity: EvidencePolarity
  codes: string[]
  possibleCodes?: Array<{ code: string; description: string; note?: string }>
}

export type RequirementStatus = 'PRESENT' | 'ABSENT' | 'UNCHECKED'

export interface RequirementFact {
  key: string
  label: string
  level: RequirementLevel
  status: RequirementStatus
  detectionConfidence?: number | null
  /** How much of the packet was searched. Reported instead of a probability
   *  of absence, which is not calibratable yet — docs/OPEN-QUESTIONS.md A-2. */
  searchCoverage?: number | null
}

export interface TriageFacts {
  /** Ranked, never a flat set. Rank 1 is the primary diagnosis. */
  diagnosisCandidates: DiagnosisFact[]
  primaryDeterminacy: 'CLEAR' | 'CONTESTED' | 'NONE'
  referralReasonText: string
  payer: { payerId?: string | null; category?: string | null; rawName?: string | null }
  requirements: RequirementFact[]
  referralSource: { organizationId?: string | null; providerId?: string | null; tags: string[] }
  patientStatus: PatientStatus
  /** 0-100. How much of the packet was actually readable. */
  packetCoverage: number
}

export interface DimensionResult {
  dimension: TriageDimension
  outcome: TriageOutcome
  summary: string
  matchedRuleIds: string[]
  blocking: boolean
  decisive: boolean
  /** Present when the dimension had too little to go on. */
  insufficientData: boolean
}

export interface TriageEvaluationResult {
  finalDisposition: TriageOutcome
  dispositionConfidence: number
  nextAction: string
  decisiveDimension: TriageDimension | null
  decisiveReason: string
  dimensions: DimensionResult[]
  actions: RuleAction[]
  primaryCandidate: DiagnosisFact | null
  /** Non-primary categories worth showing but not acting on. */
  noted: Array<{ categoryKey: string; outcome: TriageOutcome; note: string }>
  engineVersion: string
}
