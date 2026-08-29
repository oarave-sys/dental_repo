import { describe, expect, it } from 'vitest'
import { evaluateTriage } from '@/lib/rules/engine'
import { candidate, compiledRheumatologyRuleSet, documentsMissing, facts } from './fixtures'

/**
 * The §58 test matrix, run against the shipped rheumatology rule pack.
 *
 * Every case here is a fixture in and an object out — no database. That is the
 * dividend of keeping the engine pure, and it is why these run in milliseconds
 * and can be reasoned about by someone who does not know the codebase.
 */
const ruleSet = compiledRheumatologyRuleSet()

describe('green diagnosis', () => {
  it('with complete documents is GREEN and says to contact the patient', () => {
    const result = evaluateTriage(
      facts({ diagnosisCandidates: [candidate({ categoryKey: 'RHEUMATOID_ARTHRITIS', codes: ['M0579'] })] }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('GREEN')
    expect(result.nextAction).toMatch(/contact patient/i)
    expect(result.decisiveDimension).toBe('DIAGNOSIS')
    expect(result.dispositionConfidence).toBeGreaterThanOrEqual(85)
  })

  it('with a missing required document is INCOMPLETE, naming the document', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'OSTEOPOROSIS', codes: ['M810'] })],
        requirements: documentsMissing('DXA_REPORT'),
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('INCOMPLETE')
    expect(result.nextAction).toMatch(/DXA report/i)
    // The diagnosis dimension is still reported as green — nothing is hidden.
    expect(result.dimensions.find((d) => d.dimension === 'DIAGNOSIS')?.outcome).toBe('GREEN')
    expect(result.dimensions.find((d) => d.dimension === 'DOCUMENTATION')?.outcome).toBe('INCOMPLETE')
  })

  it('with an excluded payer is RED, and the payer outranks the missing document', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'OSTEOPOROSIS', codes: ['M810'] })],
        requirements: documentsMissing('DXA_REPORT'),
        payer: { payerId: 'p', category: 'MEDICAID_MANAGED', rawName: 'A Medicaid plan' },
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('RED')
    expect(result.decisiveDimension).toBe('PAYER')
    // Chasing a DXA for a patient the practice cannot accept is wasted work.
    expect(result.decisiveReason).toMatch(/not contracted/i)
  })

  it('does not require a DXA for a diagnosis other than osteoporosis', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'GOUT', codes: ['M109'] })],
        requirements: documentsMissing('DXA_REPORT'),
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('GREEN')
  })
})

describe('the Medicaid exclusion', () => {
  it('applies to straight Medicaid', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'GOUT', codes: ['M109'] })],
        payer: { payerId: 'p', category: 'MEDICAID', rawName: 'Medicaid' },
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('RED')
  })

  it('applies to a managed Medicaid plan the practice has never entered', () => {
    // The rule is written by category, so a plan added next year inherits it
    // instead of quietly defaulting to accepted.
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'GOUT', codes: ['M109'] })],
        payer: { payerId: 'brand-new-plan', category: 'MEDICAID_MANAGED', rawName: 'Anything' },
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('RED')
  })

  it('is confident even when the diagnosis is not', () => {
    // A payer exclusion does not depend on what the patient turns out to have,
    // so it carries no dependency ceiling.
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'GOUT', confidence: 31, matchType: 'TEXT_SYNONYM' })],
        payer: { payerId: 'p', category: 'MEDICAID', rawName: 'Medicaid' },
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('RED')
    expect(result.dispositionConfidence).toBeGreaterThanOrEqual(90)
  })

  it('leaves commercial and Medicare untouched', () => {
    for (const category of ['COMMERCIAL', 'MEDICARE', 'HMO', 'EXCHANGE']) {
      const result = evaluateTriage(
        facts({
          diagnosisCandidates: [candidate({ categoryKey: 'GOUT', codes: ['M109'] })],
          payer: { payerId: 'p', category, rawName: category },
        }),
        ruleSet,
      )
      expect(result.finalDisposition, category).toBe('GREEN')
    }
  })
})

describe('yellow and red diagnoses', () => {
  it('routes osteoarthritis to physician review', () => {
    const result = evaluateTriage(
      facts({ diagnosisCandidates: [candidate({ categoryKey: 'OSTEOARTHRITIS', codes: ['M170'] })] }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('YELLOW')
    expect(result.nextAction).toMatch(/physician/i)
  })

  it('declines fibromyalgia as the reason for referral', () => {
    const result = evaluateTriage(
      facts({ diagnosisCandidates: [candidate({ categoryKey: 'FIBROMYALGIA', codes: ['M797'] })] }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('RED')
    // Never phrased as a denial of care, and never auto-communicated.
    expect(result.nextAction).toMatch(/do not schedule/i)
    expect(result.decisiveReason).toMatch(/not accepted as the reason for referral/i)
  })

  it('sends an existing patient to the physician whatever the diagnosis', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'GOUT', codes: ['M109'] })],
        patientStatus: 'FORMER_PATIENT',
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('YELLOW')
  })
})

