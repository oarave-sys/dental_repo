import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

/**
 * Migrations run with DDL rights (DIRECT_DATABASE_URL). The application itself
 * connects as a role that is NOT a superuser and does NOT have BYPASSRLS —
 * that is what makes row-level security a real backstop rather than decoration.
 * See docs/SECURITY.md.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: {
    // Same fallback order as src/lib/db/env.ts, inlined because this file runs
    // before the application is built.
    url:
      process.env.DIRECT_DATABASE_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL ||
      '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
