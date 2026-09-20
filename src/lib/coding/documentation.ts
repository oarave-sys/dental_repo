import type { CodeRepository, DocumentationRuleRecord } from '@/lib/codes/types'
import { factLabel } from '@/lib/codes/attributes'
import type { ProcedureIntent } from './facts'
import { factRelevantToKind } from './vocabulary'
import type { DocumentationItem, DocumentationScore } from './result'
import { describeSurfaces, formatSurfaces } from './surfaces'
import { formatTeeth } from './teeth'

/**
 * Documentation review and the completeness indicator.
 *
 * Two rules from the product brief are enforced structurally here rather than
 * left to prompt wording:
 *
 *   1. The score measures whether CODING-RELEVANT INFORMATION IS PRESENT. It
 *      says nothing about the quality of the dentistry. Every point that is
 *      missing traces to a specific documentation rule, so the number can
 *      always be explained — there are no unexplainable scores.
 *
 *   2. Missing information is reported as ABSENT, never as something to add.
 *      "The reason for replacement is not documented" is a statement of fact.
 *      "Add that recurrent decay was present" would be telling a practice to
 *      write down something that may never have happened, and this module is
 *      written so there is nowhere for that phrasing to come from: the text
 *      for a missing item is generated from the rule's neutral label, never
 *      from the candidate code's expectations.
 */

/** Reads the value of a fact key off an intent, or null when absent. */
function factValue(intent: ProcedureIntent, factKey: string): string | null {
  switch (factKey) {
    case 'tooth_numbers':
      return intent.toothIds.length > 0 ? formatTeeth(intent.toothIds) : null
    case 'surfaces':
      return intent.surfaces.length > 0
        ? `${formatSurfaces(intent.surfaces)} (${describeSurfaces(intent.surfaces)})`
        : null
    case 'material':
      return intent.materials.length > 0 ? intent.materials.join(', ') : null
    case 'dentition':
      return intent.dentition ? intent.dentition.toLowerCase() : null
    case 'age_band':
      return intent.ageBand ? intent.ageBand.toLowerCase() : null
    case 'image_count':
      return intent.imageCount !== null ? String(intent.imageCount) : null
    case 'quadrants':
    case 'quadrant':
      return intent.quadrants.length > 0 ? intent.quadrants.join(', ') : null
    case 'arch':
      return intent.arches.length > 0 ? intent.arches.join(', ').toLowerCase() : null
    case 'restoration_intent':
      return intent.restorationIntent
        ? intent.restorationIntent === 'REPLACEMENT'
          ? 'replacement of an existing restoration'
          : 'new restoration'
        : null
    case 'clinical_reasons':
      return intent.clinicalReasons.length > 0 ? intent.clinicalReasons.join(', ') : null
    case 'existing_restoration':
      return intent.existingRestoration
    default:
      return intent.attributes[factKey] ?? null
  }
}

/**
 * Phrasing for an absent element. Deliberately describes the gap and asks,
 * rather than instructing the practice to record anything.
 */
function absentDetail(rule: DocumentationRuleRecord): string {
  return `${rule.label} is not documented. ${rule.promptQuestion}`
}

export interface DocumentationReview {
  score: DocumentationScore
  /** Rules that are CODING_REQUIRED and unmet — these gate confidence. */
  unmetRequiredFactKeys: string[]
}

