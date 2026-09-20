import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hashPassword } from '../src/lib/auth/password'

/**
 * Development seed.
 *
 * Creates two practices so tenant isolation is visible in the running app
 * rather than only in the tests, imports the demo code dataset, and makes the
 * first account a platform admin so /admin can be opened.
 *
 * Every detail here is fabricated. No real practice, person or patient.
 */

const PASSWORD = 'correct-horse-battery-staple'

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL must be set to seed.')

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  try {
    console.log('Importing the demo code dataset…')
    execFileSync(
      'npx',
      ['tsx', 'scripts/import-codes.ts', 'data/demo-dataset/general-dentistry.json', '--activate'],
      { stdio: 'inherit' },
    )

    const passwordHash = await hashPassword(PASSWORD)

    const practices = [
      {
        name: 'Riverside Family Dental',
        slug: 'riverside-family-dental',
        people: [
          { email: 'owner@riverside.example', name: 'Dana Whitfield', role: 'OWNER' as const, admin: true },
          { email: 'office@riverside.example', name: 'Priya Raman', role: 'ADMIN' as const, admin: false },
          { email: 'front@riverside.example', name: 'Marcus Bell', role: 'MEMBER' as const, admin: false },
        ],
      },
      {
        // A second tenant exists so cross-tenant isolation can be checked by hand.
        name: 'Oakline Dental Care',
        slug: 'oakline-dental-care',
        people: [
          { email: 'owner@oakline.example', name: 'Sofia Alvarez', role: 'OWNER' as const, admin: false },
        ],
      },
    ]

    for (const practice of practices) {
      const organization = await db.organization.upsert({
        where: { slug: practice.slug },
        update: {},
        create: { name: practice.name, slug: practice.slug },
      })

      // Tenant-scoped tables are behind row-level security, so the seed has to
      // bind the tenant exactly as the application does. Writing this out here
      // rather than disabling RLS for the seed keeps the seeded database an
      // honest copy of production behaviour.
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.current_org_id', ${organization.id}, true)`
        await tx.subscription.upsert({
          where: { organizationId: organization.id },
          update: {},
          create: {
            organizationId: organization.id,
            status: 'TRIALING',
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        })
      })

      for (const person of practice.people) {
        const user = await db.user.upsert({
          where: { email: person.email },
          update: { isPlatformAdmin: person.admin },
          create: {
            email: person.email,
            name: person.name,
            passwordHash,
            isPlatformAdmin: person.admin,
          },
        })

        await db.membership.upsert({
          where: {
            userId_organizationId: { userId: user.id, organizationId: organization.id },
          },
          update: { role: person.role },
          create: { userId: user.id, organizationId: organization.id, role: person.role },
        })
      }

      console.log(`Seeded ${practice.name} (${practice.people.length} people)`)
    }

    console.log('\nSign in with any of the seeded addresses and the password:')
    console.log(`  ${PASSWORD}\n`)
    console.log('owner@riverside.example is also a platform admin and can open /admin.')
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
