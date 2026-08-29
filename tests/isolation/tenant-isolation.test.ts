import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { TENANT_SCOPED_MODELS, withTenant, unsafeCrossTenantClient } from '@/lib/db/client'
import { ownerClient, resetDatabase, seedOrg, type SeededOrg } from '../fixtures'

/**
 * Tenant isolation is an invariant, not a feature — so it gets a standing test
 * that enumerates every scoped model rather than a handful of spot checks.
 * A model added to schema.prisma is covered here automatically.
 */
const db = ownerClient()
let alpha: SeededOrg
let beta: SeededOrg

beforeAll(async () => {
  await resetDatabase(db)
  alpha = await seedOrg(db, { name: 'Alpha Rheumatology', slug: 'alpha', email: 'a@alpha.test' })
  beta = await seedOrg(db, { name: 'Beta Rheumatology', slug: 'beta', email: 'b@beta.test' })
})

afterAll(async () => {
  await db.$disconnect()
  await unsafeCrossTenantClient().$disconnect()
})

describe('the scoped-model set', () => {
  it('covers every model carrying an organizationId', () => {
    expect(TENANT_SCOPED_MODELS.size).toBeGreaterThan(15)
    for (const model of ['Referral', 'Patient', 'Document', 'AuditLog', 'ContactAttempt']) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(true)
    }
  })

  it('excludes User, which is global by design', () => {
    expect(TENANT_SCOPED_MODELS.has('User')).toBe(false)
  })
})

describe('reads', () => {
  it('every scoped model returns only the bound tenant’s rows', async () => {
    const leaks: string[] = []
    await withTenant(alpha.organizationId, async (tx) => {
      for (const model of TENANT_SCOPED_MODELS) {
        const delegate = (tx as unknown as Record<string, { findMany?: (a: unknown) => Promise<unknown[]> }>)[
          model.charAt(0).toLowerCase() + model.slice(1)
        ]
        if (!delegate?.findMany) continue
        const rows = (await delegate.findMany({})) as Array<{ organizationId?: string }>
        for (const row of rows) {
          if (row.organizationId && row.organizationId !== alpha.organizationId) {
            leaks.push(`${model}:${row.organizationId}`)
          }
        }
      }
    })
    expect(leaks).toEqual([])
  })

  it('cannot fetch another tenant’s referral by its id', async () => {
    const found = await withTenant(alpha.organizationId, (tx) =>
      tx.referral.findUnique({ where: { id: beta.referralId } }),
    )
    expect(found).toBeNull()
  })

  it('cannot count another tenant’s patients', async () => {
    const count = await withTenant(alpha.organizationId, (tx) =>
      tx.patient.count({ where: { id: beta.patientId } }),
    )
    expect(count).toBe(0)
  })

  it('cannot reach another tenant through a relation filter', async () => {
    const rows = await withTenant(alpha.organizationId, (tx) =>
      tx.referral.findMany({ where: { patient: { lastName: 'beta' } } }),
    )
    expect(rows).toHaveLength(0)
  })
})

describe('writes', () => {
  it('rejects a create that names another tenant', async () => {
    await expect(
      withTenant(alpha.organizationId, (tx) =>
        tx.patient.create({
          data: {
            organizationId: beta.organizationId,
            firstName: 'Mallory',
            lastName: 'Injected',
            dateOfBirth: new Date('1990-01-01T00:00:00Z'),
          },
        }),
      ),
    ).rejects.toThrow(/different organization/i)
  })

  it('cannot update another tenant’s referral', async () => {
    const result = await withTenant(alpha.organizationId, (tx) =>
      tx.referral.updateMany({
        where: { id: beta.referralId },
        data: { notes: 'tampered' },
      }),
    )
    expect(result.count).toBe(0)

    const untouched = await db.referral.findUnique({ where: { id: beta.referralId } })
    expect(untouched?.notes).toBeNull()
  })

  it('cannot delete another tenant’s patient', async () => {
    const result = await withTenant(alpha.organizationId, (tx) =>
      tx.patient.deleteMany({ where: { id: beta.patientId } }),
    )
    expect(result.count).toBe(0)
    expect(await db.patient.findUnique({ where: { id: beta.patientId } })).not.toBeNull()
  })
})

describe('the database backstop', () => {
  it('refuses raw SQL that reaches across tenants, even if the ORM layer were bypassed', async () => {
    const rows = await withTenant(alpha.organizationId, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM referrals WHERE id = ${beta.referralId}::uuid`,
    )
    expect(rows).toHaveLength(0)
  })

  it('returns nothing at all when no tenant is bound', async () => {
    const rows = await unsafeCrossTenantClient().$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM patients
    `
    expect(Number(rows[0]!.count)).toBe(0)
  })

  it('throws rather than silently returning nothing when the extension is unbound', async () => {
    await expect(unsafeCrossTenantClient().patient.findMany({})).rejects.toThrow(
      /outside a tenant context/i,
    )
  })
})
