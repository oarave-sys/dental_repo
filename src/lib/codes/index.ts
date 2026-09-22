import { MemoryCodeRepository } from './memory-repository'
import { PrismaCodeRepository } from './prisma-repository'
import { unsafeCrossTenantClient } from '@/lib/db/client'
import { databaseUrl } from '@/lib/db/env'
import type { CodeRepository } from './types'

export * from './types'
export { MemoryCodeRepository } from './memory-repository'
export { PrismaCodeRepository } from './prisma-repository'
export * from './attributes'

let cached: CodeRepository | null = null

/**
 * Resolves the reference-data source for the running application.
 *
 * With a database configured, codes come from the active dataset in Postgres.
 * Without one, the demo file is loaded directly so the product still runs —
 * which is what makes it possible to see the whole thing working before any
 * infrastructure is provisioned. The engine cannot tell the difference.
 */
export function codeRepository(): CodeRepository {
  if (cached) return cached
  cached = databaseUrl()
    ? new PrismaCodeRepository(unsafeCrossTenantClient())
    : MemoryCodeRepository.demo()
  return cached
}

/** Tests and the importer swap the repository explicitly. */
export function setCodeRepository(repository: CodeRepository | null): void {
  cached = repository
}

export function usingDemoFallback(): boolean {
  return !databaseUrl()
}
