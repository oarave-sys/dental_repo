import { beforeEach, afterAll, describe, expect, it } from 'vitest'
import { withTenant, unsafeCrossTenantClient } from '@/lib/db/client'
import { changeStatus, assignReferral, addContactAttempt, addNote } from '@/lib/services/referrals'
import { createReferral } from '@/lib/services/intake'
import { linkEhrPatient, reviewDuplicate, findPossibleDuplicates } from '@/lib/services/patients'
import { writeAudit } from '@/lib/audit'
import { ownerClient, resetDatabase, seedOrg, type SeededOrg } from '../fixtures'
import type { AuditInput } from '@/lib/audit'

const owner = ownerClient()
let org: SeededOrg
let audits: AuditInput[]

const ctx = (db: Parameters<typeof changeStatus>[0]['db']) => ({
  db,
  actor: org.actor,
  audit: (i: AuditInput) => audits.push(i),
})

beforeEach(async () => {
  await resetDatabase(owner)
  org = await seedOrg(owner, { name: 'Workflow Test', slug: 'workflow', email: 'w@test' })
  audits = []
})

afterAll(async () => {
  await owner.$disconnect()
  await unsafeCrossTenantClient().$disconnect()
})

describe('status transitions', () => {
  it('records history, an activity entry and an audit row together', async () => {
    await withTenant(org.organizationId, async (db) => {
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'UNDER_REVIEW' })
    })

    const history = await owner.referralStatusHistory.findMany({
      where: { referralId: org.referralId },
    })
    const activities = await owner.referralActivity.findMany({
      where: { referralId: org.referralId, type: 'STATUS_CHANGED' },
    })

    expect(history).toHaveLength(1)
    expect(history[0]!.fromStatus).toBe('NEW')
    expect(history[0]!.toStatus).toBe('UNDER_REVIEW')
    expect(activities).toHaveLength(1)
    expect(audits.map((a) => a.action)).toContain('STATUS_CHANGE')
  })

  it('refuses an illegal transition and explains what is available', async () => {
    await expect(
      withTenant(org.organizationId, async (db) => {
        await changeStatus(ctx(db), { referralId: org.referralId, to: 'SCHEDULED' })
      }),
    ).rejects.toThrow(/cannot move to scheduled/i)

    const referral = await owner.referral.findUnique({ where: { id: org.referralId } })
    expect(referral!.status).toBe('NEW')
  })

  it('stamps the first-touch timestamp once and never moves it', async () => {
    await withTenant(org.organizationId, async (db) => {
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'UNDER_REVIEW' })
    })
    const first = await owner.referral.findUnique({ where: { id: org.referralId } })

    await new Promise((r) => setTimeout(r, 20))
    await withTenant(org.organizationId, async (db) => {
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'READY_TO_CONTACT' })
    })
    const second = await owner.referral.findUnique({ where: { id: org.referralId } })

    expect(second!.firstTouchedAt?.getTime()).toBe(first!.firstTouchedAt?.getTime())
    expect(second!.firstTriagedAt?.getTime()).toBe(first!.firstTriagedAt?.getTime())
  })

  it('preserves the original triage date when a closed referral is reopened', async () => {
    await withTenant(org.organizationId, async (db) => {
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'UNDER_REVIEW' })
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'CLOSED', reason: 'Duplicate' })
    })
    const closed = await owner.referral.findUnique({ where: { id: org.referralId } })
    expect(closed!.closedAt).not.toBeNull()

    await withTenant(org.organizationId, async (db) => {
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'UNDER_REVIEW' })
    })
    const reopened = await owner.referral.findUnique({ where: { id: org.referralId } })
    expect(reopened!.closedAt).toBeNull()
    expect(reopened!.firstTriagedAt?.getTime()).toBe(closed!.firstTriagedAt?.getTime())
  })

  it('computes touch metrics as the referral moves', async () => {
    await withTenant(org.organizationId, async (db) => {
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'UNDER_REVIEW' })
    })
    const metrics = await owner.referralTouchMetrics.findUnique({
      where: { referralId: org.referralId },
    })
    expect(metrics).not.toBeNull()
    expect(metrics!.secondsToFirstTouch).toBeGreaterThanOrEqual(0)
  })
})

