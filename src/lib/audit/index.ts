import type { AuditAction } from '@/generated/prisma/client'
import type { TenantDb } from '@/lib/db/client'
import type { Actor } from '@/lib/authz'

export type { AuditAction }

/**
 * Append-only audit writer (docs/SECURITY.md §3, docs/OPEN-QUESTIONS.md A-8).
 *
 * `metadata` records WHICH field changed, never the value. A diff of patient
 * demographics belongs in the audit log as `["lastName","phonePrimary"]`, not
 * as the names and numbers themselves — the audit trail must not become a
 * second, less-protected copy of the record.
 */
export interface AuditInput {
  action: AuditAction
  resourceType: string
  resourceId?: string | null
  /** Opaque IDs, field names, counts, booleans. Never PHI values. */
  metadata?: Record<string, string | number | boolean | string[] | null>
  ipHash?: string | null
  userAgent?: string | null
}

export async function writeAudit(
  db: TenantDb,
  actor: Pick<Actor, 'userId' | 'organizationId'>,
  input: AuditInput,
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: actor.organizationId,
      userId: actor.userId,
      actorType: 'USER',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? undefined,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
    },
  })
}

export async function writeSystemAudit(
  db: TenantDb,
  organizationId: string,
  input: AuditInput,
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId,
      actorType: 'SYSTEM',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ?? undefined,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
    },
  })
}

/**
 * Field names that changed, for audit metadata. Values are deliberately dropped.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const k of keys) {
    const a = before[k]
    const b = after[k]
    if (b === undefined) continue
    const same =
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b
    if (!same) changed.push(k)
  }
  return changed.sort()
}
