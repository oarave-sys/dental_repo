'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { login } from '@/lib/auth/login'
import { verifyTotp } from '@/lib/auth/totp'
import {
  SESSION_COOKIE, ABSOLUTE_TIMEOUT_MS, markMfaSatisfied, revokeSession,
} from '@/lib/auth/session'
import { getSession } from '@/lib/auth/current'
import { unsafeCrossTenantClient } from '@/lib/db/client'
import { logger } from '@/lib/logging/logger'

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

export interface FormState {
  error?: string
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(ABSOLUTE_TIMEOUT_MS / 1000),
  }
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: z.flattenError(parsed.error).fieldErrors.email?.[0] ?? 'Check your details and try again.' }
  }

  const h = await headers()
  const result = await login({
    email: parsed.data.email,
    password: parsed.data.password,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent'),
  })

  if (!result.ok) return { error: result.message }

  const jar = await cookies()
  jar.set(SESSION_COOKIE, result.token, cookieOptions())
  redirect('/mfa')
}

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') })

export async function verifyMfa(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = codeSchema.safeParse({ code: String(formData.get('code') ?? '').trim() })
  if (!parsed.success) return { error: 'Enter the six-digit code from your authenticator app.' }

  const session = await getSession()
  if (!session) return { error: 'Your session expired. Sign in again.' }

  const db = unsafeCrossTenantClient()
  const user = await db.user.findUnique({
    where: { id: session.actor.userId },
    select: { mfaSecretEncrypted: true },
  })
  if (!user?.mfaSecretEncrypted) {
    return { error: 'Multi-factor authentication is not set up on this account. Ask an administrator.' }
  }

  if (!verifyTotp(user.mfaSecretEncrypted, parsed.data.code)) {
    logger.warn('auth.mfa.failed', { userId: session.actor.userId })
    return { error: 'That code is not valid. Codes change every 30 seconds — try the current one.' }
  }

  await markMfaSatisfied(session.sessionId)
  logger.info('auth.mfa.success', { userId: session.actor.userId })
  redirect('/')
}

export async function signOut(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await revokeSession(token)
  jar.delete(SESSION_COOKIE)
  redirect('/login')
}
