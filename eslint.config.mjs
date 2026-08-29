import next from 'eslint-config-next'

/**
 * Architecture layering is enforced here, not by convention.
 * See docs/ARCHITECTURE.md §1.3.
 */
export default [
  { ignores: ['.next/**', 'node_modules/**', 'src/generated/**'] },
  ...next(),
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message:
                'Prisma may only be imported from src/lib/db and src/lib/repositories. ' +
                'Everything else goes through a repository. See docs/ARCHITECTURE.md §1.3.',
            },
          ],
        },
      ],
    },
  },
  {
    // The two layers that are allowed to touch the database directly.
    files: ['src/lib/db/**/*.ts', 'src/lib/repositories/**/*.ts', 'prisma/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Pure domain modules: no I/O, no framework, no database, no clock.
    files: ['src/lib/rules/**/*.ts', 'src/lib/confidence/**/*.ts', 'src/lib/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '@/lib/db*', '@/lib/repositories*', 'next/*', 'next'],
              message:
                'Domain modules must stay pure — fixture in, object out. See docs/ARCHITECTURE.md §1.3.',
            },
          ],
        },
      ],
    },
  },
]
