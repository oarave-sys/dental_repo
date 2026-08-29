/**
 * Role-based access control (docs/SECURITY.md §2).
 *
 * Permissions are strings so an organization can compose custom roles later
 * without a code change. The matrix below defines the five system roles.
 *
 * Minimum necessary access is structural, not cosmetic: MARKETING holds no
 * permission that can reach a patient, a referral, or a document. There is no
 * server action a marketing-only session can call that returns PHI — hiding
 * links in the UI is never the control.
 */
export const PERMISSIONS = [
  'referral:read',
  'referral:create',
  'referral:update',
  'referral:assign',
  'referral:status',
  'referral:contact',
  'patient:read',
  'patient:create',
  'patient:update',
  'patient:merge_review',
  'patient:link_ehr',
  'document:read',
  'document:upload',
  'document:download',
  'intake:manage',
  'triage:override',
  'source:read',
  'source:manage',
  'marketing:read',
  'marketing:manage',
  'report:operational',
  'report:marketing',
  'audit:read',
  'user:manage',
  'config:manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type RoleKey =
  | 'ADMINISTRATOR'
  | 'MANAGER'
  | 'REFERRAL_COORDINATOR'
  | 'FRONT_DESK'
  | 'MARKETING'

const COORDINATOR: Permission[] = [
  'referral:read', 'referral:create', 'referral:update', 'referral:status',
  'referral:contact',
  'patient:read', 'patient:create', 'patient:update', 'patient:merge_review',
  'patient:link_ehr',
  'document:read', 'document:upload', 'document:download',
  'intake:manage',
  'triage:override',
  'source:read',
]

const MANAGER: Permission[] = [
  ...COORDINATOR,
  'referral:assign',
  'source:manage',
  'marketing:read', 'marketing:manage',
  'report:operational', 'report:marketing',
]

/** Referral lookup and patient contact. No documents, no triage authority. */
const FRONT_DESK: Permission[] = [
  'referral:read', 'referral:status', 'referral:contact',
  'patient:read', 'patient:update',
  'source:read',
]

/** Aggregate referral-source performance only. Nothing that reaches a patient. */
const MARKETING: Permission[] = [
  'source:read', 'source:manage',
  'marketing:read', 'marketing:manage',
  'report:marketing',
]

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  ADMINISTRATOR: PERMISSIONS,
  MANAGER,
  REFERRAL_COORDINATOR: COORDINATOR,
  FRONT_DESK,
  MARKETING,
}

/** Permissions that would expose PHI. MARKETING must hold none of them. */
export const PHI_PERMISSIONS: readonly Permission[] = [
  'referral:read', 'referral:create', 'referral:update', 'referral:status',
  'referral:contact', 'referral:assign',
  'patient:read', 'patient:create', 'patient:update', 'patient:merge_review',
  'patient:link_ehr',
  'document:read', 'document:upload', 'document:download',
  'intake:manage', 'triage:override',
]

export function permissionsForRoles(roleKeys: readonly RoleKey[]): Set<Permission> {
  const out = new Set<Permission>()
  for (const key of roleKeys) for (const p of ROLE_PERMISSIONS[key] ?? []) out.add(p)
  return out
}
