import { unsafeCrossTenantClient } from '@/lib/db/client'
import { hashPassword, validatePasswordStrength, verifyPassword } from './password'
import { hashToken, randomToken } from './crypto'
import { conflict, notFound, validation } from '@/lib/errors'
import { logger } from '@/lib/logging/logger'
import type { RoleKey } from '@/lib/authz'

/**
 * Account and organization lifecycle.
 *
 * Runs through the unscoped client by necessity — sign-up creates the very
 * organization it will afterwards be scoped to, and a sign-in resolves an
 * email before any tenant is known.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'practice'
}

async function uniqueSlug(name: string): Promise<string> {
  const db = unsafeCrossTenantClient()
  const base = slugify(name)
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const existing = await db.organization.findUnique({ where: { slug: candidate } })
    if (!existing) return candidate
  }
  return `${base}-${randomToken(4)}`
}

export interface SignUpInput {
  practiceName: string
  name: string
  email: string
  password: string
}

export interface SignUpResult {
  userId: string
  organizationId: string
}

/**
 * Creates a practice and its first user, who becomes the OWNER.
 *
 * The two are created together in one transaction: an organization with no
 * owner, or a user with no organization, are both states nothing else in the
 * application knows how to handle.
 */
export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  const email = normaliseEmail(input.email)
  const practiceName = input.practiceName.trim()
  const name = input.name.trim()

  if (!EMAIL.test(email)) throw validation('Enter a valid email address.', { field: 'email' })
  if (practiceName.length < 2) throw validation('Enter your practice name.', { field: 'practiceName' })
  if (name.length < 2) throw validation('Enter your name.', { field: 'name' })

  const weak = validatePasswordStrength(input.password)
  if (weak) throw validation(weak.message, { field: 'password' })

  const db = unsafeCrossTenantClient()
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    throw conflict('An account with that email address already exists. Try signing in instead.')
  }

  const passwordHash = await hashPassword(input.password)
  const slug = await uniqueSlug(practiceName)

  const result = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: practiceName, slug },
    })

    const user = await tx.user.create({
      data: { email, name, passwordHash },
    })

    await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: 'OWNER' },
    })

    // Every new practice starts on a trial so the product is usable before
    // billing exists. Stripe later writes to this same row.
    await tx.subscription.create({
      data: {
        organizationId: organization.id,
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    })

    return { userId: user.id, organizationId: organization.id }
  })

  logger.info('account.signed_up', { organizationId: result.organizationId })
  return result
}

export interface SignInResult {
  userId: string
  organizationId: string
}

/**
 * Verifies credentials.
 *
 * Returns null for every failure — unknown email, wrong password, disabled
 * account — so the response cannot be used to discover which addresses have
 * accounts. A password verification runs even when no user matched, so the
 * timing does not give it away either.
 */
