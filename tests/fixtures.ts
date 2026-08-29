import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { ROLE_PERMISSIONS, type RoleKey } from '@/lib/authz/permissions'
import { buildActor, type Actor } from '@/lib/authz'
import { DEFAULT_WEEK } from '@/lib/domain/business-time'

/**
 * Fixtures build two complete organizations. Every isolation assertion runs
 * against a database where the other tenant's rows genuinely exist — a test
 * that passes because there was nothing to leak is not a test.
 */
export function ownerClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL! }),
  })
}

export interface SeededOrg {
  organizationId: string
  userId: string
  patientId: string
  referralId: string
  referringOrganizationId: string
  payerId: string
  actor: Actor
}

export async function resetDatabase(db: ReturnType<typeof ownerClient>) {
  await db.organization.deleteMany({})
  await db.user.deleteMany({})
}

export async function seedOrg(
  db: ReturnType<typeof ownerClient>,
  spec: { name: string; slug: string; roleKey?: RoleKey; email: string },
): Promise<SeededOrg> {
  const roleKey = spec.roleKey ?? 'ADMINISTRATOR'
  const org = await db.organization.create({
    data: {
      name: spec.name,
      slug: spec.slug,
      settings: { create: { businessHours: DEFAULT_WEEK as unknown as object } },
    },
  })
  const role = await db.role.create({
    data: {
      organizationId: org.id,
      key: roleKey,
      name: roleKey,
      permissions: [...ROLE_PERMISSIONS[roleKey]],
    },
  })
  const user = await db.user.create({
    data: {
      email: spec.email,
      name: spec.email,
      passwordHash: 'x',
      memberships: {
        create: {
          organizationId: org.id,
          status: 'ACTIVE',
          roles: { create: { roleId: role.id } },
        },
      },
    },
  })
  const patient = await db.patient.create({
    data: {
      organizationId: org.id,
      firstName: 'Fixture',
      lastName: spec.slug,
      dateOfBirth: new Date('1970-01-01T00:00:00Z'),
      phonePrimary: '555-0000',
    },
  })
  const office = await db.referringOrganization.create({
    data: { organizationId: org.id, name: `${spec.name} Referrer` },
  })
  const payer = await db.payer.create({
    data: { organizationId: org.id, name: `${spec.name} Payer` },
  })
  const referral = await db.referral.create({
    data: {
      organizationId: org.id,
      patientId: patient.id,
      receivedAt: new Date(),
      referringOrganizationId: office.id,
      payerId: payer.id,
      referralDiagnosisText: `${spec.slug} confidential diagnosis`,
      lastActivityAt: new Date(),
    },
  })

  return {
    organizationId: org.id,
    userId: user.id,
    patientId: patient.id,
    referralId: referral.id,
    referringOrganizationId: office.id,
    payerId: payer.id,
    actor: buildActor({
      userId: user.id,
      organizationId: org.id,
      email: spec.email,
      name: spec.email,
      roleKeys: [roleKey],
      mfaSatisfied: true,
    }),
  }
}
