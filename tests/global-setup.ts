import 'dotenv/config'
import { execSync } from 'node:child_process'

/**
 * Integration tests run against a real PostgreSQL, connecting as the same
 * non-superuser role the application uses. Testing isolation against a
 * privileged connection would prove nothing.
 */
export default async function setup() {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  process.env.DIRECT_DATABASE_URL = process.env.TEST_DIRECT_DATABASE_URL
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env },
  })
}