export async function signIn(email: string, password: string): Promise<SignInResult | null> {
  const db = unsafeCrossTenantClient()
  const user = await db.user.findUnique({
    where: { email: normaliseEmail(email) },
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        include: { organization: { select: { id: true, status: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!user) {
    // Equalise timing against the hash comparison below.
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000',
      password,
    )
    return null
  }

  const ok = await verifyPassword(user.passwordHash, password)
  if (!ok) return null
  if (user.status !== 'ACTIVE') return null

  const membership = user.memberships.find((m) => m.organization.status === 'ACTIVE')
  if (!membership) return null

  await db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
  return { userId: user.id, organizationId: membership.organizationId }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * Issues a reset token.
 *
 * Always reports success to the caller regardless of whether the address
 * exists — the returned token is null in that case and nothing is sent.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ token: string; userId: string } | null> {
  const db = unsafeCrossTenantClient()
  const user = await db.user.findUnique({ where: { email: normaliseEmail(email) } })
  if (!user || user.status !== 'ACTIVE') return null

  const token = randomToken()
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  })

  logger.info('account.reset_requested', { userId: user.id })
  return { token, userId: user.id }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const weak = validatePasswordStrength(newPassword)
  if (weak) throw validation(weak.message, { field: 'password' })

  const db = unsafeCrossTenantClient()
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  })

  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    throw notFound('That reset link is no longer valid. Request a new one.')
  }

  const passwordHash = await hashPassword(newPassword)
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } })
    await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } })
    // A password change invalidates every existing session.
    await tx.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })

  logger.info('account.password_reset', { userId: row.userId })
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function inviteMember(params: {
  organizationId: string
  email: string
  role: RoleKey
}): Promise<{ token: string }> {
  const email = normaliseEmail(params.email)
  if (!EMAIL.test(email)) throw validation('Enter a valid email address.', { field: 'email' })
  if (params.role === 'OWNER') {
    throw validation('An invitation cannot grant owner access. Transfer ownership instead.')
  }

  const db = unsafeCrossTenantClient()
  const existing = await db.membership.findFirst({
    where: { organizationId: params.organizationId, user: { email } },
  })
  if (existing) throw conflict('That person is already a member of this practice.')

  const token = randomToken()
  await db.invitation.create({
    data: {
      organizationId: params.organizationId,
      email,
      role: params.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    },
  })

  return { token }
}

export interface AcceptInvitationInput {
  token: string
  name: string
  password: string
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<{ userId: string; organizationId: string }> {
  const db = unsafeCrossTenantClient()
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
  })

  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw notFound('That invitation is no longer valid.')
  }
  if (invitation.expiresAt <= new Date()) {
    throw notFound('That invitation has expired. Ask an admin to send a new one.')
  }

  const weak = validatePasswordStrength(input.password)
  if (weak) throw validation(weak.message, { field: 'password' })

  const name = input.name.trim()
  if (name.length < 2) throw validation('Enter your name.', { field: 'name' })

  const passwordHash = await hashPassword(input.password)

  return db.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: invitation.email } })
    if (!user) {
      user = await tx.user.create({
        data: { email: invitation.email, name, passwordHash },
      })
    }

    await tx.membership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: invitation.organizationId },
      },
      create: {
        userId: user.id,
        organizationId: invitation.organizationId,
        role: invitation.role,
      },
      update: { status: 'ACTIVE' },
    })

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    })

    return { userId: user.id, organizationId: invitation.organizationId }
  })
}

export async function changeMemberRole(params: {
  organizationId: string
  membershipId: string
  role: RoleKey
}): Promise<void> {
  const db = unsafeCrossTenantClient()
  const membership = await db.membership.findFirst({
    where: { id: params.membershipId, organizationId: params.organizationId },
  })
  if (!membership) throw notFound('That member was not found.')

  // A practice with no owner cannot be administered or billed.
  if (membership.role === 'OWNER' && params.role !== 'OWNER') {
    const owners = await db.membership.count({
      where: { organizationId: params.organizationId, role: 'OWNER', status: 'ACTIVE' },
    })
    if (owners <= 1) {
      throw conflict('This practice must have at least one owner. Make someone else an owner first.')
    }
  }

  await db.membership.update({
    where: { id: membership.id },
    data: { role: params.role },
  })

  // Role changes take effect immediately, not at the next sign-in.
  await db.session.updateMany({
    where: { userId: membership.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function removeMember(params: {
  organizationId: string
  membershipId: string
}): Promise<void> {
  const db = unsafeCrossTenantClient()
  const membership = await db.membership.findFirst({
    where: { id: params.membershipId, organizationId: params.organizationId },
  })
  if (!membership) throw notFound('That member was not found.')

  if (membership.role === 'OWNER') {
    const owners = await db.membership.count({
      where: { organizationId: params.organizationId, role: 'OWNER', status: 'ACTIVE' },
    })
    if (owners <= 1) throw conflict('This practice must have at least one owner.')
  }

  await db.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: membership.id },
      data: { status: 'DISABLED' },
    })
    await tx.session.updateMany({
      where: { userId: membership.userId, organizationId: params.organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })
}
