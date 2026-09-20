import { forbidden } from '@/lib/errors'

/**
 * Role-based access control.
 *
 * Three roles, as specified: OWNER, ADMIN, MEMBER. Permissions are strings so
 * the matrix can grow without reshaping the model, but the role set is
 * deliberately small — a dental office is not an enterprise.
 *
 * Platform administration (the /admin area) is NOT a role here. It is a flag on
 * the user record, because it is a property of our staff, not of a practice.
 */
export const PERMISSIONS = [
  'coding:use',
  'case:read',
  'case:write',
  'case:delete',
  'history:read_own',
  'history:read_all',
  'member:invite',
  'member:manage',
  'org:manage',
  'billing:manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export type RoleKey = 'OWNER' | 'ADMIN' | 'MEMBER'

/** Everyone who can sign in can do the actual job the product exists for. */
const MEMBER: Permission[] = [
  'coding:use',
  'case:read',
  'case:write',
  'history:read_own',
]

const ADMIN: Permission[] = [
  ...MEMBER,
  'case:delete',
  'history:read_all',
  'member:invite',
  'member:manage',
  'org:manage',
]

const OWNER: Permission[] = [...ADMIN, 'billing:manage']

export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  OWNER,
  ADMIN,
  MEMBER,
}

export const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
}

export function permissionsForRole(role: RoleKey): Set<Permission> {
  return new Set(ROLE_PERMISSIONS[role] ?? [])
}

/**
 * The authenticated actor. `organizationId` is resolved from the session and is
 * the only source of tenancy in the system — never a request parameter.
 */
export interface Actor {
  userId: string
  organizationId: string
  email: string
  name: string
  role: RoleKey
  permissions: ReadonlySet<Permission>
  isPlatformAdmin: boolean
}

export function buildActor(input: {
  userId: string
  organizationId: string
  email: string
  name: string
  role: RoleKey
  isPlatformAdmin: boolean
}): Actor {
  return { ...input, permissions: permissionsForRole(input.role) }
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission)
}

/** Throws rather than returning false, so a forgotten check cannot fail open. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw forbidden('You do not have access to this.')
}

export function requirePlatformAdmin(actor: Actor): void {
  if (!actor.isPlatformAdmin) throw forbidden('You do not have access to this.')
}
