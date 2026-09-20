import type { ProcedureCategory } from '@/lib/coding/vocabulary'

/**
 * A procedure code as the engine sees it, independent of where it was stored.
 *
 * The repository interface below is what makes the reference-data layer
 * replaceable: the engine depends on this shape, not on Prisma, so the demo
 * JSON file, a licensed import in Postgres, or a future hosted code service
 * are all interchangeable without touching a line of reasoning code.
 */
export interface CodeAttributes {
  /** Every attribute, multi-valued. */
  all: ReadonlyMap<string, readonly string[]>
  has(key: string, value?: string): boolean
  get(key: string): string | null
  values(key: string): readonly string[]
  number(key: string): number | null
  boolean(key: string): boolean
}

export interface CodeRelationship {
  toCode: string
  type:
    | 'COMMONLY_CONFUSED_WITH'
    | 'ALTERNATIVE_TO'
    | 'BUNDLED_WITH'
    | 'MUTUALLY_EXCLUSIVE_WITH'
    | 'SAME_FAMILY_DIFFERENT_COUNT'
  note: string | null
}

export interface ProcedureCodeRecord {
  code: string
  category: ProcedureCategory
  subcategory: string | null

  /** Our own writing. Always present. */
  shortLabel: string
  plainLanguage: string
  commonUse: string | null
  distinctions: string | null
  documentationConsiderations: readonly string[]
  verifyQuestions: readonly string[]

  /** Licensed content. Null unless a licensed dataset is loaded. */
  officialDescriptor: string | null
  officialDescriptorSource: string | null

  attributes: CodeAttributes
  relationships: readonly CodeRelationship[]
  status: 'ACTIVE' | 'DEPRECATED'
}

export interface DocumentationRuleRecord {
  scope: 'CATEGORY' | 'CODE'
  category: ProcedureCategory | null
  code: string | null
  factKey: string
  label: string
  kind: 'CODING_REQUIRED' | 'CLAIM_SUPPORT'
  weight: number
  promptQuestion: string
}

export interface DatasetInfo {
  key: string
  name: string
  kind: 'DEMO' | 'LICENSED'
  sourceNote: string | null
  /** True when descriptors come from a licensed distribution. */
  hasOfficialDescriptors: boolean
  codeCount: number
}

/**
 * The contract the coding engine retrieves candidates through.
 *
 * Note what is missing: there is no method that accepts free text and returns
 * a code the caller has not already justified. Retrieval is always by an
 * explicit, structured query, which is what keeps a language model from being
 * able to smuggle a code into the result.
 */
export interface CodeRepository {
  info(): Promise<DatasetInfo>
  /** Exact lookup. Returns null for a code that is not in the dataset. */
  findByCode(code: string): Promise<ProcedureCodeRecord | null>
  findManyByCode(codes: readonly string[]): Promise<ProcedureCodeRecord[]>
  /** All codes carrying attribute procedure_kind = kind. */
  findByProcedureKind(kind: string): Promise<ProcedureCodeRecord[]>
  findByCategory(category: ProcedureCategory): Promise<ProcedureCodeRecord[]>
  /** Plain-text search over our own wording, for the code browser. */
  search(term: string, limit?: number): Promise<ProcedureCodeRecord[]>
  documentationRules(params: {
    category?: ProcedureCategory | null
    code?: string | null
  }): Promise<DocumentationRuleRecord[]>
}
