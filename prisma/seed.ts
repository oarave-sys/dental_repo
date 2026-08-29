import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type PrismaClient as Client } from '../src/generated/prisma/client'
import { hashPassword } from '../src/lib/auth/password'
import { generateTotpSecret } from '../src/lib/auth/totp'
import { ROLE_PERMISSIONS, type RoleKey } from '../src/lib/authz/permissions'
import { DEFAULT_WEEK } from '../src/lib/domain/business-time'

/**
 * Development seed. Entirely fabricated — no real patient information, ever.
 *
 * Two organizations exist on purpose: tenant isolation is only meaningfully
 * tested when there is a second tenant whose data must never appear.
 *
 * Runs as the schema owner (DIRECT_DATABASE_URL), which is exempt from RLS.
 * That is the one place cross-tenant writes are legitimate.
 */

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

const DAY = 86_400_000
const now = new Date()
const daysAgo = (n: number, hours = 9) => {
  const d = new Date(now.getTime() - n * DAY)
  d.setHours(hours, Math.floor(Math.random() * 59), 0, 0)
  return d
}

const DEV_PASSWORD = 'correct-horse-battery-staple'

async function createOrganization(client: Client, spec: {
  name: string
  slug: string
  timezone: string
}) {
  const org = await client.organization.create({
    data: {
      name: spec.name,
      slug: spec.slug,
      specialty: 'RHEUMATOLOGY',
      timezone: spec.timezone,
      settings: {
        create: {
          businessHours: DEFAULT_WEEK as unknown as object,
          holidayDates: ['2026-01-01', '2026-07-03', '2026-11-26', '2026-12-25'],
        },
      },
    },
  })

  const roleKeys: RoleKey[] = [
    'ADMINISTRATOR', 'MANAGER', 'REFERRAL_COORDINATOR', 'FRONT_DESK', 'MARKETING',
  ]
  const roles = new Map<RoleKey, string>()
  for (const key of roleKeys) {
    const role = await client.role.create({
      data: {
        organizationId: org.id,
        key,
        name: key.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' '),
        isSystem: true,
        permissions: [...ROLE_PERMISSIONS[key]],
      },
    })
    roles.set(key, role.id)
  }
  return { org, roles }
}

async function createUser(
  client: Client,
  spec: { email: string; name: string; organizationId: string; roleId: string },
) {
  const { encrypted } = generateTotpSecret()
  const user = await client.user.create({
    data: {
      email: spec.email,
      name: spec.name,
      passwordHash: await hashPassword(DEV_PASSWORD),
      mfaSecretEncrypted: encrypted,
      mfaEnrolledAt: new Date(),
      memberships: {
        create: {
          organizationId: spec.organizationId,
          status: 'ACTIVE',
          acceptedAt: new Date(),
          roles: { create: { roleId: spec.roleId } },
        },
      },
    },
  })
  return user
}

