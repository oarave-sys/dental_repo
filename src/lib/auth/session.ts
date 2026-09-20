import { unsafeCrossTenantClient } from '@/lib/db/client'
import { hashToken, randomToken, hashIp } from './crypto'
import { buildActor, type Actor, type RoleKey } from '@/lib/authz'
import { unauthenticated } from '@/lib/errors'

/**
 * Opaque-token database sessions.
 *
 * The session is a random 256-bit token in an httpOnly cookie, stored only as
 * an HMAC. A database read cannot reconstruct a usable session, and a session
 * can be revoked server-side — which a stateless JWT cannot.
 *
 * Timeouts are longer than a clinical system would use: this product holds no
 * PHI by design, and a chairside user signing in repeatedly all day is the
 * fastest way to get a practice to stop using it. The values tighten when PHI
 * handling is enabled — see docs/SECURITY.md.
 */
export const SESSION_COOKIE = 'dca_session'
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000
export const ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000

export interface IssuedSession {
  token: string
  idleExpiresAt: Date
  absoluteExpiresAt: Date
}

export async function issueSession(params: {
  userId: string
  organizationId: string
  ip?: string | null
  userAgent?: string | null
}): Promise<IssuedSession> {
  const db = unsafeCrossTenantClient()
  const token = randomToken()
  const now = Date.now()
  const idleExpiresAt = new Date(now + IDLE_TIMEOUT_MS)
  const absoluteExpiresAt = new Date(now + ABSOLUTE_TIMEOUT_MS)

  await db.session.create({
    data: {
      userId: params.userId,
      organizationId: params.organizationId,
      tokenHash: hashToken(token),
      ipHash: hashIp(params.ip),
      userAgent: params.userAgent?.slice(0, 300) ?? null,
      idleExpiresAt,
      absoluteExpiresAt,
    },
  })
  return { token, idleExpiresAt, absoluteExpiresAt }
}

export interface ResolvedSession {
  sessionId: string
  actor: Actor
}

/**
 * Resolves a session token to an actor.
 *
 * This is the one place tenancy originates. `organizationId` comes from the
 * session row — never from a request body, header, query parameter, or any
 * other client-influenced value.
 *
 * Runs unscoped by necessity: the organization is not known until this returns.
 * That is why the identity tables use the BOOTSTRAP row-level-security tier.
 */
export async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
  if (!token) return null
  const db = unsafeCrossTenantClient()
  const now = new Date()

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: true,
      organization: { select: { id: true, status: true } },
    },
  })

  if (!session) return null
  if (session.revokedAt) return null
  if (session.absoluteExpiresAt <= now || session.idleExpiresAt <= now) return null
  if (session.user.status !== 'ACTIVE') return null
  if (session.organization.status !== 'ACTIVE') return null

  const membership = await db.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: session.userId,
        organizationId: session.organizationId,
      },
    },
  })
  if (!membership || membership.status !== 'ACTIVE') return null

  // Sliding idle window, capped by the absolute expiry.
  const nextIdle = new Date(
    Math.min(now.getTime() + IDLE_TIMEOUT_MS, session.absoluteExpiresAt.getTime()),
  )
  await db.session.update({
    where: { id: session.id },
    data: { idleExpiresAt: nextIdle },
  })

  return {
    sessionId: session.id,
    actor: buildActor({
      userId: session.userId,
      organizationId: session.organizationId,
      email: session.user.email,
      name: session.user.name,
      role: membership.role as RoleKey,
      isPlatformAdmin: session.user.isPlatformAdmin,
    }),
  }
}

export async function revokeSession(token: string): Promise<void> {
  await unsafeCrossTenantClient().session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** Used on password change and role change — every existing session dies. */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const { count } = await unsafeCrossTenantClient().session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return count
}

export function requireActor(resolved: ResolvedSession | null): ResolvedSession {
  if (!resolved) throw unauthenticated()
  return resolved
}
