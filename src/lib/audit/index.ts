import { withTenant } from '@/lib/db/client'
import { hashIp } from '@/lib/auth/crypto'
import { logger } from '@/lib/logging/logger'

/**
 * The audit log.
 *
 * Append-only, enforced by the database: the row-level security policy grants
 * INSERT and SELECT and grants no UPDATE or DELETE, so nothing in the
 * application — including a future mistake in this file — can rewrite it.
 *
 * Holds no clinical text. An entry records WHO touched WHAT and WHEN, with
 * `subjectId` pointing at the row; the content stays where it already lives,
 * under its own access control. That is what makes the log safe to keep for
 * years and safe to show an admin.
 *
 * A failed write is logged and swallowed. This is a deliberate trade: for a
 * product holding no PHI, refusing to show a result because the audit write
 * failed is worse than a gap in the log. Before PHI handling is enabled, this
 * decision needs revisiting — an auditable system generally must fail closed.
 */

export type AuditAction =
  | 'CLINICAL_CONTENT_VIEWED'
  | 'CLINICAL_CONTENT_CREATED'
  | 'CLINICAL_CONTENT_DELETED'
  | 'CASE_SAVED'
  | 'CASE_DELETED'
  | 'MEMBER_INVITED'
  | 'MEMBER_ROLE_CHANGED'
  | 'MEMBER_REMOVED'
  | 'SETTINGS_CHANGED'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'ADMIN_METRICS_VIEWED'

export interface RecordAuditInput {
  organizationId: string
  userId?: string | null
  action: AuditAction
  subjectType: string
  subjectId?: string | null
  ip?: string | null
  userAgent?: string | null
  /** Enum values, counts and role names only. Never clinical text. */
  metadata?: Record<string, string | number | boolean | null>
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await withTenant(input.organizationId, async (db) => {
      await db.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          action: input.action,
          subjectType: input.subjectType,
          subjectId: input.subjectId ?? null,
          ipHash: hashIp(input.ip),
          userAgent: input.userAgent?.slice(0, 300) ?? null,
          metadata: input.metadata ?? {},
        },
      })
    })
  } catch (error) {
    logger.error('audit.write_failed', {
      organizationId: input.organizationId,
      action: input.action,
    })
  }
}

export interface AuditEntry {
  id: string
  action: AuditAction
  subjectType: string
  subjectId: string | null
  actorName: string
  createdAt: Date
  metadata: Record<string, unknown>
}

export async function listAuditEvents(
  organizationId: string,
  options: { limit?: number; action?: AuditAction } = {},
): Promise<AuditEntry[]> {
  return withTenant(organizationId, async (db) => {
    const rows = await db.auditEvent.findMany({
      where: options.action ? { action: options.action } : {},
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 200,
      include: { user: { select: { name: true } } },
    })
    return rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      // A removed user leaves their entries behind; the record outlives them.
      actorName: r.user?.name ?? 'Removed user',
      createdAt: r.createdAt,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }))
  })
}

export const AUDIT_LABELS: Record<AuditAction, string> = {
  CLINICAL_CONTENT_VIEWED: 'Opened a search',
  CLINICAL_CONTENT_CREATED: 'Ran a search',
  CLINICAL_CONTENT_DELETED: 'Deleted clinical content',
  CASE_SAVED: 'Saved a case',
  CASE_DELETED: 'Deleted a saved case',
  MEMBER_INVITED: 'Invited a member',
  MEMBER_ROLE_CHANGED: 'Changed a member role',
  MEMBER_REMOVED: 'Removed a member',
  SETTINGS_CHANGED: 'Changed practice settings',
  SIGNED_IN: 'Signed in',
  SIGNED_OUT: 'Signed out',
  ADMIN_METRICS_VIEWED: 'Viewed platform metrics',
}
