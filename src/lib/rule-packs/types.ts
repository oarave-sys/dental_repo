import type { RuleCondition, RequirementLevel, TriageOutcome, TriageDimension, RuleAction } from '@/lib/rules/types'

/**
 * A specialty rule pack: the whole of an organization's starting policy as
 * data. Installing one is a database write, not a code change — which is what
 * lets the platform serve cardiology or GI without touching the engine.
 */
export interface RulePackCategory {
  key: string
  name: string
  description?: string
  sortOrder: number
  codeMaps: Array<{
    matchType: 'EXACT_CODE' | 'CODE_FAMILY' | 'CODE_RANGE'
    value: string
    valueTo?: string
    weight?: number
    /** Shown when specificity depends on information a referral may not carry. */
    specificityNote?: string
  }>
  synonyms: Array<{
    term: string
    matchMode?: 'PHRASE' | 'ABBREVIATION' | 'TOKEN'
    weight?: number
  }>
}

export interface RulePackRule {
  dimension: TriageDimension
  name: string
  priority: number
  condition: RuleCondition
  outcome: TriageOutcome
  blocking?: boolean
  rationale: string
  actions?: RuleAction[]
}

export interface RulePackRequirement {
  key: string
  label: string
  level: RequirementLevel
  appliesToCategoryKey?: string
  sortOrder: number
  /** Terms Phase 4's packet search will look for. Inert until then. */
  detector?: { terms: string[] }
}

export interface RulePackPayerRule {
  payerCategory?: string
  payerName?: string
  outcome: TriageOutcome
  rationale: string
}

export interface RulePack {
  key: string
  name: string
  specialty: string
  version: string
  notes: string
  categories: RulePackCategory[]
  rules: RulePackRule[]
  requirements: RulePackRequirement[]
  payerRules: RulePackPayerRule[]
  settings: {
    unknownBehavior: 'YELLOW' | 'UNKNOWN'
    diagnosisConfidenceFloor: number
    contestedMargin: number
  }
}
