import 'dotenv/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { DatasetSchema, normaliseAttributes } from '../src/lib/codes/dataset-schema'

/**
 * Imports a procedure-code dataset.
 *
 * THIS IS WHERE LICENSED CDT DATA PLUGS IN.
 *
 * To move from the demo sample to licensed production data:
 *
 *   1. Obtain a CDT license from the American Dental Association.
 *   2. Convert the licensed distribution into the dataset format described in
 *      src/lib/codes/dataset-schema.ts, putting the official descriptor for
 *      each code in `officialDescriptor` and setting `kind` to "LICENSED".
 *      Keep our own `plainLanguage` / `commonUse` / `distinctions` text — it is
 *      ours, and it is what users actually read.
 *   3. Place the file outside version control (data/licensed/ is gitignored).
 *   4. Run:  npm run codes:import -- data/licensed/cdt-2026.json --activate
 *
 * Nothing else in the application changes. The engine retrieves from whichever
 * dataset is active, and the UI shows the official descriptor only when one is
 * present.
 *
 * A dataset marked DEMO that carries official descriptor text is rejected by
 * the schema before any row is written.
 */

const DEMO_PATH = path.join('data', 'demo-dataset', 'general-dentistry.json')

async function main() {
  const args = process.argv.slice(2)
  const activate = args.includes('--activate')
  const file = args.find((a) => !a.startsWith('--')) ?? DEMO_PATH

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL (or DIRECT_DATABASE_URL) must be set to import codes.')
    process.exit(1)
  }

  const parsed = DatasetSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) {
    console.error(`${file} is not a valid dataset:\n`)
    for (const issue of parsed.error.issues) {
      console.error(`  · ${issue.path.join('.')}: ${issue.message}`)
    }
    process.exit(1)
  }
  const dataset = parsed.data

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  console.log(`Importing "${dataset.name}" (${dataset.kind}) — ${dataset.codes.length} codes`)
  if (dataset.kind === 'DEMO') {
    console.log('  NOTE: this is sample data and is labelled as such throughout the UI.')
  }

  try {
    await db.$transaction(
      async (tx) => {
        // Replace the dataset wholesale. Cascades clear codes, attributes,
        // relationships and code-scoped rules, so a re-import is idempotent
        // and never leaves half of a previous version behind.
        await tx.codeDataset.deleteMany({ where: { key: dataset.key } })

        const created = await tx.codeDataset.create({
          data: {
            key: dataset.key,
            name: dataset.name,
            kind: dataset.kind,
            sourceNote: dataset.sourceNote ?? null,
            isActive: false,
          },
        })

        const idByCode = new Map<string, string>()
        for (const code of dataset.codes) {
          const row = await tx.procedureCode.create({
            data: {
              datasetId: created.id,
              code: code.code,
              category: code.category,
              subcategory: code.subcategory ?? null,
              shortLabel: code.shortLabel,
              plainLanguage: code.plainLanguage,
              commonUse: code.commonUse ?? null,
              distinctions: code.distinctions ?? null,
              documentationConsiderations: code.documentationConsiderations,
              verifyQuestions: code.verifyQuestions,
              officialDescriptor: code.officialDescriptor ?? null,
              officialDescriptorSource: code.officialDescriptorSource ?? null,
              status: code.status,
            },
          })
          idByCode.set(code.code, row.id)

          const attributes = normaliseAttributes(code.attributes)
          if (attributes.length > 0) {
            await tx.procedureCodeAttribute.createMany({
              data: attributes.map((a) => ({ codeId: row.id, key: a.key, value: a.value })),
              skipDuplicates: true,
            })
          }
        }

        for (const code of dataset.codes) {
          const fromId = idByCode.get(code.code)
          if (!fromId) continue
          for (const rel of code.relationships) {
            const toId = idByCode.get(rel.to)
            if (!toId) continue
            await tx.procedureCodeRelationship.create({
              data: { fromCodeId: fromId, toCodeId: toId, type: rel.type, note: rel.note ?? null },
            })
          }
        }

        // Category rules are global; code rules belong to this dataset's codes.
        await tx.documentationRule.deleteMany({ where: { scope: 'CATEGORY' } })
        for (const rule of dataset.documentationRules) {
          await tx.documentationRule.create({
            data: {
              scope: rule.scope,
              category: rule.scope === 'CATEGORY' ? rule.category : null,
              codeId: rule.scope === 'CODE' ? (idByCode.get(rule.code ?? '') ?? null) : null,
              factKey: rule.factKey,
              label: rule.label,
              kind: rule.kind,
              weight: rule.weight,
              promptQuestion: rule.promptQuestion,
            },
          })
        }

        if (activate) {
          await tx.codeDataset.updateMany({ where: {}, data: { isActive: false } })
          await tx.codeDataset.update({ where: { id: created.id }, data: { isActive: true } })
        }
      },
      { timeout: 120_000 },
    )

    const active = await db.codeDataset.findFirst({ where: { isActive: true } })
    console.log(`Imported ${dataset.codes.length} codes and ${dataset.documentationRules.length} rules.`)
    console.log(
      active
        ? `Active dataset: ${active.name} (${active.kind})`
        : 'No dataset is active. Re-run with --activate to make this one live.',
    )
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
