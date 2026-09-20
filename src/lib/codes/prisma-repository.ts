import type { PrismaClient } from '@/generated/prisma/client'
import { buildAttributes } from './attributes'
import type {
  CodeRepository,
  DatasetInfo,
  DocumentationRuleRecord,
  ProcedureCodeRecord,
} from './types'
import type { ProcedureCategory } from '@/lib/coding/vocabulary'
import { AppError } from '@/lib/errors'

type CodeRow = {
  id: string
  code: string
  category: string
  subcategory: string | null
  shortLabel: string
  plainLanguage: string
  commonUse: string | null
  distinctions: string | null
  documentationConsiderations: string[]
  verifyQuestions: string[]
  officialDescriptor: string | null
  officialDescriptorSource: string | null
  status: string
  attributes: Array<{ key: string; value: string }>
  relationsFrom: Array<{ type: string; note: string | null; toCode: { code: string } }>
}

function toRecord(row: CodeRow): ProcedureCodeRecord {
  return {
    code: row.code,
    category: row.category as ProcedureCategory,
    subcategory: row.subcategory,
    shortLabel: row.shortLabel,
    plainLanguage: row.plainLanguage,
    commonUse: row.commonUse,
    distinctions: row.distinctions,
    documentationConsiderations: row.documentationConsiderations,
    verifyQuestions: row.verifyQuestions,
    officialDescriptor: row.officialDescriptor,
    officialDescriptorSource: row.officialDescriptorSource,
    attributes: buildAttributes(row.attributes),
    relationships: row.relationsFrom.map((r) => ({
      toCode: r.toCode.code,
      type: r.type as ProcedureCodeRecord['relationships'][number]['type'],
      note: r.note,
    })),
    status: row.status as 'ACTIVE' | 'DEPRECATED',
  }
}

const INCLUDE = {
  attributes: { select: { key: true, value: true } },
  relationsFrom: {
    select: { type: true, note: true, toCode: { select: { code: true } } },
  },
} as const

/**
 * The production reference-data repository.
 *
 * Reference data is global rather than tenant-scoped — every practice codes
 * against the same approved dataset — so this takes the unscoped client. That
 * is safe here precisely because these tables carry no organizationId and no
 * clinical content: there is nothing tenant-specific to leak.
 *
 * Exactly one dataset is active at a time. Retrieval is confined to it, so a
 * dataset swap is atomic from the engine's point of view.
 */
export class PrismaCodeRepository implements CodeRepository {
  private datasetId: string | null = null

  constructor(private readonly db: PrismaClient) {}

  private async activeDatasetId(): Promise<string> {
    if (this.datasetId) return this.datasetId
    const dataset = await this.db.codeDataset.findFirst({
      where: { isActive: true },
      select: { id: true },
    })
    if (!dataset) {
      throw new AppError(
        'INTERNAL',
        'No procedure-code dataset is active. Run the code importer before using the coding tools.',
      )
    }
    this.datasetId = dataset.id
    return dataset.id
  }

  async info(): Promise<DatasetInfo> {
    const id = await this.activeDatasetId()
    const dataset = await this.db.codeDataset.findUniqueOrThrow({ where: { id } })
    const codeCount = await this.db.procedureCode.count({ where: { datasetId: id } })
    const withDescriptor = await this.db.procedureCode.count({
      where: { datasetId: id, officialDescriptor: { not: null } },
    })
    return {
      key: dataset.key,
      name: dataset.name,
      kind: dataset.kind,
      sourceNote: dataset.sourceNote,
      hasOfficialDescriptors: withDescriptor > 0,
      codeCount,
    }
  }

  async findByCode(code: string): Promise<ProcedureCodeRecord | null> {
    const datasetId = await this.activeDatasetId()
    const row = await this.db.procedureCode.findUnique({
      where: { datasetId_code: { datasetId, code: code.trim().toUpperCase() } },
      include: INCLUDE,
    })
    return row ? toRecord(row as unknown as CodeRow) : null
  }

  async findManyByCode(codes: readonly string[]): Promise<ProcedureCodeRecord[]> {
    if (codes.length === 0) return []
    const datasetId = await this.activeDatasetId()
    const rows = await this.db.procedureCode.findMany({
      where: { datasetId, code: { in: codes.map((c) => c.trim().toUpperCase()) } },
      include: INCLUDE,
    })
    return rows.map((r) => toRecord(r as unknown as CodeRow))
  }

  async findByProcedureKind(kind: string): Promise<ProcedureCodeRecord[]> {
    const datasetId = await this.activeDatasetId()
    const rows = await this.db.procedureCode.findMany({
      where: {
        datasetId,
        status: 'ACTIVE',
        attributes: { some: { key: 'procedure_kind', value: kind } },
      },
      include: INCLUDE,
      orderBy: { code: 'asc' },
    })
    return rows.map((r) => toRecord(r as unknown as CodeRow))
  }

  async findByCategory(category: ProcedureCategory): Promise<ProcedureCodeRecord[]> {
    const datasetId = await this.activeDatasetId()
    const rows = await this.db.procedureCode.findMany({
      where: { datasetId, status: 'ACTIVE', category },
      include: INCLUDE,
      orderBy: { code: 'asc' },
    })
    return rows.map((r) => toRecord(r as unknown as CodeRow))
  }

  async search(term: string, limit = 25): Promise<ProcedureCodeRecord[]> {
    const q = term.trim()
    if (!q) return []
    const datasetId = await this.activeDatasetId()
    const rows = await this.db.procedureCode.findMany({
      where: {
        datasetId,
        OR: [
          { code: { contains: q.toUpperCase() } },
          { shortLabel: { contains: q, mode: 'insensitive' } },
          { plainLanguage: { contains: q, mode: 'insensitive' } },
          { subcategory: { contains: q, mode: 'insensitive' } },
        ],
      },
      include: INCLUDE,
      orderBy: { code: 'asc' },
      take: limit,
    })
    return rows.map((r) => toRecord(r as unknown as CodeRow))
  }

  async documentationRules(params: {
    category?: ProcedureCategory | null
    code?: string | null
  }): Promise<DocumentationRuleRecord[]> {
    const datasetId = await this.activeDatasetId()
    const rows = await this.db.documentationRule.findMany({
      where: {
        OR: [
          params.category ? { scope: 'CATEGORY' as const, category: params.category } : undefined,
          params.code
            ? { scope: 'CODE' as const, code: { datasetId, code: params.code } }
            : undefined,
        ].filter(Boolean) as object[],
      },
      include: { code: { select: { code: true } } },
    })
    return rows.map((r) => ({
      scope: r.scope,
      category: (r.category as ProcedureCategory | null) ?? null,
      code: r.code?.code ?? null,
      factKey: r.factKey,
      label: r.label,
      kind: r.kind,
      weight: r.weight,
      promptQuestion: r.promptQuestion,
    }))
  }
}
