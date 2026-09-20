import 'dotenv/config'

/**
 * Loads .env so the integration tests can find a database when one is
 * configured. The unit suite does not need it and runs either way — tests
 * under tests/integration skip themselves when DATABASE_URL is absent.
 */
if (!process.env.SESSION_SECRET) {
  // Long enough to satisfy the token HMAC. Test-only, never a real secret.
  process.env.SESSION_SECRET = 'test-session-secret-not-used-in-production-000'
}
