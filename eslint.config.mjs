import next from 'eslint-config-next'


/**
 * Architecture layering is enforced here, not by convention.
 * See docs/ARCHITECTURE.md §1.3.
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
                'Prisma may only be imported from src/lib/db and src/lib/repositories. ' +
                'Everything else goes through a repository. See docs/ARCHITECTURE.md §1.3.',
            },
          ],
        },
      ],
    },
  },
  {
    // The layers allowed to touch the database directly. lib/audit and
    // lib/auth are included because they hold the append-only writer and the
    // authentication bootstrap, both of which need the generated enum types.
    files: [
      'src/lib/db/**/*.ts',
      'src/lib/repositories/**/*.ts',
      'src/lib/audit/**/*.ts',
      'src/lib/auth/**/*.ts',
      'prisma/**/*.ts',
      'scripts/**/*.ts',
    ],
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

export default config
