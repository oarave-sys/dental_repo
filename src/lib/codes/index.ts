import { MemoryCodeRepository } from './memory-repository'
import { PrismaCodeRepository } from './prisma-repository'
import { ResilientCodeRepository } from './resilient-repository'
import { unsafeCrossTenantClient } from '@/lib/db/client'
import { databaseUrl } from '@/lib/db/env'
import type { CodeRepository } from './types'

export * from './types'
export { MemoryCodeRepository } from './memory-repository'
export { PrismaCodeRepository } from './prisma-repository'
export { ResilientCodeRepository } from './resilient-repository'
export * from './attributes'

let cached: CodeRepository | null = null

/**
 * Resolves the reference-data source for the running application.
 *
 * With a database configured, codes come from the active dataset in Postgres
 * — but only if one has actually been imported. An empty database falls back
 * to the dataset shipped in this repository, so a fresh deploy answers
 * correctly before anybody runs the import, instead of reporting that every
 * code is missing.
 *
 * Without a database at all, the file is the only source. The engine cannot
 * tell the three cases apart.
 */
export function codeRepository(): CodeRepository {
  if (cached) return cached
  cached = databaseUrl()
    ? new ResilientCodeRepository(new PrismaCodeRepository(unsafeCrossTenantClient()))
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