describe('the primary-diagnosis rule', () => {
  it('schedules an RA referral that also mentions fibromyalgia', () => {
    // The case the practice raised: fibromyalgia in a packet is fine, a
    // referral FOR fibromyalgia is not.
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [
          candidate({ categoryKey: 'RHEUMATOID_ARTHRITIS', rank: 1, isPrimary: true, confidence: 92, codes: ['M0579'] }),
          candidate({
            categoryKey: 'FIBROMYALGIA', rank: 2, isPrimary: false, confidence: 61,
            strongestContext: 'PROBLEM_LIST', codes: ['M797'],
          }),
        ],
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('GREEN')
    // Surfaced, not suppressed.
    expect(result.noted.map((n) => n.categoryKey)).toContain('FIBROMYALGIA')
    expect(result.noted[0]?.note).toMatch(/not the primary diagnosis, not blocking/i)
  })

  it('declines when fibromyalgia IS the primary, even with another category present', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [
          candidate({ categoryKey: 'FIBROMYALGIA', rank: 1, isPrimary: true, confidence: 94, codes: ['M797'] }),
          candidate({
            categoryKey: 'OSTEOPOROSIS', rank: 2, isPrimary: false, confidence: 58,
            strongestContext: 'PAST_HISTORY', codes: ['M810'],
          }),
        ],
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('RED')
  })

  it('will not decline on a historical or hedged mention', () => {
    for (const polarity of ['HISTORICAL', 'HEDGED', 'RULED_OUT', 'FAMILY'] as const) {
      const result = evaluateTriage(
        facts({
          diagnosisCandidates: [candidate({ categoryKey: 'FIBROMYALGIA', polarity, codes: ['M797'] })],
        }),
        ruleSet,
      )
      expect(result.finalDisposition, polarity).not.toBe('RED')
    }
  })

  it('will not decline on a low-confidence text-only match', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [
          candidate({ categoryKey: 'FIBROMYALGIA', confidence: 40, matchType: 'TEXT_SYNONYM', strongestContext: 'REFERRAL_REASON' }),
        ],
      }),
      ruleSet,
    )
    expect(result.finalDisposition).not.toBe('RED')
  })

  it('refuses to pick when the top two candidates are contested', () => {
    const result = evaluateTriage(
      facts({
        primaryDeterminacy: 'CONTESTED',
        diagnosisCandidates: [
          candidate({ categoryKey: 'RHEUMATOID_ARTHRITIS', rank: 1, isPrimary: false, confidence: 71 }),
          candidate({ categoryKey: 'FIBROMYALGIA', rank: 2, isPrimary: false, confidence: 66 }),
        ],
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('YELLOW')
    expect(result.decisiveReason).toMatch(/too close to separate/i)
    // Uncertainty is reported as uncertainty, not dressed up.
    expect(result.dispositionConfidence).toBeLessThan(90)
  })
})

describe('unknown and unmapped', () => {
  it('routes an unidentifiable diagnosis to a person, not a silent bucket', () => {
    const result = evaluateTriage(
      facts({ diagnosisCandidates: [], primaryDeterminacy: 'NONE' }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('YELLOW')
    expect(result.dispositionConfidence).toBeLessThan(70)
  })

  it('honours an organization that prefers UNKNOWN over YELLOW', () => {
    const result = evaluateTriage(
      facts({ diagnosisCandidates: [], primaryDeterminacy: 'NONE' }),
      compiledRheumatologyRuleSet({ unknownBehavior: 'UNKNOWN' }),
    )
    expect(result.finalDisposition).toBe('UNKNOWN')
  })

  it('treats a below-floor confidence as not confident enough to act on', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'FIBROMYALGIA', confidence: 50, codes: ['M797'] })],
      }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('YELLOW')
    expect(result.dimensions.find((d) => d.dimension === 'DIAGNOSIS')?.summary).toMatch(/below/i)
  })
})

describe('explainability', () => {
  it('always reports every dimension, not just the deciding one', () => {
    const result = evaluateTriage(
      facts({
        diagnosisCandidates: [candidate({ categoryKey: 'OSTEOPOROSIS', codes: ['M810'] })],
        requirements: documentsMissing('DXA_REPORT'),
      }),
      ruleSet,
    )
    const dims = result.dimensions.map((d) => d.dimension)
    expect(dims).toContain('DIAGNOSIS')
    expect(dims).toContain('PAYER')
    expect(dims).toContain('DOCUMENTATION')
    expect(result.dimensions.filter((d) => d.decisive)).toHaveLength(1)
  })

  it('carries the matched rule ids so a result traces back to a rule', () => {
    const result = evaluateTriage(
      facts({ diagnosisCandidates: [candidate({ categoryKey: 'GOUT', codes: ['M109'] })] }),
      ruleSet,
    )
    const diagnosis = result.dimensions.find((d) => d.dimension === 'DIAGNOSIS')
    expect(diagnosis?.matchedRuleIds.length).toBeGreaterThan(0)
  })

  it('names the engine version, so a historical result is reproducible', () => {
    const result = evaluateTriage(facts(), ruleSet)
    expect(result.engineVersion).toMatch(/triage-engine@/)
  })

  it('is deterministic: the same facts produce the same result', () => {
    const input = facts({ diagnosisCandidates: [candidate({ categoryKey: 'GOUT', codes: ['M109'] })] })
    const a = evaluateTriage(input, ruleSet)
    const b = evaluateTriage(input, ruleSet)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('rule actions', () => {
  it('expedites giant cell arteritis without changing its disposition', () => {
    const result = evaluateTriage(
      facts({ diagnosisCandidates: [candidate({ categoryKey: 'GIANT_CELL_ARTERITIS', codes: ['M316'] })] }),
      ruleSet,
    )
    expect(result.finalDisposition).toBe('GREEN')
    expect(result.actions.some((a) => a.type === 'SET_PRIORITY')).toBe(true)
  })
})
