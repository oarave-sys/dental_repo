import { describe, expect, it, vi } from 'vitest'
import { MemoryCodeRepository, ResilientCodeRepository } from '@/lib/codes'
import type { CodeRepository, DatasetInfo } from '@/lib/codes'

/**
 * A freshly deployed instance has an empty database until somebody runs the
 * import. Answering "no code found" to every question in that window reads as
 * a broken product, so the bundled dataset covers it.
 *
 * The rule that matters: a database that HAS codes must always win, because
 * that is where a licensed CDT dataset lives.
 */

function stub(overrides: Partial<CodeRepository> & { info: () => Promise<DatasetInfo> }) {
  return {
    findByCode: async () => null,
    findManyByCode: async () => [],
    findByProcedureKind: async () => [],
    findByCategory: async () => [],
    search: async () => [],
    documentationRules: async () => [],
    ...overrides,
  } as CodeRepository
}

const licensedInfo: DatasetInfo = {
  key: 'cdt-2026',
  name: 'Licensed CDT',
  kind: 'LICENSED',
  codeCount: 900,
  hasOfficialDescriptors: true,
}

describe('reference data falls back to the shipped file', () => {
  it('uses the database when it holds an imported dataset', async () => {
    const database = stub({
      info: async () => licensedInfo,
      findByProcedureKind: async () => [{ code: 'FROM-DB' } as never],
    })

    const repo = new ResilientCodeRepository(database, MemoryCodeRepository.demo())

    expect(await repo.usingBundledDataset()).toBe(false)
    expect((await repo.info()).kind).toBe('LICENSED')
    expect((await repo.findByProcedureKind('crown')).map((c) => c.code)).toEqual(['FROM-DB'])
  })

  it('falls back when the database has no codes yet', async () => {
    const database = stub({
      info: async () => ({ ...licensedInfo, codeCount: 0 }),
    })

    const repo = new ResilientCodeRepository(database, MemoryCodeRepository.demo())

    expect(await repo.usingBundledDataset()).toBe(true)
    expect((await repo.info()).kind).toBe('DEMO')
    // The tools work rather than reporting every code missing.
    expect((await repo.findByCode('D2393'))?.shortLabel).toContain('three surfaces')
  })

  it('falls back when the database cannot be reached', async () => {
    const database = stub({
      info: async () => {
        throw new Error('ECONNREFUSED')
      },
    })

    const repo = new ResilientCodeRepository(database, MemoryCodeRepository.demo())

    expect(await repo.usingBundledDataset()).toBe(true)
    expect((await repo.findByCode('D1110'))?.code).toBe('D1110')
  })

  it('probes the database once rather than on every call', async () => {
    const info = vi.fn(async () => licensedInfo)
    const repo = new ResilientCodeRepository(stub({ info }), MemoryCodeRepository.demo())

    // Only non-info methods, so every info() call counted here is the probe.
    await Promise.all([
      repo.findByCode('D2393'),
      repo.search('crown'),
      repo.findByProcedureKind('crown'),
    ])
    await repo.findByCode('D1110')

    // One probe for four calls, including three issued concurrently — and so
    // no chance of the source changing midway through a request.
    expect(info).toHaveBeenCalledTimes(1)
  })
})
