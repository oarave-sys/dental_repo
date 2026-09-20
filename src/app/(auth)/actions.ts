'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  acceptInvitation,
  requestPasswordReset,
  resetPassword,
  signIn,
  signUp,
} from '@/lib/auth/accounts'
import { requestIp, requestUserAgent } from '@/lib/auth/current'
import { ABSOLUTE_TIMEOUT_MS, SESSION_COOKIE, issueSession, revokeSession } from '@/lib/auth/session'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logging/logger'

/**
 * Authentication server actions.
 *
 * Errors come back as form state rather than thrown exceptions, so a typo in a
 * password never produces an error page. Only messages from AppError — which
 * are written to be shown — are surfaced; anything else becomes a generic
 * message, because an unexpected error's text is not safe to display.
 */

export interface FormState {
  error?: string
  field?: string
  success?: string
}

async function setSessionCookie(userId: string, organizationId: string) {
  const session = await issueSession({
    userId,
    organizationId,
    ip: await requestIp(),
    userAgent: await requestUserAgent(),
  })

  const jar = await cookies()
  jar.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ABSOLUTE_TIMEOUT_MS / 1000),
  })
}

function toState(error: unknown, fallback: string): FormState {
  if (isAppError(error)) {
    return { error: error.message, field: String(error.meta.field ?? '') || undefined }
  }
  logger.error('auth.unexpected_error', { message: String(error) })
  return { error: fallback }
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { userId, organizationId } = await signUp({
      practiceName: String(formData.get('practiceName') ?? ''),
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    })
    await setSessionCookie(userId, organizationId)
  } catch (error) {
    return toState(error, 'We could not create that account. Try again.')
  }
  redirect('/dashboard')
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  try {
    const result = await signIn(email, password)
    if (!result) {
      // One message for every failure mode, so the form cannot be used to
      // discover which addresses have accounts.
      return { error: 'That email address and password do not match an account.' }
    }
    await setSessionCookie(result.userId, result.organizationId)
  } catch (error) {
    return toState(error, 'We could not sign you in. Try again.')
  }
  redirect('/dashboard')
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await revokeSession(token)
  jar.delete(SESSION_COOKIE)
  redirect('/sign-in')
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '')
  try {
    const issued = await requestPasswordReset(email)

    // Email delivery is not wired up in the MVP. In development the link is
    // logged so the flow can be completed; in production this needs a mail
    // provider (see README, "What requires external credentials").
    if (issued && process.env.NODE_ENV !== 'production') {
      const url = `${process.env.APP_URL ?? 'http://localhost:3000'}/reset-password?token=${issued.token}`
      console.log(`\n[dev] Password reset link: ${url}\n`)
    }
  } catch (error) {
    return toState(error, 'We could not process that request.')
  }

  // Always the same answer, whether or not the address exists.
  return {
    success:
      'If an account exists for that address, a reset link has been sent. Check your inbox.',
  }
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await resetPassword(
      String(formData.get('token') ?? ''),
      String(formData.get('password') ?? ''),
    )
  } catch (error) {
    return toState(error, 'We could not reset that password.')
  }
  redirect('/sign-in?reset=1')
}

export async function acceptInvitationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const { userId, organizationId } = await acceptInvitation({
      token: String(formData.get('token') ?? ''),
      name: String(formData.get('name') ?? ''),
      password: String(formData.get('password') ?? ''),
    })
    await setSessionCookie(userId, organizationId)
  } catch (error) {
    return toState(error, 'We could not accept that invitation.')
  }
  redirect('/dashboard')
}
