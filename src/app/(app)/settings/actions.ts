'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/current'
import { requirePermission, type RoleKey } from '@/lib/authz'
import { changeMemberRole, inviteMember, removeMember } from '@/lib/auth/accounts'
import { withTenant } from '@/lib/db/client'
import { recordUsage } from '@/lib/usage'
import { recordAudit } from '@/lib/audit'
import { requestIp, requestUserAgent } from '@/lib/auth/current'
import { isAppError } from '@/lib/errors'

export interface SettingsState {
  error?: string
  success?: string
  /** Shown once so an invite can be delivered by hand while email is unwired. */
  invitationUrl?: string
}

function fail(error: unknown, fallback: string): SettingsState {
  return { error: isAppError(error) ? error.message : fallback }
}

export async function updatePracticeAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const actor = await requireActor()
  requirePermission(actor, 'org:manage')

  const name = String(formData.get('name') ?? '').trim()
  if (name.length < 2) return { error: 'Enter your practice name.' }

  const retainQueryText = formData.get('retainQueryText') === 'on'

  try {
    await withTenant(actor.organizationId, async (db) => {
      await db.organization.update({
        where: { id: actor.organizationId },
        data: { name, retainQueryText },
      })
    })
    await recordAudit({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: 'SETTINGS_CHANGED',
      subjectType: 'Organization',
      subjectId: actor.organizationId,
      ip: await requestIp(),
      userAgent: await requestUserAgent(),
      metadata: { retainQueryText },
    })

    revalidatePath('/settings')
    return { success: 'Practice settings saved.' }
  } catch (error) {
    return fail(error, 'We could not save those settings.')
  }
}

export async function inviteMemberAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const actor = await requireActor()
  requirePermission(actor, 'member:invite')

  const email = String(formData.get('email') ?? '')
  const role = String(formData.get('role') ?? 'MEMBER') as RoleKey

  try {
    const { token } = await inviteMember({
      organizationId: actor.organizationId,
      email,
      role,
    })

    await recordUsage({
      organizationId: actor.organizationId,
      userId: actor.userId,
      eventType: 'member.invited',
      metadata: { role },
    })

    await recordAudit({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: 'MEMBER_INVITED',
      subjectType: 'Invitation',
      ip: await requestIp(),
      metadata: { role },
    })

    revalidatePath('/settings')

    // Email delivery is not wired up yet, so the link is returned to the
    // inviter to pass on. See README, "What requires external credentials".
    const base = process.env.APP_URL ?? 'http://localhost:3000'
    return {
      success: `Invitation created for ${email}.`,
      invitationUrl: `${base}/accept-invitation?token=${token}`,
    }
  } catch (error) {
    return fail(error, 'We could not create that invitation.')
  }
}

export async function changeRoleAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const actor = await requireActor()
  requirePermission(actor, 'member:manage')

  try {
    await changeMemberRole({
      organizationId: actor.organizationId,
      membershipId: String(formData.get('membershipId') ?? ''),
      role: String(formData.get('role') ?? 'MEMBER') as RoleKey,
    })
    await recordAudit({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: 'MEMBER_ROLE_CHANGED',
      subjectType: 'Membership',
      subjectId: String(formData.get('membershipId') ?? ''),
      ip: await requestIp(),
      metadata: { role: String(formData.get('role') ?? '') },
    })

    revalidatePath('/settings')
    return { success: 'Role updated. That person will need to sign in again.' }
  } catch (error) {
    return fail(error, 'We could not change that role.')
  }
}

export async function removeMemberAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const actor = await requireActor()
  requirePermission(actor, 'member:manage')

  try {
    await removeMember({
      organizationId: actor.organizationId,
      membershipId: String(formData.get('membershipId') ?? ''),
    })
    await recordAudit({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: 'MEMBER_REMOVED',
      subjectType: 'Membership',
      subjectId: String(formData.get('membershipId') ?? ''),
      ip: await requestIp(),
    })

    revalidatePath('/settings')
    return { success: 'That person no longer has access.' }
  } catch (error) {
    return fail(error, 'We could not remove that member.')
  }
}
