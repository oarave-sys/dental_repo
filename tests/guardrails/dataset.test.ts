import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DatasetSchema } from '@/lib/codes/dataset-schema'
import { MemoryCodeRepository } from '@/lib/codes/memory-repository'

/**
 * Guardrails on the reference data itself.
 *
 * The licensing boundary is the important one here. The demo dataset must
 * never carry official descriptor text, and the schema must refuse a dataset
 * that tries to — that check is what stops copied CDT wording arriving through
 * the same door as our own writing.
 */

const DATASET_PATH = path.join(process.cwd(), 'data', 'demo-dataset', 'general-dentistry.json')
const raw = JSON.parse(readFileSync(DATASET_PATH, 'utf8'))

describe('the demo dataset', () => {
  it('parses against the dataset schema', () => {
    expect(() => DatasetSchema.parse(raw)).not.toThrow()
  })

  it('is marked as demo data and says so in its provenance note', () => {
    const dataset = DatasetSchema.parse(raw)
    expect(dataset.kind).toBe('DEMO')
    expect(dataset.sourceNote).toMatch(/sample data/i)
    expect(dataset.sourceNote).toMatch(/not the official CDT descriptor/i)
  })

  it('carries no official descriptor text anywhere', () => {
    const dataset = DatasetSchema.parse(raw)
    for (const code of dataset.codes) {
      expect(code.officialDescriptor, code.code).toBeUndefined()
      expect(code.officialDescriptorSource, code.code).toBeUndefined()
    }
  })

  it('gives every code our own plain-language explanation', () => {
    const dataset = DatasetSchema.parse(raw)
    for (const code of dataset.codes) {
      expect(code.shortLabel.length, code.code).toBeGreaterThan(5)
      expect(code.plainLanguage.length, code.code).toBeGreaterThan(20)
    }
  })

  it('links every code to the procedure vocabulary so it can be retrieved', () => {
    const dataset = DatasetSchema.parse(raw)
    for (const code of dataset.codes) {
      expect(code.attributes.procedure_kind, `${code.code} has no procedure_kind`).toBeDefined()
    }
  })

  it('has no dangling relationship references', () => {
    const dataset = DatasetSchema.parse(raw)
    const known = new Set(dataset.codes.map((c) => c.code))
    for (const code of dataset.codes) {
      for (const rel of code.relationships) {
        expect(known.has(rel.to), `${code.code} -> ${rel.to}`).toBe(true)
      }
    }
  })
})

describe('the dataset schema', () => {
  it('rejects a demo dataset that carries official descriptor text', () => {
    const contaminated = {
      key: 'demo-bad',
      name: 'Bad demo',
      kind: 'DEMO',
      codes: [
        {
          code: 'D1234',
          category: 'RESTORATIVE',
          shortLabel: 'Something',
          plainLanguage: 'Our own words about this procedure.',
          officialDescriptor: 'Licensed descriptor text that must not be here.',
          attributes: { procedure_kind: 'crown' },
        },
      ],
    }

    const parsed = DatasetSchema.safeParse(contaminated)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/LICENSED dataset/i)
    }
  })

  it('accepts official descriptor text in a licensed dataset', () => {
    const licensed = {
      key: 'cdt-licensed',
      name: 'Licensed dataset',
      kind: 'LICENSED',
      codes: [
        {
          code: 'D1234',
          category: 'RESTORATIVE',
          shortLabel: 'Something',
          plainLanguage: 'Our own words about this procedure.',
          officialDescriptor: 'Licensed descriptor text.',
          officialDescriptorSource: 'Licensed distribution',
          attributes: { procedure_kind: 'crown' },
        },
      ],
    }

    expect(DatasetSchema.safeParse(licensed).success).toBe(true)
  })

  it('rejects a malformed code number', () => {
    const bad = {
      key: 'x',
      name: 'x',
      codes: [
        {
          code: 'NOTACODE',
          category: 'RESTORATIVE',
          shortLabel: 'Something',
          plainLanguage: 'Our own words about this procedure.',
        },
      ],
    }
    expect(DatasetSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects duplicate codes', () => {
    const entry = {
      code: 'D1234',
      category: 'RESTORATIVE',
      shortLabel: 'Something',
      plainLanguage: 'Our own words about this procedure.',
    }
    const dup = { key: 'x', name: 'x', codes: [entry, entry] }
    expect(DatasetSchema.safeParse(dup).success).toBe(false)
  })
})

describe('the repository', () => {
  const repository = MemoryCodeRepository.demo()

  it('reports the active dataset as demo data', async () => {
    const info = await repository.info()
    expect(info.kind).toBe('DEMO')
    expect(info.hasOfficialDescriptors).toBe(false)
    expect(info.codeCount).toBeGreaterThan(50)
  })

  it('retrieves by procedure kind', async () => {
    const codes = await repository.findByProcedureKind('composite_restoration')
    expect(codes.map((c) => c.code).sort()).toEqual([
      'D2330', 'D2331', 'D2332', 'D2335', 'D2391', 'D2392', 'D2393', 'D2394',
    ])
  })

  it('returns nothing for an unknown procedure kind rather than guessing', async () => {
    expect(await repository.findByProcedureKind('teleportation')).toEqual([])
  })
})
