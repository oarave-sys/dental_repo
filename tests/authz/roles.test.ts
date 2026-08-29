import { describe, expect, it } from 'vitest'
import {
  ROLE_PERMISSIONS, PHI_PERMISSIONS, PERMISSIONS,
  permissionsForRoles, buildActor, can, requirePermission,
  type RoleKey,
} from '@/lib/authz'

const ROLES: RoleKey[] = [
  'ADMINISTRATOR', 'MANAGER', 'REFERRAL_COORDINATOR', 'FRONT_DESK', 'MARKETING',
]

const actorWith = (roleKeys: RoleKey[]) =>
  buildActor({
    userId: 'u', organizationId: 'o', email: 'e@test', name: 'n',
    roleKeys, mfaSatisfied: true,
  })

describe('the role matrix', () => {
  it('grants the administrator everything', () => {
    expect(ROLE_PERMISSIONS.ADMINISTRATOR.length).toBe(PERMISSIONS.length)
  })

  it('withholds audit, user management and configuration from every non-administrator', () => {
    for (const role of ROLES.filter((r) => r !== 'ADMINISTRATOR')) {
      const perms = permissionsForRoles([role])
      expect(perms.has('audit:read'), role).toBe(false)
      expect(perms.has('user:manage'), role).toBe(false)
      expect(perms.has('config:manage'), role).toBe(false)
    }
  })

  it('lets only managers and administrators assign referrals', () => {
    expect(can(actorWith(['MANAGER']), 'referral:assign')).toBe(true)
    expect(can(actorWith(['ADMINISTRATOR']), 'referral:assign')).toBe(true)
    expect(can(actorWith(['REFERRAL_COORDINATOR']), 'referral:assign')).toBe(false)
    expect(can(actorWith(['FRONT_DESK']), 'referral:assign')).toBe(false)
  })

  it('keeps documents away from the front desk', () => {
    const frontDesk = actorWith(['FRONT_DESK'])
    expect(can(frontDesk, 'document:read')).toBe(false)
    expect(can(frontDesk, 'document:download')).toBe(false)
    expect(can(frontDesk, 'triage:override')).toBe(false)
    // But it can do its actual job.
    expect(can(frontDesk, 'referral:read')).toBe(true)
    expect(can(frontDesk, 'referral:contact')).toBe(true)
  })

  it('combines permissions when a user holds several roles', () => {
    const both = actorWith(['FRONT_DESK', 'MARKETING'])
    expect(can(both, 'referral:read')).toBe(true)
    expect(can(both, 'marketing:manage')).toBe(true)
    expect(can(both, 'audit:read')).toBe(false)
  })
})

describe('minimum necessary access for MARKETING', () => {
  it('holds no permission that could reach PHI', () => {
    const perms = permissionsForRoles(['MARKETING'])
    const violations = PHI_PERMISSIONS.filter((p) => perms.has(p))
    expect(violations).toEqual([])
  })

  it('can still do marketing work', () => {
    const marketing = actorWith(['MARKETING'])
    expect(can(marketing, 'source:read')).toBe(true)
    expect(can(marketing, 'marketing:manage')).toBe(true)
    expect(can(marketing, 'report:marketing')).toBe(true)
  })

  it('cannot read operational reports, which are referral-level', () => {
    expect(can(actorWith(['MARKETING']), 'report:operational')).toBe(false)
  })
})

describe('requirePermission', () => {
  it('throws rather than returning false, so a forgotten check cannot fail open', () => {
    expect(() => requirePermission(actorWith(['MARKETING']), 'patient:read')).toThrow(
      /do not have access/i,
    )
  })

  it('is silent when the permission is held', () => {
    expect(() => requirePermission(actorWith(['MANAGER']), 'patient:read')).not.toThrow()
  })
})
