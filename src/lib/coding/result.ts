import type { DisplayFact } from './facts'
import type { ProcedureCategory } from './vocabulary'

/**
 * The structured output the application renders.
 *
 * Every code that appears anywhere in this object has been retrieved from the
 * reference database and re-validated against it before the object is built.
 * There is no path by which a code reaches this shape without existing.
 */

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface RecommendedCode {
  code: string
  shortLabel: string
  plainLanguage: string
  /** Null unless a licensed dataset is loaded. */
  officialDescriptor: string | null
  category: ProcedureCategory
  confidence: Confidence
  /** Why this code fits, in terms of the facts supplied. */
  why: string
  /** The specific facts that selected it, for the "Why" panel. */
  matchedOn: string[]
  /** Which of the user's procedures this code answers. */
  intentId: string
}

export interface AlternativeCode {
  code: string
  shortLabel: string
  /** What would have to be true for this one to apply instead. */
  distinction: string
  intentId: string
}

export interface FollowUpQuestion {
  /** "<intentId>:<factKey>" — the answer is routed back by this key. */
  key: string
  factKey: string
  intentId: string
  question: string
  /** Offered answers where the set is closed, e.g. hard vs soft appliance. */
  options: string[]
  /** Codes that remain in play until this is answered. */
  blockingCodes: string[]
}

export interface DocumentationItem {
  label: string
  factKey: string
  status: 'PRESENT' | 'MISSING' | 'UNCLEAR'
  kind: 'CODING_REQUIRED' | 'CLAIM_SUPPORT'
  /** For PRESENT: what was found. For MISSING: what is absent, never a suggestion to add it. */
  detail: string
  intentId: string
}

export interface DocumentationScore {
  /** 0-100, computed from rule weights. Never an opinion. */
  percentage: number
  earnedWeight: number
  totalWeight: number
  present: DocumentationItem[]
  needsReview: DocumentationItem[]
  /** Supporting material, reported separately from coding requirements. */
  claimSupport: DocumentationItem[]
}

export interface CodingWarning {
  severity: 'INFO' | 'REVIEW' | 'CONFLICT'
  message: string
  intentId: string | null
}

export interface ProcedureResult {
  intentId: string
  procedureSummary: string
  category: ProcedureCategory | null
  recommended: RecommendedCode[]
  alternatives: AlternativeCode[]
  factsUsed: DisplayFact[]
  confidence: Confidence
  /** True when the engine is holding back pending an answer. */
  awaitingAnswer: boolean
}

export interface CodingResult {
  /** One entry per procedure detected in the input. */
  procedures: ProcedureResult[]
  /** Flattened, in input order, for the summary strip. */
  recommendedCodes: RecommendedCode[]
  alternativeCodes: AlternativeCode[]
  confidence: Confidence
  procedureSummary: string
  factsUsed: DisplayFact[]
  missingInformation: string[]
  followUpQuestions: FollowUpQuestion[]
  documentation: DocumentationScore
  warnings: CodingWarning[]
  /** A concise user-facing explanation. Never internal deliberation. */
  reasoningSummary: string
  /** Set when the engine needs an answer before it will recommend. */
  status: 'COMPLETE' | 'NEEDS_INPUT'
  /** Provenance of the codes shown. */
  dataset: { key: string; kind: 'DEMO' | 'LICENSED'; name: string }
  /** True when the language model contributed to extraction. */
  aiAssisted: boolean
}

export const DISCLAIMER =
  'Based on the information provided. Code selection, documentation and billing decisions remain the responsibility of the dental practice. This tool does not determine or guarantee payer reimbursement.'
