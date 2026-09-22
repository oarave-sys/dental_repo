import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { unsafeCrossTenantClient, withTenant } from '@/lib/db/client'
import { databaseUrl } from '@/lib/db/env'

/**
 * Tenant isolation, exercised against a real PostgreSQL instance.
 *
 * These tests skip when DATABASE_URL is absent so the unit suite stays
 * runnable with no infrastructure. When a database IS configured they are the
 * ones that matter most, because tenant isolation is the failure nobody
 * notices until it is far too late.
 *
 * The application role must not be a superuser and must not hold BYPASSRLS,
 * or these tests will pass while proving nothing — so that is asserted first.
 */

const configured = Boolean(databaseUrl())
const describeIf = configured ? describe : describe.skip

describeIf('row-level security', () => {
  // Resolved in beforeAll rather than at collection time: a skipped suite is
  // still collected, and building a client would throw without a database.
  let db: ReturnType<typeof unsafeCrossTenantClient>
  let orgA = ''
  let orgB = ''

  beforeAll(async () => {
    db = unsafeCrossTenantClient()
    const a = await db.organization.create({
      data: { name: 'Test Practice A', slug: `test-a-${randomUUID().slice(0, 8)}` },
    })
    const b = await db.organization.create({
      data: { name: 'Test Practice B', slug: `test-b-${randomUUID().slice(0, 8)}` },
    })
    orgA = a.id
    orgB = b.id

    const user = await db.user.create({
      data: {
        email: `iso-${randomUUID().slice(0, 8)}@example.test`,
        name: 'Isolation Tester',
        passwordHash: 'x',
      },
    })
    await db.membership.create({ data: { userId: user.id, organizationId: orgA, role: 'OWNER' } })
    await db.membership.create({ data: { userId: user.id, organizationId: orgB, role: 'OWNER' } })

    for (const [org, label] of [
      [orgA, 'A'],
      [orgB, 'B'],
    ] as const) {
      await withTenant(org, async (tx) => {
        await tx.codingQuery.create({
          data: {
            organizationId: org,
            userId: user.id,
            tool: 'FIND_CODE',
            displayLabel: `query for ${label}`,
            inputText: `clinical text belonging to practice ${label}`,
          },
        })
      })
    }
  })

  afterAll(async () => {
    if (orgA) await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  })

  it('runs as a role that row-level security actually applies to', async () => {
    const rows = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `
    expect(rows[0]?.rolsuper, 'application role must not be a superuser').toBe(false)
    expect(rows[0]?.rolbypassrls, 'application role must not have BYPASSRLS').toBe(false)
  })

  it('shows a tenant only its own rows', async () => {
    const fromA = await withTenant(orgA, (tx) => tx.codingQuery.findMany())
    const fromB = await withTenant(orgB, (tx) => tx.codingQuery.findMany())

    expect(fromA).toHaveLength(1)
    expect(fromB).toHaveLength(1)
    expect(fromA[0]?.displayLabel).toBe('query for A')
    expect(fromB[0]?.displayLabel).toBe('query for B')
  })

  it('refuses a read of another tenant by explicit id', async () => {
    const target = await withTenant(orgB, (tx) => tx.codingQuery.findFirst())
    expect(target).not.toBeNull()

    // Asking tenant A for a row that belongs to tenant B returns nothing —
    // the extension rewrites the filter and the policy backs it up.
    const leaked = await withTenant(orgA, (tx) =>
      tx.codingQuery.findUnique({ where: { id: target!.id } }),
    )
    expect(leaked).toBeNull()
  })

  it('rejects a write stamped with a different tenant', async () => {
    await expect(
      withTenant(orgA, async (tx) => {
        await tx.codingQuery.create({
          data: {
            organizationId: orgB,
            userId: (await tx.codingQuery.findFirstOrThrow()).userId,
            tool: 'FIND_CODE',
          },
        })
      }),
    ).rejects.toThrow(/different organization/i)
  })

  /**
   * Regression test for a bug found by running the application rather than
   * the tests: set_config(..., true) is transaction-local, and Postgres
   * resets the GUC to an EMPTY STRING when that transaction ends rather than
   * leaving it unset. A policy comparing against a bare
   * current_setting(...)::uuid then raised "invalid input syntax for type
   * uuid" on the next unscoped query to reuse that pooled connection, which
   * took out the admin area entirely. The policy uses NULLIF so the
   * comparison yields NULL and simply matches nothing.
   */
  it('returns no rows, rather than erroring, on a connection reused after a tenant transaction', async () => {
    await withTenant(orgA, (tx) => tx.codingQuery.findMany())

    // Same pooled connection, now with no tenant bound.
    await expect(db.codingQuery.count()).resolves.toBe(0)
    await expect(db.subscription.count()).resolves.toBe(0)
    await expect(db.savedCase.findMany()).resolves.toEqual([])
  })

  /**
   * The audit log must be append-only in the DATABASE, not merely in the
   * application. If the app can rewrite its own audit trail, the trail is
   * worth nothing during the incident it exists for.
   */
  it('accepts an audit entry and then refuses to change or remove it', async () => {
    const created = await withTenant(orgA, async (tx) =>
      tx.auditEvent.create({
        data: {
          organizationId: orgA,
          action: 'CLINICAL_CONTENT_VIEWED',
          subjectType: 'CodingQuery',
          subjectId: 'test-subject',
        },
      }),
    )
    expect(created.id).toBeTruthy()

    // No UPDATE policy exists, so the row is invisible to an update and the
    // statement affects nothing.
    const updated = await withTenant(orgA, (tx) =>
      tx.auditEvent.updateMany({
        where: { id: created.id },
        data: { action: 'SIGNED_OUT' },
      }),
    )
    expect(updated.count).toBe(0)

    const deleted = await withTenant(orgA, (tx) =>
      tx.auditEvent.deleteMany({ where: { id: created.id } }),
    )
    expect(deleted.count).toBe(0)

    // The original survives both attempts, unchanged.
    const survivor = await withTenant(orgA, (tx) =>
      tx.auditEvent.findFirst({ where: { id: created.id } }),
    )
    expect(survivor?.action).toBe('CLINICAL_CONTENT_VIEWED')
  })

  it('keeps one practice out of another practice\'s audit log', async () => {
    await withTenant(orgB, async (tx) => {
      await tx.auditEvent.create({
        data: { organizationId: orgB, action: 'SIGNED_IN', subjectType: 'Session' },
      })
    })

    const fromA = await withTenant(orgA, (tx) =>
      tx.auditEvent.findMany({ where: { action: 'SIGNED_IN' } }),
    )
    expect(fromA).toHaveLength(0)
  })

  it('keeps reference data readable with no tenant bound', async () => {
    // Procedure codes are global: the admin area and the importer both need
    // them without an organization in scope.
    await expect(db.procedureCode.count()).resolves.toBeGreaterThan(0)
  })
})
