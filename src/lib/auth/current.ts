import { cookies, headers } from 'next/headers'
import { SESSION_COOKIE, resolveSession, type ResolvedSession } from './session'
import { mfaRequired, unauthenticated } from '@/lib/errors'
import type { Actor } from '@/lib/authz'

/** Reads the session cookie. Returns null rather than throwing. */
export async function getSession(): Promise<ResolvedSession | null> {
  const jar = await cookies()
  return resolveSession(jar.get(SESSION_COOKIE)?.value)
}

/** Authenticated AND past the MFA challenge. Anything touching PHI uses this. */
export async function requireSession(): Promise<ResolvedSession> {
  const session = await getSession()
  if (!session) throw unauthenticated()
  if (!session.actor.mfaSatisfied) throw mfaRequired()
  return session
}

export async function requireActor(): Promise<Actor> {
  return (await requireSession()).actor
}

/** Authenticated but not yet past MFA — only the challenge and enrolment pages. */
export async function requirePreMfaSession(): Promise<ResolvedSession> {
  const session = await getSession()
  if (!session) throw unauthenticated()
  return session
}

export async function requestMetadata(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  return {
    ip: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
  }
}
