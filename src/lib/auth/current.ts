import { cookies, headers } from 'next/headers'
import { SESSION_COOKIE, resolveSession, type ResolvedSession } from './session'
import { unauthenticated } from '@/lib/errors'
import type { Actor } from '@/lib/authz'

/** Resolves the caller from the request cookie, or null when signed out. */
export async function currentSession(): Promise<ResolvedSession | null> {
  const jar = await cookies()
  return resolveSession(jar.get(SESSION_COOKIE)?.value)
}

/** Throws UNAUTHENTICATED rather than returning null, so callers cannot forget. */
export async function requireSession(): Promise<ResolvedSession> {
  const resolved = await currentSession()
  if (!resolved) throw unauthenticated()
  return resolved
}

export async function requireActor(): Promise<Actor> {
  return (await requireSession()).actor
}

/** Best-effort client IP, used only in hashed form. */
export async function requestIp(): Promise<string | null> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null
  return h.get('x-real-ip')
}

export async function requestUserAgent(): Promise<string | null> {
  return (await headers()).get('user-agent')
}
