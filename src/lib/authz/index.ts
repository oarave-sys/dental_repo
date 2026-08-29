import { forbidden } from '@/lib/errors'
import { permissionsForRoles, type Permission, type RoleKey } from './permissions'

export * from './permissions'

/**
 * The authenticated actor. `organizationId` is resolved from the session and is
 * the only source of tenancy in the system — Layer 1 of docs/SECURITY.md §1.
 */
export interface Actor {
  userId: string
  organizationId: string
  email: string
  name: string
  roleKeys: readonly RoleKey[]
  permissions: ReadonlySet<Permission>
  mfaSatisfied: boolean
}

export function buildActor(input: {
  userId: string
  organizationId: string
  email: string
  name: string
  roleKeys: readonly RoleKey[]
  mfaSatisfied: boolean
}): Actor {
  return { ...input, permissions: permissionsForRoles(input.roleKeys) }
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission)
}

export function canAll(actor: Actor, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => actor.permissions.has(p))
}

/** Throws rather than returning false, so a forgotten check cannot fail open. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) {
    throw forbidden('You do not have access to this.')
  }
}

export function isAdministrator(actor: Actor): boolean {
  return actor.roleKeys.includes('ADMINISTRATOR')
}
