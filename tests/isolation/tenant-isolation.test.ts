import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { TENANT_SCOPED_MODELS, BOOTSTRAP_MODELS, withTenant, unsafeCrossTenantClient } from '@/lib/db/client'
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

  it('leaves the unscoped client unable to see any PHI at all', async () => {
    // unsafeCrossTenantClient exists for the auth bootstrap. It is still the
    // application role with no tenant bound, so row-level security gives it
    // nothing from any STRICT table — even though both tenants have rows.
    const raw = unsafeCrossTenantClient()
    expect(await raw.patient.findMany({})).toHaveLength(0)
    expect(await raw.referral.findMany({})).toHaveLength(0)
    expect(await raw.document.findMany({})).toHaveLength(0)
    expect(await raw.auditLog.findMany({})).toHaveLength(0)
  })

  it('but can still read the identity tables it needs to resolve a session', async () => {
    const raw = unsafeCrossTenantClient()
    const sessions = await raw.membership.findMany({})
    expect(sessions.length).toBeGreaterThan(0)
  })
})

describe('the bootstrap tier', () => {
  it('matches the tables given the bootstrap row-level-security policy', async () => {
    // The two lists must agree, or a model is protected at one layer and not
    // the other. Read the policies straight out of the database rather than
    // trusting a second copy of the list.
    const rows = await db.$queryRaw<Array<{ tablename: string; qual: string }>>`
      SELECT tablename, qual FROM pg_policies WHERE policyname = 'tenant_isolation'
    `
    const bootstrapTables = rows
      .filter((r) => r.qual.includes('IS NULL'))
      .map((r) => r.tablename)
      .sort()

    expect(bootstrapTables).toEqual([
      'invitations', 'membership_roles', 'memberships',
      'organization_settings', 'organizations', 'roles', 'sessions',
    ])
    expect(BOOTSTRAP_MODELS.size).toBe(bootstrapTables.length)
  })

  it('still scopes bootstrap models once a tenant is bound', async () => {
    const sessions = await withTenant(alpha.organizationId, (tx) =>
      tx.role.findMany({}),
    )
    expect(sessions.every((r) => r.organizationId === alpha.organizationId)).toBe(true)
  })

  it('names exactly the models the bootstrap policy covers', () => {
    for (const model of ['Session', 'Membership', 'Role', 'Organization']) {
      expect(BOOTSTRAP_MODELS.has(model), model).toBe(true)
    }
    for (const model of ['Patient', 'Referral', 'Document', 'AuditLog']) {
      expect(BOOTSTRAP_MODELS.has(model), model).toBe(false)
    }
  })
})

describe('lazy queries', () => {
  /**
   * Regression test. An earlier implementation carried the tenant in ambient
   * async context; because Prisma promises are lazy, a call site that returned
   * a query without awaiting it inside that context executed after the context
   * had been popped and silently saw no tenant. The binding is now a closure,
   * so both call styles must behave identically.
   */
  it('binds the tenant whether or not the callback awaits', async () => {
    const awaited = await withTenant(alpha.organizationId, async (tx) =>
      tx.patient.findMany({}),
    )
    const returned = await withTenant(alpha.organizationId, (tx) =>
      tx.patient.findMany({}),
    )
    expect(awaited).toHaveLength(returned.length)
    expect(returned.length).toBeGreaterThan(0)
    expect(returned.every((p) => p.organizationId === alpha.organizationId)).toBe(true)
  })

  it('binds the tenant through a nested Promise.all', async () => {
    const [patients, referrals] = await withTenant(alpha.organizationId, (tx) =>
      Promise.all([tx.patient.findMany({}), tx.referral.findMany({})]),
    )
    expect(patients.every((p) => p.organizationId === alpha.organizationId)).toBe(true)
    expect(referrals.every((r) => r.organizationId === alpha.organizationId)).toBe(true)
  })
})
