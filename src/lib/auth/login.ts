import crypto from 'node:crypto'
import { unsafeCrossTenantClient, withTenant } from '@/lib/db/client'
import { writeSystemAudit } from '@/lib/audit'
import { logger } from '@/lib/logging/logger'
import { verifyPassword } from './password'
import { hashIp } from './crypto'
import { issueSession } from './session'
import { AppError } from '@/lib/errors'

const MAX_FAILURES = 5
const LOCKOUT_MS = 15 * 60 * 1000

/** Generic on purpose — a distinct "no such account" reply enumerates users. */
const GENERIC = 'Email or password is incorrect.'

export type LoginResult =
  | { ok: true; token: string; mfaRequired: boolean; organizationId: string }
  | { ok: false; message: string }

/**
 * Verifies credentials and issues a session.
 *
 * A user may belong to several organizations; the session binds to one. For
 * Phase 2 that is their only active membership, and a chooser lands with
 * multi-org support.
 */
export async function login(params: {
  email: string
  password: string
  ip?: string | null
  userAgent?: string | null
}): Promise<LoginResult> {
  const db = unsafeCrossTenantClient()
  const email = params.email.trim().toLowerCase()
  // Emails are PII; logs carry a stable hash so failures remain correlatable.
  const emailRef = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)

  const user = await db.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        include: { organization: { select: { id: true, status: true } } },
      },
    },
  })

  if (!user) {
    // Equalize timing so a missing account is not detectable by response time.
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000000000000000', params.password)
    logger.warn('auth.login.unknown_account', { emailRef })
    return { ok: false, message: GENERIC }
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    logger.warn('auth.login.locked', { emailRef, userId: user.id })
    return {
      ok: false,
      message: 'Too many attempts. Try again in a few minutes, or ask an administrator to reset your password.',
    }
  }

  if (user.status !== 'ACTIVE') {
    logger.warn('auth.login.disabled_account', { emailRef, userId: user.id })
    return { ok: false, message: GENERIC }
  }

  const valid = await verifyPassword(user.passwordHash, params.password)
  if (!valid) {
    const failures = user.failedLoginCount + 1
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failures,
        lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    })
    logger.warn('auth.login.bad_password', { userId: user.id, failures })
    await auditLoginOutcome(user.memberships[0]?.organizationId, 'LOGIN_FAILURE', user.id, params)
    return { ok: false, message: GENERIC }
  }

  const membership = user.memberships.find((m) => m.organization.status === 'ACTIVE')
  if (!membership) {
    logger.warn('auth.login.no_active_membership', { userId: user.id })
    return { ok: false, message: 'Your account is not active in any organization.' }
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  })

  // MFA is required for everyone (docs/OPEN-QUESTIONS.md A-7). A user who has
  // not enrolled yet is sent through enrolment before reaching any PHI.
  const mfaRequired = true
  const session = await issueSession({
    userId: user.id,
    organizationId: membership.organizationId,
    mfaSatisfied: false,
    ip: params.ip,
    userAgent: params.userAgent,
  })

  await auditLoginOutcome(membership.organizationId, 'LOGIN_SUCCESS', user.id, params)
  logger.info('auth.login.success', { userId: user.id, organizationId: membership.organizationId })

  return {
    ok: true,
    token: session.token,
    mfaRequired,
    organizationId: membership.organizationId,
  }
}

async function auditLoginOutcome(
  organizationId: string | undefined,
  action: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE',
  userId: string,
  params: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  // A failure for an account with no organization has nowhere tenant-scoped to
  // land; it is captured in the application log instead.
  if (!organizationId) return
  try {
    await withTenant(organizationId, (tx) =>
      writeSystemAudit(tx, organizationId, {
        action,
        resourceType: 'user',
        resourceId: userId,
        ipHash: hashIp(params.ip),
        userAgent: params.userAgent?.slice(0, 300) ?? null,
      }),
    )
  } catch (error) {
    // An audit write must never take down authentication, but it must be loud.
    logger.error('audit.write_failed', {
      action,
      reason: error instanceof AppError ? error.code : 'unknown',
    })
  }
}
