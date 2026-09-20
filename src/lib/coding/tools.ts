import type { CodeRepository, ProcedureCodeRecord } from '@/lib/codes/types'
import { codeRepository } from '@/lib/codes'
import { CATEGORY_LABELS } from './vocabulary'
import { analyse, type AnalyseOptions } from './pipeline'
import type { CodingResult } from './result'

/**
 * The three tools, as one thin layer over the pipeline.
 *
 * Find a Code and Documentation Check are the same analysis over different
 * lengths of text — a shorthand line and a clinical note behave identically to
 * the engine, which is why one pipeline serves both. Check a Code adds a
 * lookup and, when a description is supplied, the comparison.
 *
 * Claim Scrubber will be the fourth entry here: it takes a set of
 * code/description pairs and runs the same comparison across all of them. The
 * engine already produces everything it needs (see `compareSelected` in
 * pipeline.ts), which is why it is a module rather than a rewrite.
 */

export interface FindCodeInput {
  description: string
  answers?: Record<string, string>
  priorAnswers?: Array<{ question: string; answer: string }>
}

export async function findCode(
  input: FindCodeInput,
  options: Omit<AnalyseOptions, 'answers' | 'priorAnswers'> = {},
) {
  return analyse(input.description, {
    ...options,
    answers: input.answers ?? {},
    priorAnswers: input.priorAnswers ?? [],
  })
}

export interface DocumentationCheckInput {
  note: string
  /** Codes already selected for this note, if any. */
  selectedCodes?: string[]
  answers?: Record<string, string>
}

export async function documentationCheck(
  input: DocumentationCheckInput,
  options: Omit<AnalyseOptions, 'answers' | 'selectedCodes'> = {},
) {
  return analyse(input.note, {
    ...options,
    answers: input.answers ?? {},
    selectedCodes: input.selectedCodes ?? [],
  })
}

// ---------------------------------------------------------------------------
// Check a Code
// ---------------------------------------------------------------------------

export interface RelatedCode {
  code: string
  shortLabel: string
  relationship: string
  note: string | null
}

export interface CodeExplanation {
  found: true
  code: string
  category: string
  categoryLabel: string
  subcategory: string | null
  shortLabel: string
  plainLanguage: string
  commonUse: string | null
  distinctions: string | null
  documentationConsiderations: readonly string[]
  verifyQuestions: readonly string[]
  officialDescriptor: string | null
  officialDescriptorSource: string | null
  commonlyConfusedWith: RelatedCode[]
  relatedCodes: RelatedCode[]
  dataset: { key: string; kind: 'DEMO' | 'LICENSED'; name: string }
}

export interface CodeNotFound {
  found: false
  code: string
  /** Codes that look similar, so a typo is recoverable. */
  suggestions: Array<{ code: string; shortLabel: string }>
  message: string
}

export type CheckCodeResult = CodeExplanation | CodeNotFound

const RELATIONSHIP_LABELS: Record<string, string> = {
  COMMONLY_CONFUSED_WITH: 'Commonly confused with',
  ALTERNATIVE_TO: 'Alternative to',
  BUNDLED_WITH: 'Reported alongside',
  MUTUALLY_EXCLUSIVE_WITH: 'Not reported with',
  SAME_FAMILY_DIFFERENT_COUNT: 'Same procedure, different count',
}

/**
 * Explains a code — or declines to.
 *
 * A code we cannot verify gets no explanation at all. Producing a plausible
 * description of an unknown code is the single most dangerous thing a tool
 * like this could do, because it would read exactly like a verified one.
 */
export async function checkCode(
  rawCode: string,
  options: { repository?: CodeRepository } = {},
): Promise<CheckCodeResult> {
  const repository = options.repository ?? codeRepository()
  const code = rawCode.trim().toUpperCase()

  const record = await repository.findByCode(code)
  if (!record) {
    const suggestions = await nearbyCodes(repository, code)
    return {
      found: false,
      code,
      suggestions,
      message: `${code} is not in the active procedure-code dataset, so this tool cannot describe it. Check the code number, or confirm it against your current CDT reference.`,
    }
  }

  const related = await resolveRelationships(repository, record)
  const info = await repository.info()

  return {
    found: true,
    code: record.code,
    category: record.category,
    categoryLabel: CATEGORY_LABELS[record.category] ?? record.category,
    subcategory: record.subcategory,
    shortLabel: record.shortLabel,
    plainLanguage: record.plainLanguage,
    commonUse: record.commonUse,
    distinctions: record.distinctions,
    documentationConsiderations: record.documentationConsiderations,
    verifyQuestions: record.verifyQuestions,
    officialDescriptor: record.officialDescriptor,
    officialDescriptorSource: record.officialDescriptorSource,
    commonlyConfusedWith: related.filter((r) => r.relationship === RELATIONSHIP_LABELS.COMMONLY_CONFUSED_WITH),
    relatedCodes: related.filter((r) => r.relationship !== RELATIONSHIP_LABELS.COMMONLY_CONFUSED_WITH),
    dataset: { key: info.key, kind: info.kind, name: info.name },
  }
}

async function resolveRelationships(
  repository: CodeRepository,
  record: ProcedureCodeRecord,
): Promise<RelatedCode[]> {
  const targets = await repository.findManyByCode(record.relationships.map((r) => r.toCode))
  const byCode = new Map(targets.map((t) => [t.code, t]))

  return record.relationships
    .map((rel) => {
      const target = byCode.get(rel.toCode)
      if (!target) return null
      return {
        code: rel.toCode,
        shortLabel: target.shortLabel,
        relationship: RELATIONSHIP_LABELS[rel.type] ?? rel.type,
        note: rel.note,
      }
    })
    .filter((r): r is RelatedCode => r !== null)
}

/** Codes sharing the first three digits — the usual shape of a typo. */
async function nearbyCodes(
  repository: CodeRepository,
  code: string,
): Promise<Array<{ code: string; shortLabel: string }>> {
  const match = code.match(/^D(\d{1,4})/)
  if (!match?.[1]) return []
  const prefix = `D${match[1].slice(0, 3)}`
  const found = await repository.search(prefix, 5)
  return found.map((r) => ({ code: r.code, shortLabel: r.shortLabel }))
}

/**
 * Check a Code, with a description to compare against.
 *
 * Returns both the explanation and the analysis of what the description
 * actually supports, so the UI can put them side by side.
 */
export async function checkCodeAgainstDescription(
  rawCode: string,
  description: string,
  options: AnalyseOptions = {},
): Promise<{ explanation: CheckCodeResult; analysis: CodingResult | null }> {
  const explanation = await checkCode(rawCode, { repository: options.repository })
  if (!description.trim()) return { explanation, analysis: null }

  const { result } = await analyse(description, {
    ...options,
    selectedCodes: [rawCode.trim().toUpperCase()],
  })
  return { explanation, analysis: result }
}