describe('assignment', () => {
  it('refuses a user from another organization', async () => {
    const other = await seedOrg(owner, { name: 'Other', slug: 'other', email: 'o@test' })
    await expect(
      withTenant(org.organizationId, async (db) => {
        await assignReferral(ctx(db), { referralId: org.referralId, assignedUserId: other.userId })
      }),
    ).rejects.toThrow(/not active in this organization/i)
  })

  it('is a no-op when the assignee has not changed', async () => {
    await withTenant(org.organizationId, async (db) => {
      await assignReferral(ctx(db), { referralId: org.referralId, assignedUserId: org.userId })
      await assignReferral(ctx(db), { referralId: org.referralId, assignedUserId: org.userId })
    })
    const activities = await owner.referralActivity.findMany({
      where: { referralId: org.referralId, type: 'ASSIGNMENT_CHANGED' },
    })
    expect(activities).toHaveLength(1)
  })
})

describe('contact attempts', () => {
  it('records the attempt and marks first contact only when the patient is reached', async () => {
    await withTenant(org.organizationId, async (db) => {
      await addContactAttempt(ctx(db), {
        referralId: org.referralId, method: 'PHONE', outcome: 'LEFT_VOICEMAIL',
      })
    })
    expect((await owner.referral.findUnique({ where: { id: org.referralId } }))!.firstContactedAt)
      .toBeNull()

    await withTenant(org.organizationId, async (db) => {
      await addContactAttempt(ctx(db), {
        referralId: org.referralId, method: 'PHONE', outcome: 'REACHED',
      })
    })
    expect((await owner.referral.findUnique({ where: { id: org.referralId } }))!.firstContactedAt)
      .not.toBeNull()

    expect(await owner.contactAttempt.count({ where: { referralId: org.referralId } })).toBe(2)
  })
})

describe('intake', () => {
  it('creates a staging patient and a referral, and no EHR chart', async () => {
    const result = await withTenant(org.organizationId, async (db) =>
      createReferral(ctx(db), {
        patient: {
          firstName: 'Nadia', lastName: 'Petrov',
          dateOfBirth: new Date('1975-05-08T00:00:00Z'),
          phonePrimary: '555-0205',
        },
        receivedAt: new Date(),
        intakeChannel: 'FAX',
        referringOrganizationId: org.referringOrganizationId,
        payerId: org.payerId,
      }),
    )

    const referral = await owner.referral.findUnique({ where: { id: result.referralId } })
    expect(referral!.status).toBe('NEW')
    // The whole point of the product: no chart yet.
    expect(await owner.ehrLink.count({ where: { patientId: result.patientId } })).toBe(0)
    expect(await owner.referralStatusHistory.count({ where: { referralId: result.referralId } })).toBe(1)
  })

  it('attaches to an existing staging patient rather than duplicating them', async () => {
    const result = await withTenant(org.organizationId, async (db) =>
      createReferral(ctx(db), {
        patient: { firstName: 'x', lastName: 'y', dateOfBirth: new Date('1970-01-01T00:00:00Z') },
        existingPatientId: org.patientId,
        receivedAt: new Date(),
        intakeChannel: 'PORTAL',
      }),
    )
    expect(result.patientId).toBe(org.patientId)
    expect(await owner.patient.count({ where: { organizationId: org.organizationId } })).toBe(1)
  })

  it('surfaces a possible duplicate without merging anything', async () => {
    await withTenant(org.organizationId, async (db) => {
      await createReferral(ctx(db), {
        patient: {
          firstName: 'Fixture', lastName: 'workflow',
          dateOfBirth: new Date('1970-01-01T00:00:00Z'),
          phonePrimary: '555-0000',
        },
        receivedAt: new Date(),
        intakeChannel: 'FAX',
      })
    })

    const candidates = await owner.patientMatchCandidate.findMany({
      where: { organizationId: org.organizationId },
    })
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates[0]!.status).toBe('OPEN')
    // Two separate patients still exist. Nothing was merged.
    expect(await owner.patient.count({ where: { organizationId: org.organizationId } })).toBe(2)
    expect(await owner.patient.count({
      where: { organizationId: org.organizationId, mergedIntoPatientId: { not: null } },
    })).toBe(0)
  })

  it('finds duplicates before a patient is created', async () => {
    const matches = await withTenant(org.organizationId, (db) =>
      findPossibleDuplicates(db, {
        firstName: 'Fixture', lastName: 'workflow',
        dateOfBirth: new Date('1970-01-01T00:00:00Z'),
        phonePrimary: '555-0000',
      }, 60),
    )
    expect(matches[0]!.patient.id).toBe(org.patientId)
  })

  it('records a duplicate review decision once', async () => {
    await withTenant(org.organizationId, async (db) => {
      await createReferral(ctx(db), {
        patient: {
          firstName: 'Fixture', lastName: 'workflow',
          dateOfBirth: new Date('1970-01-01T00:00:00Z'), phonePrimary: '555-0000',
        },
        receivedAt: new Date(), intakeChannel: 'FAX',
      })
    })
    const candidate = (await owner.patientMatchCandidate.findFirst({
      where: { organizationId: org.organizationId },
    }))!

    await withTenant(org.organizationId, async (db) => {
      await reviewDuplicate(ctx(db), { matchId: candidate.id, decision: 'DISMISSED' })
    })
    await expect(
      withTenant(org.organizationId, async (db) => {
        await reviewDuplicate(ctx(db), { matchId: candidate.id, decision: 'LINKED' })
      }),
    ).rejects.toThrow(/already been reviewed/i)
  })
})

