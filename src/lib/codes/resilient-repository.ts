import { MemoryCodeRepository } from './memory-repository'
import { logger } from '@/lib/logging/logger'
import type {
  CodeRepository,
  DatasetInfo,
  DocumentationRuleRecord,
  ProcedureCodeRecord,
} from './types'
import type { ProcedureCategory } from '@/lib/coding/vocabulary'

/**
 * A repository that prefers the database and falls back to the shipped file.
 *
 * The procedure-code dataset is static reference data that travels with the
 * application, so a database copy of it is an operational convenience rather
 * than a requirement. Treating it as required produced a bad first run: a
 * freshly deployed instance with an empty database answered every query with
 * "no code found", which reads like a broken product rather than a missing
 * import step.
 *
 * So: use the active dataset in Postgres when there is one — that is what a
 * licensed CDT import populates, and it must win — and otherwise serve the
 * bundled demo dataset and say so. The engine cannot tell the difference,
 * because both satisfy CodeRepository.
 *
 * The choice is resolved once, on first use, and cached. A database that goes
 * down mid-process does not silently switch the codes out from under a
 * running request; it surfaces as an error, which is the honest outcome.
 */
export class ResilientCodeRepository implements CodeRepository {
  private resolved: Promise<{ repo: CodeRepository; usingFile: boolean }> | null = null

  constructor(
    private readonly database: CodeRepository,
    private readonly file: CodeRepository = MemoryCodeRepository.demo(),
  ) {}

  private async choose(): Promise<{ repo: CodeRepository; usingFile: boolean }> {
    this.resolved ??= (async () => {
      try {
        const info = await this.database.info()
        if (info.codeCount > 0) return { repo: this.database, usingFile: false }
        logger.info('codes.falling_back_to_file', { reason: 'no_active_dataset' })
      } catch {
        // An unreachable database at startup should not take the coding tools
        // with it. Everything else in the app will fail loudly on its own.
        logger.warn('codes.falling_back_to_file', { reason: 'database_unavailable' })
      }
      return { repo: this.file, usingFile: true }
    })()
    return this.resolved
  }

  /** Whether the shipped file is serving codes rather than the database. */
  async usingBundledDataset(): Promise<boolean> {
    return (await this.choose()).usingFile
  }

  async info(): Promise<DatasetInfo> {
    return (await this.choose()).repo.info()
  }

  async findByCode(code: string): Promise<ProcedureCodeRecord | null> {
    return (await this.choose()).repo.findByCode(code)
  }

  async findManyByCode(codes: readonly string[]): Promise<ProcedureCodeRecord[]> {
    return (await this.choose()).repo.findManyByCode(codes)
  }

  async findByProcedureKind(kind: string): Promise<ProcedureCodeRecord[]> {
    return (await this.choose()).repo.findByProcedureKind(kind)
  }

  async findByCategory(category: ProcedureCategory): Promise<ProcedureCodeRecord[]> {
    return (await this.choose()).repo.findByCategory(category)
  }

  async search(term: string, limit?: number): Promise<ProcedureCodeRecord[]> {
    return (await this.choose()).repo.search(term, limit)
  }

  async documentationRules(params: {
    category?: ProcedureCategory | null
    code?: string | null
  }): Promise<DocumentationRuleRecord[]> {
    return (await this.choose()).repo.documentationRules(params)
  }
}
