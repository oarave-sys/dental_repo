import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

/**
 * Migrations run as `referral_owner` (DDL rights). The application itself
 * connects as `referral_app`, which is NOT a superuser and does NOT have
 * BYPASSRLS — that is what makes row-level security a real backstop.
 * See docs/SECURITY.md §1, Layer 3.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
