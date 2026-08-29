import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@/generated/prisma/client'
import { AppError } from '@/lib/errors'

/**
 * Layer 2 of tenant isolation (docs/SECURITY.md §1).
 *
 * Reads and mutations get `organizationId` injected into `where` — TypeScript
 * does not require it there, so forgetting is possible and injection is the
 * protection. Writes must name it explicitly (Prisma's own types insist), and
 * the extension verifies it matches the bound tenant.
 *
 * Supplying a *different* organizationId is rejected rather than silently
 * overridden: that combination means a bug worth surfacing, not a value to
 * quietly correct.
 *
 * The set of scoped models is derived from the schema at runtime, so adding a
 * model to schema.prisma covers it automatically. tests/isolation asserts the
 * derived set matches the tables carrying an RLS policy.
 */

/** Models carrying an organizationId column, straight from the schema. */
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'organizationId'))
    .map((m) => m.name),
)

interface TenantContext {
  organizationId: string
}

const tenantContext = new AsyncLocalStorage<TenantContext>()

export function currentTenant(): string | null {
  return tenantContext.getStore()?.organizationId ?? null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const READ_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy',
])
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

function buildClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter }).$extends({
    name: 'tenantIsolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED_MODELS.has(model)) return query(args)

          const organizationId = currentTenant()
          if (!organizationId) {
            // Fails closed. The database would refuse anyway (RLS), but an
            // error here names the actual bug instead of an empty result set.
            throw new AppError(
              'INTERNAL',
              'Database access attempted outside a tenant context.',
              { model, operation },
            )
          }

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

export type Db = ReturnType<typeof buildClient>
export type TenantDb = Omit<Db, '$transaction' | '$connect' | '$disconnect' | '$extends'>

const globalForDb = globalThis as unknown as { __db?: Db }

function baseClient(): Db {
  if (!globalForDb.__db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new AppError('INTERNAL', 'DATABASE_URL is not configured.')
    globalForDb.__db = buildClient(url)
  }
  return globalForDb.__db
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
  return baseClient().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`
      // The inner callback must be async and must AWAIT `fn`. Prisma promises
      // are lazy — a callback that merely returns one lets `run()` exit and pop
      // the context before the query has started, and the operation then sees
      // no tenant. Awaiting here keeps execution inside the context.
      return tenantContext.run({ organizationId }, async () => fn(tx as unknown as TenantDb))
    },
    { timeout: options.timeoutMs ?? 15_000, maxWait: 5_000 },
  )
}

/**
 * Unscoped access. Deliberately ugly to type and easy to grep.
 *
 * Legitimate callers: the seeder, migrations, the reference-data importer, the
 * authentication bootstrap (which must resolve a session token *before* any
 * organization is known), and platform administration. Nothing else.
 */
export function unsafeCrossTenantClient(): Db {
  return baseClient()
}
