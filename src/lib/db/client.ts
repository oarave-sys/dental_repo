import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@/generated/prisma/client'
import { AppError } from '@/lib/errors'

/**
 * Layer 2 of tenant isolation (docs/SECURITY.md §1).
 *
 * Every Prisma operation on a tenant-scoped model has `organizationId` injected
 * into `where` on reads and mutations. Writes must name it explicitly (Prisma's
 * own types insist), and the extension verifies it matches the bound tenant —
 * supplying a different one is rejected rather than silently overridden,
 * because that combination means a bug worth surfacing.
 *
 * The tenant is captured in a CLOSURE over the extended client, not in
 * ambient async context. That is deliberate and was arrived at the hard way:
 * Prisma promises are lazy, so with AsyncLocalStorage a call site that returns
 * a query without awaiting it inside the context would execute after the
 * context had been popped, and silently see no tenant. A closure cannot drift.
 *
 * The set of scoped models is derived from the schema at runtime, so adding a
 * model to schema.prisma covers it automatically.
 */

/** Models carrying an organizationId column, straight from the schema. */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'organizationId'))
    .map((m) => m.name),
)

/**
 * Identity models the application must read *in order to* work out which
 * organization a request belongs to — a session token is looked up before any
 * tenant is known. They are reachable through `unsafeCrossTenantClient` and are
 * governed by the BOOTSTRAP row-level-security tier, which mirrors this list.
 * They hold PII, not PHI, and are reached only by a secret token lookup.
 */
export const BOOTSTRAP_MODELS: ReadonlySet<string> = new Set([
  'Organization',
  'OrganizationSettings',
  'Session',
  'Membership',
  'Role',
  'MembershipRole',
  'Invitation',
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const READ_OPS = [
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy',
]
const WHERE_OPS = new Set([...READ_OPS, 'update', 'updateMany', 'delete', 'deleteMany'])
const DATA_OPS = new Set(['create', 'createMany', 'createManyAndReturn'])

function mergeWhere(args: Record<string, unknown>, organizationId: string) {
  const existing = (args.where ?? {}) as Record<string, unknown>
  const supplied = existing.organizationId
  if (typeof supplied === 'string' && supplied !== organizationId) {
    throw new AppError('TENANT_MISMATCH', 'That record belongs to a different organization.')
  }
  return { ...args, where: { ...existing, organizationId } }
}

function stampData(data: unknown, organizationId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampData(d, organizationId))
  const row = (data ?? {}) as Record<string, unknown>
  const supplied = row.organizationId
  if (typeof supplied === 'string' && supplied !== organizationId) {
    throw new AppError('TENANT_MISMATCH', 'That record belongs to a different organization.')
  }
  return { ...row, organizationId }
}

function tenantExtension(organizationId: string) {
  return Prisma.defineExtension({
    name: 'tenantIsolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) return query(args)

          let next = args as Record<string, unknown>
          if (WHERE_OPS.has(operation)) next = mergeWhere(next, organizationId)
          if (DATA_OPS.has(operation) && 'data' in next) {
            next = { ...next, data: stampData(next.data, organizationId) }
          }
          if (operation === 'upsert') {
            next = mergeWhere(next, organizationId)
            next = { ...next, create: stampData(next.create, organizationId) }
          }
          return query(next)
        },
      },
    },
  })
}

const globalForDb = globalThis as unknown as { __rawDb?: PrismaClient }

function rawClient(): PrismaClient {
  if (!globalForDb.__rawDb) {
    const url = process.env.DATABASE_URL
    if (!url) throw new AppError('INTERNAL', 'DATABASE_URL is not configured.')
    globalForDb.__rawDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  }
  return globalForDb.__rawDb
}

export type TenantDb = Omit<
  ReturnType<typeof buildTenantClient>,
  '$transaction' | '$connect' | '$disconnect' | '$extends' | '$on'
>

function buildTenantClient(organizationId: string) {
  return rawClient().$extends(tenantExtension(organizationId))
}

/**
 * Runs `fn` with the tenant bound at BOTH layers: the Prisma extension above,
 * and PostgreSQL's `app.current_org_id` for the row-level-security policies.
 *
 * The transaction is what scopes `set_config(..., true)` — that is why every
 * request pays for one. See docs/ARCHITECTURE.md R-2 for the trade-off.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (db: TenantDb) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  if (!UUID.test(organizationId)) {
    throw new AppError('INTERNAL', 'Invalid organization identifier.')
  }
  return buildTenantClient(organizationId).$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`
      return fn(tx as unknown as TenantDb)
    },
    { timeout: options.timeoutMs ?? 15_000, maxWait: 5_000 },
  )
}

/**
 * Unscoped access. Deliberately ugly to type and easy to grep.
 *
 * Legitimate callers: the authentication bootstrap (which must resolve a
 * session token *before* any organization is known), the seeder, migrations,
 * the reference-data importer, and platform administration. Nothing else.
 *
 * This is NOT a way around isolation. The connection is still the application
 * role, `app.current_org_id` is unset, and every STRICT row-level-security
 * policy therefore yields zero rows — only the BOOTSTRAP identity tables are
 * readable through it. A test asserts exactly that.
 */
export function unsafeCrossTenantClient(): PrismaClient {
  return rawClient()
}
