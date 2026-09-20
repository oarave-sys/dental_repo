import { z } from 'zod'

/**
 * The on-disk format of a procedure-code dataset.
 *
 * This is the seam the whole licensing story hangs on. A dataset file is the
 * ONLY way codes enter the system: the demo sample and a future licensed CDT
 * distribution both arrive through this schema and the importer that reads it.
 * Swapping datasets is a data operation, not a code change.
 *
 * `officialDescriptor` is deliberately optional and absent from the demo file.
 * It is the single field permitted to hold wording from a licensed
 * distribution; everything else is our own independent writing and stays ours
 * across a dataset swap.
 */

export const CATEGORIES = [
  'DIAGNOSTIC',
  'PREVENTIVE',
  'RESTORATIVE',
  'ENDODONTICS',
  'PERIODONTICS',
  'PROSTHODONTICS_REMOVABLE',
  'PROSTHODONTICS_FIXED',
  'IMPLANT_SERVICES',
  'ORAL_SURGERY',
  'ADJUNCTIVE',
] as const

export const RELATIONSHIP_TYPES = [
  'COMMONLY_CONFUSED_WITH',
  'ALTERNATIVE_TO',
  'BUNDLED_WITH',
  'MUTUALLY_EXCLUSIVE_WITH',
  'SAME_FAMILY_DIFFERENT_COUNT',
] as const

/** A code number: the letter D followed by four digits. */
const CodeNumber = z
  .string()
  .regex(/^D\d{4}$/, 'A procedure code must look like D0000.')

export const RelationshipSchema = z.object({
  to: CodeNumber,
  type: z.enum(RELATIONSHIP_TYPES),
  note: z.string().optional(),
})

/** Attribute values may be single or multi-valued; both normalise to a list. */
const AttributeValue = z.union([z.string(), z.array(z.string())])

export const DatasetCodeSchema = z.object({
  code: CodeNumber,
  category: z.enum(CATEGORIES),
  subcategory: z.string().optional(),

  shortLabel: z.string().min(1),
  plainLanguage: z.string().min(1),
  commonUse: z.string().optional(),
  distinctions: z.string().optional(),
  documentationConsiderations: z.array(z.string()).default([]),
  verifyQuestions: z.array(z.string()).default([]),

  /** Licensed content only. Absent in the demo dataset. */
  officialDescriptor: z.string().optional(),
  officialDescriptorSource: z.string().optional(),

  attributes: z.record(z.string(), AttributeValue).default({}),
  relationships: z.array(RelationshipSchema).default([]),

  status: z.enum(['ACTIVE', 'DEPRECATED']).default('ACTIVE'),
})

export const DatasetRuleSchema = z.object({
  scope: z.enum(['CATEGORY', 'CODE']),
  category: z.enum(CATEGORIES).optional(),
  code: CodeNumber.optional(),
  factKey: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['CODING_REQUIRED', 'CLAIM_SUPPORT']),
  weight: z.number().int().min(0).max(10).default(1),
  promptQuestion: z.string().min(1),
})

export const DatasetSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['DEMO', 'LICENSED']).default('DEMO'),
    sourceNote: z.string().optional(),
    codes: z.array(DatasetCodeSchema).min(1),
    documentationRules: z.array(DatasetRuleSchema).default([]),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>()
    for (const code of data.codes) {
      if (seen.has(code.code)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate code ${code.code}.` })
      }
      seen.add(code.code)
    }
    // A relationship pointing at a code the dataset does not contain would
    // render as a dangling reference in the UI, so it fails the import.
    for (const code of data.codes) {
      for (const rel of code.relationships) {
        if (!seen.has(rel.to)) {
          ctx.addIssue({
            code: 'custom',
            message: `${code.code} references ${rel.to}, which is not in this dataset.`,
          })
        }
      }
    }
    // A demo dataset carrying official descriptor text is a licensing mistake,
    // not a data entry mistake. Refuse it.
    if (data.kind === 'DEMO') {
      const offender = data.codes.find((c) => c.officialDescriptor)
      if (offender) {
        ctx.addIssue({
          code: 'custom',
          message: `Code ${offender.code} carries an officialDescriptor but the dataset is marked DEMO. Official descriptor text belongs only in a LICENSED dataset.`,
        })
      }
    }
    for (const rule of data.documentationRules) {
      if (rule.scope === 'CATEGORY' && !rule.category) {
        ctx.addIssue({ code: 'custom', message: 'A CATEGORY rule needs a category.' })
      }
      if (rule.scope === 'CODE' && !rule.code) {
        ctx.addIssue({ code: 'custom', message: 'A CODE rule needs a code.' })
      }
    }
  })

export type Dataset = z.infer<typeof DatasetSchema>
export type DatasetCode = z.infer<typeof DatasetCodeSchema>
export type DatasetRule = z.infer<typeof DatasetRuleSchema>

export function normaliseAttributes(
  attributes: Record<string, string | string[]>,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  for (const [key, value] of Object.entries(attributes)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      out.push({ key, value: v })
    }
  }
  return out
}
