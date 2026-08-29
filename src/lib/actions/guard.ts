import { z } from 'zod'
import { withTenant, type TenantDb } from '@/lib/db/client'
import { requireActor, requestMetadata } from '@/lib/auth/current'
import { requirePermission, type Actor, type Permission } from '@/lib/authz'
import { writeAudit, type AuditInput } from '@/lib/audit'
import { logger } from '@/lib/logging/logger'
import { AppError, isAppError } from '@/lib/errors'

/**
 * The single choke point for every mutation (docs/ARCHITECTURE.md §11).
 *
 * Authentication, MFA, tenant binding, RBAC, schema validation, the database
 * transaction and the audit write all happen here, in that order. They cannot
 * be forgotten individually because there is no other way in.
 */
export interface ActionContext {
  actor: Actor
  db: TenantDb
  /** Queue an audit row; written inside the same transaction as the mutation. */
  audit: (input: AuditInput) => void
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> }

export function withAuthorizedAction<TInput, TOutput>(config: {
  permission: Permission
  schema: z.ZodType<TInput>
  /** Named for the audit trail and the application log. */
  name: string
  handler: (input: TInput, ctx: ActionContext) => Promise<TOutput>
}): (raw: unknown) => Promise<ActionResult<TOutput>> {
  return async (raw: unknown): Promise<ActionResult<TOutput>> => {
    try {
      const actor = await requireActor()
      requirePermission(actor, config.permission)

      const parsed = config.schema.safeParse(raw)
      if (!parsed.success) {
        return {
          ok: false,
          code: 'VALIDATION',
          message: 'Check the highlighted fields and try again.',
          fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
        }
      }

      const meta = await requestMetadata()
      const pending: AuditInput[] = []

      const data = await withTenant(actor.organizationId, async (db) => {
        const result = await config.handler(parsed.data, {
          actor,
          db,
          audit: (input) => pending.push(input),
        })
        for (const entry of pending) {
          await writeAudit(db, actor, {
            ...entry,
            ipHash: entry.ipHash ?? null,
            userAgent: entry.userAgent ?? meta.userAgent,
          })
        }
        return result
      })

      return { ok: true, data }
    } catch (error) {
      if (isAppError(error)) {
        logger.warn('action.rejected', { action: config.name, code: error.code, ...error.meta })
        return { ok: false, code: error.code, message: error.message }
      }
      // Unexpected failures never surface their message: it could contain PHI
      // from a database driver error.
      logger.error('action.failed', {
        action: config.name,
        kind: error instanceof Error ? error.name : 'unknown',
      })
      return {
        ok: false,
        code: 'INTERNAL',
        message: 'Something went wrong. Nothing was saved. Try again.',
      }
    }
  }
}

/**
 * Read-side equivalent for Server Components. Throws instead of returning a
 * result object, so a page that forgets to check simply does not render.
 */
export async function withAuthorizedQuery<T>(
  permission: Permission,
  fn: (ctx: { actor: Actor; db: TenantDb }) => Promise<T>,
): Promise<T> {
  const actor = await requireActor()
  requirePermission(actor, permission)
  return withTenant(actor.organizationId, (db) => fn({ actor, db }))
}

export { AppError }
