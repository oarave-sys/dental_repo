import next from 'eslint-config-next'

/**
 * Architecture layering is enforced here rather than left to convention.
 *
 * Two boundaries matter in this codebase, and both are the kind that erode
 * quietly if nothing checks them:
 *
 *   1. Database access is confined to the data layer. Everything else goes
 *      through a repository or a service, so the tenant-scoping extension in
 *      src/lib/db/client.ts cannot be bypassed by a stray import.
 *
 *   2. The coding engine stays pure. src/lib/coding holds the reasoning that
 *      decides which code to recommend; it must not reach the database or the
 *      framework directly, which is what lets the whole engine be tested with
 *      no infrastructure at all.
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'src/generated/**'] },
  ...next,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Both the package and the generated client. Guarding only one
              // leaves the rule looking enforced while it is not.
              group: ['@prisma/client', '@/generated/prisma', '@/generated/prisma/*'],
              message:
                'Prisma may only be imported from the data layer (src/lib/db, src/lib/codes, ' +
                'src/lib/admin, src/lib/auth, src/lib/usage, src/lib/billing). Everything else ' +
                'goes through a repository or service.',
            },
          ],
        },
      ],
    },
  },
  {
    // The layers allowed to touch the database directly.
    files: [
      'src/lib/db/**/*.ts',
      'src/lib/codes/**/*.ts',
      'src/lib/admin/**/*.ts',
      'src/lib/auth/**/*.ts',
      'src/lib/usage/**/*.ts',
      'src/lib/billing/**/*.ts',
      'prisma/**/*.ts',
      'scripts/**/*.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    /**
     * The coding engine: fixture in, result out.
     *
     * queries.ts is the deliberate exception — it is the persistence seam for
     * engine output and is excluded from this group below.
     */
    files: ['src/lib/coding/**/*.ts'],
    ignores: ['src/lib/coding/queries.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@prisma/client',
                '@/generated/prisma',
                '@/generated/prisma/*',
                '@/lib/db',
                '@/lib/db/*',
                'next',
                'next/*',
              ],
              message:
                'The coding engine must stay pure so it can be tested without infrastructure. ' +
                'Retrieve through the CodeRepository interface; persist in src/lib/coding/queries.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/coding/queries.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Tests exercise every layer by design.
    files: ['tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]

export default config
