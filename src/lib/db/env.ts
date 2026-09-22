/**
 * Database connection strings, with fallbacks for the names hosting providers
 * actually set.
 *
 * Adding a database from the Vercel marketplace populates variables under the
 * provider's own names — Neon sets DATABASE_URL and DATABASE_URL_UNPOOLED,
 * Supabase sets POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING — and a
 * first-time deployer should not have to know the difference. Whichever one
 * exists is used; the app's own names win when set.
 */

/** Pooled connection, for the application at runtime. */
export function databaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    undefined
  )
}

/** Direct connection, for migrations and the code importer. */
export function directDatabaseUrl(): string | undefined {
  return (
    process.env.DIRECT_DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL_UNPOOLED ||
    databaseUrl()
  )
}
