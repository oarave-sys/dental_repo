import type { DisplayFact } from './facts'
import type { HighlightSegment } from './evidence'
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

/**
 * A candidate still in play, alongside the values that separate it from its
 * rivals.
 *
 * Shown as a comparison rather than only as a question, so a coder who already
 * knows the answer can see it directly instead of being interrogated. The
 * question stays too — someone who does not know what distinguishes the codes
 * needs to be told exactly what to supply.
 */
export interface CandidateComparison {
  code: string
  shortLabel: string
  /** Values of the discriminating attributes, keyed by fact key. */
  distinguishingValues: Record<string, string>
  /** Whether this candidate currently scores highest. */
  leading: boolean
}

export interface CandidateChoice {
  intentId: string
  /** Fact keys, in display order, that separate the candidates. */
  distinguishingFactKeys: string[]
  candidates: CandidateComparison[]
  /** e.g. "Specificity depends on the surfaces restored. 4 candidates shown." */
  specificityNote: string
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
  /** Populated when several codes remain possible. */
  choice: CandidateChoice | null
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

  /**
   * The user's own text, split into runs and attributed to the facts each one
   * produced. Lets the UI show exactly which words drove the recommendation,
   * so nothing here has to be taken on trust.
   *
   * Empty when the practice has input retention turned off, since there is
   * then no text to show back.
   */
  evidence: {
    source: string
    segments: HighlightSegment[]
  }
}

export const DISCLAIMER =
  'Based on the information provided. Code selection, documentation and billing decisions remain the responsibility of the dental practice. This tool does not determine or guarantee payer reimbursement.'