export async function reviewDocumentation(
  repository: CodeRepository,
  intents: readonly ProcedureIntent[],
  /** Codes under consideration, so code-specific rules apply too. */
  codesByIntent: ReadonlyMap<string, readonly string[]>,
): Promise<DocumentationReview> {
  const present: DocumentationItem[] = []
  const needsReview: DocumentationItem[] = []
  const claimSupport: DocumentationItem[] = []
  const unmetRequiredFactKeys: string[] = []

  let earnedWeight = 0
  let totalWeight = 0

  for (const intent of intents) {
    const rules: DocumentationRuleRecord[] = []
    if (intent.category) {
      const categoryRules = await repository.documentationRules({ category: intent.category })
      // A category rule only applies to a procedure the fact actually bears on.
      // Without this, a crown gets asked which surfaces were restored.
      rules.push(
        ...categoryRules.filter((r) => factRelevantToKind(intent.procedureKind, r.factKey)),
      )
    }
    for (const code of codesByIntent.get(intent.id) ?? []) {
      rules.push(...(await repository.documentationRules({ code })))
    }

    // De-duplicate: a code rule and a category rule for the same fact are one
    // requirement, and the score must not count it twice.
    const byFact = new Map<string, DocumentationRuleRecord>()
    for (const rule of rules) {
      const existing = byFact.get(rule.factKey)
      if (!existing || rule.scope === 'CODE') byFact.set(rule.factKey, rule)
    }

    for (const rule of byFact.values()) {
      const value = factValue(intent, rule.factKey)
      totalWeight += rule.weight

      const item: DocumentationItem = {
        label: rule.label,
        factKey: rule.factKey,
        status: value ? 'PRESENT' : 'MISSING',
        kind: rule.kind,
        detail: value ? `${rule.label}: ${value}` : absentDetail(rule),
        intentId: intent.id,
      }

      if (value) {
        earnedWeight += rule.weight
        present.push(item)
      } else if (rule.kind === 'CODING_REQUIRED') {
        needsReview.push(item)
        unmetRequiredFactKeys.push(`${intent.id}:${rule.factKey}`)
      } else {
        claimSupport.push(item)
      }
    }
  }

  const percentage = totalWeight === 0 ? 100 : Math.round((earnedWeight / totalWeight) * 100)

  return {
    score: { percentage, earnedWeight, totalWeight, present, needsReview, claimSupport },
    unmetRequiredFactKeys: [...new Set(unmetRequiredFactKeys)],
  }
}

/** A neutral question for a fact key with no documentation rule behind it. */
export function genericQuestion(factKey: string): string {
  switch (factKey) {
    case 'surfaces':
      return 'Which surface or surfaces were restored?'
    case 'tooth_numbers':
      return 'Which tooth was treated?'
    case 'material':
      return 'What material was used?'
    case 'dentition':
      return 'Is the tooth primary or permanent?'
    case 'age_band':
      return 'Is the dentition adult (permanent) or child (primary/transitional)?'
    case 'image_count':
      return 'How many images were taken?'
    case 'evaluation_type':
      return 'Was this a periodic recall evaluation, a comprehensive evaluation, or a limited problem-focused evaluation?'
    case 'extraction_complexity':
      return 'Was bone removed, a flap raised, or the tooth sectioned?'
    case 'arch':
      return 'Which arch was treated?'
    case 'tooth_count_in_quadrant':
      return 'How many teeth in that quadrant were treated?'
    case 'fluoride_form':
      return 'Was the fluoride applied as a varnish, or as a gel or foam?'
    case 'restoration_intent':
      return 'Was this a new restoration, or was an existing restoration replaced?'
    default:
      return `What was the ${factLabel(factKey).toLowerCase()}?`
  }
}

/** Closed answer sets, offered as buttons so the common case is one tap. */
export function questionOptions(factKey: string): string[] {
  switch (factKey) {
    case 'dentition':
      return ['Permanent', 'Primary']
    case 'age_band':
      return ['Adult', 'Child']
    case 'evaluation_type':
      return ['Periodic (recall)', 'Comprehensive (new patient)', 'Limited (problem focused)']
    case 'extraction_complexity':
      return ['Simple — no bone removal or sectioning', 'Surgical — bone removed or tooth sectioned', 'Impacted']
    case 'fluoride_form':
      return ['Varnish', 'Gel or foam']
    case 'arch':
      return ['Maxillary (upper)', 'Mandibular (lower)']
    case 'restoration_intent':
      return ['New restoration', 'Replacement of an existing restoration']
    case 'pulp_cap_type':
      return ['Direct', 'Indirect']
    case 'guard_type':
      return ['Hard', 'Soft']
    case 'reline_setting':
      return ['Chairside', 'Laboratory']
    case 'post_type':
      return ['Prefabricated', 'Cast']
    case 'abutment_type':
      return ['Prefabricated', 'Custom']
    case 'retention_type':
      return ['Abutment supported', 'Implant supported']
    case 'restoration_shape':
      return ['Inlay', 'Onlay']
    case 'bitewing_orientation':
      return ['Horizontal', 'Vertical']
    default:
      return []
  }
}
