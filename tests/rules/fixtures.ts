import { rheumatologyRulePack } from '@/lib/rule-packs/rheumatology'
import { DEFAULT_PRECEDENCE, type CompiledRuleSet, type DiagnosisFact, type TriageFacts, type RuleCondition } from '@/lib/rules/types'

/**
 * Compiles the shipped rheumatology rule pack into the engine's shape, so the
 * matrix below tests the rules the practice will actually run — not a
 * simplified stand-in that could pass while the real pack is broken.
 */
export function compiledRheumatologyRuleSet(
  overrides: Partial<CompiledRuleSet> = {},
): CompiledRuleSet {
  return {
    versionId: 'ruleset-1',
    version: 1,
    rules: rheumatologyRulePack.rules.map((r, i) => ({
      id: `rule-${i}`,
      dimension: r.dimension,
      name: r.name,
      priority: r.priority,
      condition: r.condition as RuleCondition,
      outcome: r.outcome,
      blocking: r.blocking ?? false,
      rationale: r.rationale,
      actions: r.actions ?? [],
    })),
    payerRules: rheumatologyRulePack.payerRules.map((p, i) => ({
      id: `payer-rule-${i}`,
      payerId: null,
      payerCategory: p.payerCategory ?? null,
      outcome: p.outcome,
      rationale: p.rationale,
    })),
    requirements: rheumatologyRulePack.requirements.map((r) => ({
      key: r.key,
      label: r.label,
      level: r.level,
      appliesToCategoryKey: r.appliesToCategoryKey ?? null,
    })),
    precedence: DEFAULT_PRECEDENCE,
    unknownBehavior: rheumatologyRulePack.settings.unknownBehavior,
    diagnosisConfidenceFloor: rheumatologyRulePack.settings.diagnosisConfidenceFloor,
    contestedMargin: rheumatologyRulePack.settings.contestedMargin,
    ...overrides,
  }
}

export function candidate(over: Partial<DiagnosisFact> & { categoryKey: string }): DiagnosisFact {
  return {
    rank: 1,
    isPrimary: true,
    confidence: 90,
    matchType: 'EXACT_CODE',
    strongestContext: 'ENCOUNTER_DIAGNOSIS',
    polarity: 'AFFIRMED',
    codes: [],
    ...over,
  }
}

/** All required documents present, so documentation never masks another case. */
export function completeDocuments(): TriageFacts['requirements'] {
  return rheumatologyRulePack.requirements.map((r) => ({
    key: r.key, label: r.label, level: r.level, status: 'PRESENT' as const,
  }))
}

/** Confirmed absent by a coordinator, which is different from unchecked. */
export function documentsMissing(...keys: string[]): TriageFacts['requirements'] {
  return rheumatologyRulePack.requirements.map((r) => ({
    key: r.key, label: r.label, level: r.level,
    status: keys.includes(r.key) ? ('ABSENT' as const) : ('PRESENT' as const),
  }))
}

/** Nobody has looked at the packet yet. */
export function documentsUnchecked(): TriageFacts['requirements'] {
  return rheumatologyRulePack.requirements.map((r) => ({
    key: r.key, label: r.label, level: r.level, status: 'UNCHECKED' as const,
  }))
}

export function facts(over: Partial<TriageFacts> = {}): TriageFacts {
  return {
    diagnosisCandidates: [],
    primaryDeterminacy: 'CLEAR',
    referralReasonText: '',
    payer: { payerId: 'payer-1', category: 'COMMERCIAL', rawName: 'Commercial PPO' },
    requirements: completeDocuments(),
    referralSource: { organizationId: 'office-1', providerId: 'provider-1', tags: [] },
    patientStatus: 'NEW',
    packetCoverage: 100,
    ...over,
  }
}