describe('EHR linkage', () => {
  it('links a patient once, records it on every referral, and rejects a duplicate MRN', async () => {
    await withTenant(org.organizationId, async (db) => {
      await linkEhrPatient(ctx(db), {
        patientId: org.patientId, mrn: 'MRN-1', createdInEhrAt: new Date(),
      })
    })
    expect(await owner.referralActivity.count({
      where: { referralId: org.referralId, type: 'EHR_PATIENT_LINKED' },
    })).toBe(1)

    await expect(
      withTenant(org.organizationId, async (db) => {
        await linkEhrPatient(ctx(db), {
          patientId: org.patientId, mrn: 'MRN-2', createdInEhrAt: new Date(),
        })
      }),
    ).rejects.toThrow(/already linked/i)
  })

  it('keeps the MRN itself out of the audit metadata', async () => {
    await withTenant(org.organizationId, async (db) => {
      await linkEhrPatient(ctx(db), {
        patientId: org.patientId, mrn: 'MRN-SECRET', createdInEhrAt: new Date(),
      })
    })
    expect(JSON.stringify(audits)).not.toContain('MRN-SECRET')
  })
})

describe('the audit trail', () => {
  it('cannot be updated or deleted by the application role', async () => {
    await withTenant(org.organizationId, async (db) => {
      await writeAudit(db, org.actor, { action: 'REFERRAL_VIEW', resourceType: 'referral', resourceId: org.referralId })
    })
    const row = (await owner.auditLog.findFirst({ where: { organizationId: org.organizationId } }))!

    await expect(
      withTenant(org.organizationId, (db) =>
        db.auditLog.update({ where: { id: row.id }, data: { action: 'LOGIN_SUCCESS' } }),
      ),
    ).rejects.toThrow()

    await expect(
      withTenant(org.organizationId, (db) => db.auditLog.delete({ where: { id: row.id } })),
    ).rejects.toThrow()

    expect(await owner.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull()
  })

  it('protects the status history and activity timeline the same way', async () => {
    await withTenant(org.organizationId, async (db) => {
      await changeStatus(ctx(db), { referralId: org.referralId, to: 'UNDER_REVIEW' })
    })
    const history = (await owner.referralStatusHistory.findFirst({}))!
    const activity = (await owner.referralActivity.findFirst({}))!

    await expect(
      withTenant(org.organizationId, (db) =>
        db.referralStatusHistory.delete({ where: { id: history.id } }),
      ),
    ).rejects.toThrow()
    await expect(
      withTenant(org.organizationId, (db) =>
        db.referralActivity.update({ where: { id: activity.id }, data: { note: 'tampered' } }),
      ),
    ).rejects.toThrow()
  })
})

describe('notes', () => {
  it('adds a timeline entry and marks the referral touched', async () => {
    await withTenant(org.organizationId, async (db) => {
      await addNote(ctx(db), { referralId: org.referralId, note: 'Left message with the office.' })
    })
    const activity = await owner.referralActivity.findFirst({
      where: { referralId: org.referralId, type: 'NOTE_ADDED' },
    })
    expect(activity!.note).toBe('Left message with the office.')
    expect((await owner.referral.findUnique({ where: { id: org.referralId } }))!.firstTouchedAt)
      .not.toBeNull()
  })
})
