import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests for the coding engine run with no database and no API key.
    // Tests that need Postgres live in tests/integration and skip themselves
    // when DATABASE_URL is absent.
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