async function main() {
  console.log('Clearing existing data…')
  await db.organization.deleteMany({})
  await db.user.deleteMany({})

  // -------------------------------------------------------------------------
  // Organization A — the working practice
  // -------------------------------------------------------------------------
  const { org: orgA, roles: rolesA } = await createOrganization(db, {
    name: 'Lakeside Rheumatology',
    slug: 'lakeside-rheumatology',
    timezone: 'America/New_York',
  })

  const admin = await createUser(db, {
    email: 'admin@lakeside.example', name: 'Dana Whitfield',
    organizationId: orgA.id, roleId: rolesA.get('ADMINISTRATOR')!,
  })
  const manager = await createUser(db, {
    email: 'manager@lakeside.example', name: 'Priya Raman',
    organizationId: orgA.id, roleId: rolesA.get('MANAGER')!,
  })
  const coordinator = await createUser(db, {
    email: 'coordinator@lakeside.example', name: 'Marcus Bell',
    organizationId: orgA.id, roleId: rolesA.get('REFERRAL_COORDINATOR')!,
  })
  const coordinator2 = await createUser(db, {
    email: 'coordinator2@lakeside.example', name: 'Yuki Tanaka',
    organizationId: orgA.id, roleId: rolesA.get('REFERRAL_COORDINATOR')!,
  })
  const frontDesk = await createUser(db, {
    email: 'frontdesk@lakeside.example', name: 'Rosa Iglesias',
    organizationId: orgA.id, roleId: rolesA.get('FRONT_DESK')!,
  })
  await createUser(db, {
    email: 'marketing@lakeside.example', name: 'Tom Okafor',
    organizationId: orgA.id, roleId: rolesA.get('MARKETING')!,
  })

  console.log('Seeding referral sources…')
  const offices = await Promise.all(
    [
      { name: 'Riverbend Family Medicine', city: 'Riverbend', phone: '555-0100', fax: '555-0101' },
      { name: 'Northgate Internal Medicine', city: 'Northgate', phone: '555-0110', fax: '555-0111' },
      { name: 'Cedar Hill Primary Care', city: 'Cedar Hill', phone: '555-0120', fax: '555-0121' },
      { name: 'Harbor Orthopedics', city: 'Harbor', phone: '555-0130', fax: '555-0131' },
      { name: 'Westside Urgent Care', city: 'Westside', phone: '555-0140', fax: '555-0141' },
    ].map((o) =>
      db.referringOrganization.create({
        data: { organizationId: orgA.id, ...o, state: 'NY', isActive: true },
      }),
    ),
  )

  const providers = await Promise.all(
    [
      { firstName: 'Helen', lastName: 'Okonjo', credential: 'MD', specialty: 'Family Medicine', office: 0 },
      { firstName: 'Samuel', lastName: 'Grant', credential: 'DO', specialty: 'Internal Medicine', office: 1 },
      { firstName: 'Aisha', lastName: 'Nowak', credential: 'NP', specialty: 'Primary Care', office: 2 },
      { firstName: 'Peter', lastName: 'Lindqvist', credential: 'MD', specialty: 'Orthopedics', office: 3 },
      { firstName: 'Grace', lastName: 'Adeyemi', credential: 'PA', specialty: 'Urgent Care', office: 4 },
    ].map((p) =>
      db.referringProvider.create({
        data: {
          organizationId: orgA.id,
          firstName: p.firstName,
          lastName: p.lastName,
          credential: p.credential,
          specialty: p.specialty,
          referringOrganizationId: offices[p.office]!.id,
        },
      }),
    ),
  )

  const payers = await Promise.all(
    [
      { name: 'Blue Ridge Commercial PPO', category: 'COMMERCIAL', isAccepted: true },
      { name: 'Statewide HMO', category: 'HMO', isAccepted: true },
      { name: 'Medicare Part B', category: 'MEDICARE', isAccepted: true },
      { name: 'Valley Managed Medicaid', category: 'MEDICAID_MANAGED', isAccepted: false },
      { name: 'Anchor Health Exchange', category: 'EXCHANGE', isAccepted: false },
    ].map((p) => db.payer.create({ data: { organizationId: orgA.id, ...p } })),
  )

  // -------------------------------------------------------------------------
  // Patients and referrals across the whole workflow
  // -------------------------------------------------------------------------
  console.log('Seeding staging patients and referrals…')

  interface Spec {
    first: string; last: string; dob: string
    phone: string; address: string; postal: string
    diagnosis: string; code: string | null
    status: string; office: number; provider: number; payer: number
    receivedDaysAgo: number
    assigned: string | null
    touched: boolean
  }

  const specs: Spec[] = [
    { first: 'Eleanor', last: 'Vance', dob: '1954-03-12', phone: '555-0201', address: '14 Willow Lane', postal: '12401', diagnosis: 'Osteoporosis, DXA pending', code: 'M81.0', status: 'MISSING_INFORMATION', office: 0, provider: 0, payer: 0, receivedDaysAgo: 9, assigned: coordinator.id, touched: true },
    { first: 'Marcus', last: 'Delgado', dob: '1968-11-02', phone: '555-0202', address: '221 Baker Street', postal: '12402', diagnosis: 'Seropositive rheumatoid arthritis', code: 'M05.79', status: 'READY_TO_SCHEDULE', office: 1, provider: 1, payer: 0, receivedDaysAgo: 4, assigned: coordinator.id, touched: true },
    { first: 'Ingrid', last: 'Solberg', dob: '1949-07-19', phone: '555-0203', address: '8 Fjord Court', postal: '12403', diagnosis: 'Polymyalgia rheumatica', code: 'M35.3', status: 'SCHEDULED', office: 0, provider: 0, payer: 2, receivedDaysAgo: 21, assigned: coordinator2.id, touched: true },
    { first: 'Terrence', last: 'Boyle', dob: '1981-01-30', phone: '555-0204', address: '77 Chapel Road', postal: '12404', diagnosis: 'Fibromyalgia', code: 'M79.7', status: 'NOT_ACCEPTED', office: 4, provider: 4, payer: 1, receivedDaysAgo: 15, assigned: coordinator.id, touched: true },
    { first: 'Nadia', last: 'Petrov', dob: '1975-05-08', phone: '555-0205', address: '3 Linden Way', postal: '12405', diagnosis: 'Joint pain, unspecified', code: 'M25.50', status: 'UNDER_REVIEW', office: 2, provider: 2, payer: 1, receivedDaysAgo: 2, assigned: coordinator2.id, touched: true },
    { first: 'Howard', last: 'Kimani', dob: '1960-09-23', phone: '555-0206', address: '19 Orchard Drive', postal: '12406', diagnosis: 'Gout, recurrent', code: 'M10.9', status: 'READY_TO_CONTACT', office: 1, provider: 1, payer: 0, receivedDaysAgo: 3, assigned: null, touched: true },
    { first: 'Priscilla', last: 'Nunes', dob: '1988-12-14', phone: '555-0207', address: '52 Meadow Bank', postal: '12407', diagnosis: 'Suspected lupus', code: 'M32.9', status: 'NEW', office: 0, provider: 0, payer: 0, receivedDaysAgo: 0, assigned: null, touched: false },
    { first: 'Walter', last: 'Ashby', dob: '1943-02-27', phone: '555-0208', address: '6 Quarry Rise', postal: '12408', diagnosis: 'Giant cell arteritis, urgent', code: 'M31.6', status: 'NEW', office: 4, provider: 4, payer: 2, receivedDaysAgo: 0, assigned: null, touched: false },
    { first: 'Bernadette', last: 'Okoro', dob: '1971-06-05', phone: '555-0209', address: '31 Halcyon Street', postal: '12409', diagnosis: 'Sjögren syndrome', code: 'M35.00', status: 'WAITING_ON_REFERRING_OFFICE', office: 2, provider: 2, payer: 1, receivedDaysAgo: 12, assigned: coordinator.id, touched: true },
    { first: 'Desmond', last: 'Farrow', dob: '1956-10-11', phone: '555-0210', address: '90 Kestrel Avenue', postal: '12410', diagnosis: 'Psoriatic arthritis', code: 'L40.52', status: 'PATIENT_CONTACTED', office: 3, provider: 3, payer: 0, receivedDaysAgo: 6, assigned: coordinator2.id, touched: true },
    { first: 'Lucia', last: 'Marchetti', dob: '1993-04-18', phone: '555-0211', address: '12 Cypress Close', postal: '12411', diagnosis: 'Raynaud phenomenon', code: 'I73.00', status: 'UNABLE_TO_REACH', office: 1, provider: 1, payer: 1, receivedDaysAgo: 18, assigned: frontDesk.id, touched: true },
    { first: 'Ambrose', last: 'Whitlock', dob: '1965-08-29', phone: '555-0212', address: '44 Fenwick Gardens', postal: '12412', diagnosis: 'Ankylosing spondylitis', code: 'M45.9', status: 'UNDER_REVIEW', office: 0, provider: 0, payer: 3, receivedDaysAgo: 8, assigned: coordinator.id, touched: true },
    // Never touched, and old. This is what the exception dashboard is for.
    { first: 'Coretta', last: 'Blyth', dob: '1979-03-03', phone: '555-0213', address: '5 Bramble Court', postal: '12413', diagnosis: 'Polyarthralgia', code: null, status: 'NEW', office: 2, provider: 2, payer: 0, receivedDaysAgo: 11, assigned: null, touched: false },
    { first: 'Rafael', last: 'Enriquez', dob: '1952-12-01', phone: '555-0214', address: '28 Sable Row', postal: '12414', diagnosis: 'Osteoarthritis, both knees', code: 'M17.0', status: 'MISSING_INFORMATION', office: 3, provider: 3, payer: 2, receivedDaysAgo: 5, assigned: coordinator2.id, touched: true },
  ]

  const patients = new Map<string, string>()
  for (const spec of specs) {
    const patient = await db.patient.create({
      data: {
        organizationId: orgA.id,
        firstName: spec.first,
        lastName: spec.last,
        dateOfBirth: new Date(`${spec.dob}T00:00:00Z`),
        phonePrimary: spec.phone,
        addressLine1: spec.address,
        city: 'Riverbend',
        state: 'NY',
        postalCode: spec.postal,
      },
    })
    patients.set(`${spec.first} ${spec.last}`, patient.id)

    const receivedAt = daysAgo(spec.receivedDaysAgo)
    const touchedAt = spec.touched ? new Date(receivedAt.getTime() + 3.5 * 3600_000) : null
    const isScheduled = spec.status === 'SCHEDULED'

    const referral = await db.referral.create({
      data: {
        organizationId: orgA.id,
        patientId: patient.id,
        receivedAt,
        intakeChannel: spec.receivedDaysAgo % 3 === 0 ? 'FAX' : 'PORTAL',
        referringOrganizationId: offices[spec.office]!.id,
        referringProviderId: providers[spec.provider]!.id,
        referralDiagnosisText: spec.diagnosis,
        referringDiagnosisCode: spec.code,
        payerId: payers[spec.payer]!.id,
        payerRawName: payers[spec.payer]!.name,
        memberId: `MBR${100000 + specs.indexOf(spec)}`,
        assignedUserId: spec.assigned,
        status: spec.status as never,
        priority: spec.diagnosis.includes('urgent') ? 'EXPEDITE' : 'ROUTINE',
        firstTouchedAt: touchedAt,
        firstTriagedAt: spec.touched ? touchedAt : null,
        scheduledAt: isScheduled ? new Date(receivedAt.getTime() + 6 * DAY) : null,
        readyToScheduleAt: ['SCHEDULED', 'READY_TO_SCHEDULE'].includes(spec.status)
          ? new Date(receivedAt.getTime() + 4 * DAY)
          : null,
        closedAt: ['NOT_ACCEPTED', 'UNABLE_TO_REACH'].includes(spec.status)
          ? new Date(receivedAt.getTime() + 9 * DAY)
          : null,
        lastActivityAt: touchedAt ?? receivedAt,
      },
    })

    await db.referralStatusHistory.create({
      data: {
        organizationId: orgA.id,
        referralId: referral.id,
        fromStatus: null,
        toStatus: 'NEW',
        actorType: 'SYSTEM',
        reason: 'Referral received',
        changedAt: receivedAt,
      },
    })
    if (spec.status !== 'NEW') {
      await db.referralStatusHistory.create({
        data: {
          organizationId: orgA.id,
          referralId: referral.id,
          fromStatus: 'NEW',
          toStatus: spec.status as never,
          actorType: 'USER',
          changedByUserId: spec.assigned ?? coordinator.id,
          changedAt: touchedAt ?? receivedAt,
        },
      })
    }

    await db.referralActivity.create({
      data: {
        organizationId: orgA.id,
        referralId: referral.id,
        type: 'REFERRAL_RECEIVED',
        actorType: 'SYSTEM',
        occurredAt: receivedAt,
      },
    })
    if (spec.touched) {
      await db.referralActivity.create({
        data: {
          organizationId: orgA.id,
          referralId: referral.id,
          type: 'STATUS_CHANGED',
          actorType: 'USER',
          userId: spec.assigned ?? coordinator.id,
          occurredAt: touchedAt!,
          metadata: { from: 'NEW', to: spec.status },
        },
      })
      await db.referralTouchMetrics.create({
        data: {
          organizationId: orgA.id,
          referralId: referral.id,
          secondsToFirstTouch: Math.floor((touchedAt!.getTime() - receivedAt.getTime()) / 1000),
          secondsToScheduled: isScheduled ? 6 * 86400 : null,
        },
      })
    }

    if (['READY_TO_CONTACT', 'PATIENT_CONTACTED', 'UNABLE_TO_REACH'].includes(spec.status)) {
      await db.contactAttempt.create({
        data: {
          organizationId: orgA.id,
          referralId: referral.id,
          patientId: patient.id,
          userId: frontDesk.id,
          attemptedAt: new Date(receivedAt.getTime() + 2 * DAY),
          method: 'PHONE',
          outcome: spec.status === 'PATIENT_CONTACTED' ? 'REACHED' : 'LEFT_VOICEMAIL',
          note: spec.status === 'PATIENT_CONTACTED' ? 'Confirmed availability weekday mornings.' : null,
        },
      })
    }
  }

  // A deliberate near-duplicate: same date of birth, transposed surname, same
  // phone. Exercises the review queue without ever auto-merging.
  console.log('Seeding a duplicate-review example…')
  const original = patients.get('Marcus Delgado')!
  const nearDuplicate = await db.patient.create({
    data: {
      organizationId: orgA.id,
      firstName: 'Marcos',
      lastName: 'Delgado',
      dateOfBirth: new Date('1968-11-02T00:00:00Z'),
      phonePrimary: '555-0202',
      addressLine1: '221 Baker Street',
      city: 'Riverbend',
      state: 'NY',
      postalCode: '12402',
    },
  })
  await db.patientMatchCandidate.create({
    data: {
      organizationId: orgA.id,
      patientId: nearDuplicate.id,
      candidatePatientId: original,
      score: 88,
      matchedOn: ['DOB_PHONE', 'FUZZY_NAME_DOB'],
      status: 'OPEN',
    },
  })

  // One patient who progressed far enough to deserve an EHR chart.
  await db.ehrLink.create({
    data: {
      organizationId: orgA.id,
      patientId: patients.get('Ingrid Solberg')!,
      mrn: 'MRN-004821',
      ehrSystem: 'UNSPECIFIED',
      createdInEhrAt: daysAgo(14),
      linkedByUserId: coordinator2.id,
      linkMethod: 'MANUAL',
    },
  })

  await db.auditLog.createMany({
    data: [
      { organizationId: orgA.id, userId: admin.id, actorType: 'USER', action: 'LOGIN_SUCCESS', resourceType: 'user', resourceId: admin.id },
      { organizationId: orgA.id, userId: manager.id, actorType: 'USER', action: 'LOGIN_SUCCESS', resourceType: 'user', resourceId: manager.id },
    ],
  })

  // -------------------------------------------------------------------------
  // Organization B — exists so isolation has something to fail against
  // -------------------------------------------------------------------------
  console.log('Seeding a second organization for isolation testing…')
  const { org: orgB, roles: rolesB } = await createOrganization(db, {
    name: 'Summit Valley Rheumatology',
    slug: 'summit-valley-rheumatology',
    timezone: 'America/Denver',
  })
  await createUser(db, {
    email: 'admin@summitvalley.example', name: 'Jordan Ellis',
    organizationId: orgB.id, roleId: rolesB.get('ADMINISTRATOR')!,
  })
  const officeB = await db.referringOrganization.create({
    data: { organizationId: orgB.id, name: 'Summit Family Practice', city: 'Summit', state: 'CO' },
  })
  const payerB = await db.payer.create({
    data: { organizationId: orgB.id, name: 'Mountain Health PPO', category: 'COMMERCIAL' },
  })
  const patientB = await db.patient.create({
    data: {
      organizationId: orgB.id,
      firstName: 'Confidential',
      lastName: 'OtherTenant',
      dateOfBirth: new Date('1970-01-01T00:00:00Z'),
      phonePrimary: '555-9999',
    },
  })
  await db.referral.create({
    data: {
      organizationId: orgB.id,
      patientId: patientB.id,
      receivedAt: daysAgo(1),
      referringOrganizationId: officeB.id,
      payerId: payerB.id,
      referralDiagnosisText: 'Must never be visible to Lakeside',
      status: 'NEW',
      lastActivityAt: daysAgo(1),
    },
  })

  const counts = {
    organizations: await db.organization.count(),
    users: await db.user.count(),
    patients: await db.patient.count(),
    referrals: await db.referral.count(),
  }
  console.log('Seed complete:', counts)
  console.log(`\nSign in with any seeded email and password: ${DEV_PASSWORD}`)
  console.log('Every user has TOTP enrolled; use scripts/dev-totp.ts to get a current code.\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
