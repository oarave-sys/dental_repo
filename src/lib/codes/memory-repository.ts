import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DatasetSchema, normaliseAttributes, type Dataset } from './dataset-schema'
import { buildAttributes } from './attributes'
import type {
  CodeRepository,
  DatasetInfo,
  DocumentationRuleRecord,
  ProcedureCodeRecord,
} from './types'
import type { ProcedureCategory } from '@/lib/coding/vocabulary'

/**
 * A repository backed by a dataset file held in memory.
 *
 * Two jobs. It is what the engine's test suite runs against, so the reasoning
 * can be tested exhaustively with no database and no API key. And it is the
 * fallback the running application uses when DATABASE_URL is absent, which is
 * what lets the product be demonstrated end to end before any infrastructure
 * exists.
 *
 * It is a real implementation of the same interface, not a stub — swapping it
 * for the Prisma one changes where rows live and nothing else.
 */
export class MemoryCodeRepository implements CodeRepository {
  private readonly dataset: Dataset
  private readonly byCode: Map<string, ProcedureCodeRecord>
  private readonly byKind: Map<string, ProcedureCodeRecord[]>
  private readonly byCategory: Map<string, ProcedureCodeRecord[]>
  private readonly rules: DocumentationRuleRecord[]

  constructor(dataset: Dataset) {
    this.dataset = dataset
    this.byCode = new Map()
    this.byKind = new Map()
    this.byCategory = new Map()

    for (const raw of dataset.codes) {
      const record: ProcedureCodeRecord = {
        code: raw.code,
        category: raw.category as ProcedureCategory,
        subcategory: raw.subcategory ?? null,
        shortLabel: raw.shortLabel,
        plainLanguage: raw.plainLanguage,
        commonUse: raw.commonUse ?? null,
        distinctions: raw.distinctions ?? null,
        documentationConsiderations: raw.documentationConsiderations,
        verifyQuestions: raw.verifyQuestions,
        officialDescriptor: raw.officialDescriptor ?? null,
        officialDescriptorSource: raw.officialDescriptorSource ?? null,
        attributes: buildAttributes(normaliseAttributes(raw.attributes)),
        relationships: raw.relationships.map((r) => ({
          toCode: r.to,
          type: r.type,
          note: r.note ?? null,
        })),
        status: raw.status,
      }
      this.byCode.set(record.code, record)

      for (const kind of record.attributes.values('procedure_kind')) {
        const list = this.byKind.get(kind)
        if (list) list.push(record)
        else this.byKind.set(kind, [record])
      }

      const catList = this.byCategory.get(record.category)
      if (catList) catList.push(record)
      else this.byCategory.set(record.category, [record])
    }

    this.rules = dataset.documentationRules.map((r) => ({
      scope: r.scope,
      category: (r.category as ProcedureCategory | undefined) ?? null,
      code: r.code ?? null,
      factKey: r.factKey,
      label: r.label,
      kind: r.kind,
      weight: r.weight,
      promptQuestion: r.promptQuestion,
    }))
  }

  static fromFile(filePath: string): MemoryCodeRepository {
    const parsed = DatasetSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')))
    return new MemoryCodeRepository(parsed)
  }

  /** The demo dataset shipped with the repository. */
  static demo(): MemoryCodeRepository {
    return MemoryCodeRepository.fromFile(
      path.join(process.cwd(), 'data', 'demo-dataset', 'general-dentistry.json'),
    )
  }

  async info(): Promise<DatasetInfo> {
    return {
      key: this.dataset.key,
      name: this.dataset.name,
      kind: this.dataset.kind,
      sourceNote: this.dataset.sourceNote ?? null,
      hasOfficialDescriptors: this.dataset.codes.some((c) => Boolean(c.officialDescriptor)),
      codeCount: this.dataset.codes.length,
    }
  }

  async findByCode(code: string): Promise<ProcedureCodeRecord | null> {
    return this.byCode.get(code.trim().toUpperCase()) ?? null
  }

  async findManyByCode(codes: readonly string[]): Promise<ProcedureCodeRecord[]> {
    const out: ProcedureCodeRecord[] = []
    for (const c of codes) {
      const found = this.byCode.get(c.trim().toUpperCase())
      if (found) out.push(found)
    }
    return out
  }

  async findByProcedureKind(kind: string): Promise<ProcedureCodeRecord[]> {
    return [...(this.byKind.get(kind) ?? [])].filter((c) => c.status === 'ACTIVE')
  }

  async findByCategory(category: ProcedureCategory): Promise<ProcedureCodeRecord[]> {
    return [...(this.byCategory.get(category) ?? [])].filter((c) => c.status === 'ACTIVE')
  }

  async search(term: string, limit = 25): Promise<ProcedureCodeRecord[]> {
    const q = term.trim().toLowerCase()
    if (!q) return []
    const scored: Array<{ record: ProcedureCodeRecord; score: number }> = []
    for (const record of this.byCode.values()) {
      let score = 0
      if (record.code.toLowerCase() === q) score += 100
      else if (record.code.toLowerCase().startsWith(q)) score += 50
      if (record.shortLabel.toLowerCase().includes(q)) score += 10
      if (record.plainLanguage.toLowerCase().includes(q)) score += 4
      if (record.subcategory?.toLowerCase().includes(q)) score += 3
      if (score > 0) scored.push({ record, score })
    }
    return scored
      .sort((a, b) => b.score - a.score || a.record.code.localeCompare(b.record.code))
      .slice(0, limit)
      .map((s) => s.record)
  }

  async documentationRules(params: {
    category?: ProcedureCategory | null
    code?: string | null
  }): Promise<DocumentationRuleRecord[]> {
    return this.rules.filter((r) => {
      if (r.scope === 'CATEGORY') return params.category ? r.category === params.category : false
      return params.code ? r.code === params.code : false
    })
  }
}
