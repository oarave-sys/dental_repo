'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Card, FormBanner, SectionTitle } from '@/components/ui'
import { ROLE_LABELS, type RoleKey } from '@/lib/authz'
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  updatePracticeAction,
  type SettingsState,
} from './actions'

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Saving…' : children}
    </button>
  )
}

function Banner({ state }: { state: SettingsState }) {
  if (state.error) return <FormBanner tone="error">{state.error}</FormBanner>
  if (state.success) {
    return (
      <FormBanner tone="success">
        <p>{state.success}</p>
        {state.invitationUrl && (
          <>
            <p className="mt-2">
              Email delivery is not configured yet, so send them this link yourself:
            </p>
            <code className="mt-1.5 block break-all rounded bg-white/70 px-2 py-1.5 text-xs">
              {state.invitationUrl}
            </code>
          </>
        )}
      </FormBanner>
    )
  }
  return null
}

export function PracticeForm({
  name,
  retainQueryText,
}: {
  name: string
  retainQueryText: boolean
}) {
  const [state, action] = useActionState<SettingsState, FormData>(updatePracticeAction, {})

  return (
    <Card className="p-5">
      <SectionTitle>Practice</SectionTitle>
      <form action={action} className="mt-3 space-y-4">
        <Banner state={state} />

        <div>
          <label className="label" htmlFor="name">
            Practice name
          </label>
          <input id="name" name="name" defaultValue={name} required className="field" />
        </div>

        <div className="rounded-lg border border-rule bg-surface-2/50 p-3.5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="retainQueryText"
              defaultChecked={retainQueryText}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="block text-sm font-medium text-ink">
                Keep the text of searches
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">
                Descriptions and notes are stored so your team can reopen past searches. Turn this
                off and only the structured result is kept — history still works, but the original
                wording is discarded once the answer is produced.
              </span>
            </span>
          </label>
        </div>

        <Submit>Save practice settings</Submit>
      </form>
    </Card>
  )
}

export interface MemberRow {
  membershipId: string
  name: string
  email: string
  role: RoleKey
  isSelf: boolean
}

export function MembersPanel({
  members,
  canManage,
  canInvite,
}: {
  members: MemberRow[]
  canManage: boolean
  canInvite: boolean
}) {
  const [inviteState, invite] = useActionState<SettingsState, FormData>(inviteMemberAction, {})
  const [roleState, changeRole] = useActionState<SettingsState, FormData>(changeRoleAction, {})
  const [removeState, remove] = useActionState<SettingsState, FormData>(removeMemberAction, {})

  return (
    <Card className="p-5">
      <SectionTitle>Team</SectionTitle>

      <div className="mt-3 space-y-3">
        <Banner state={roleState} />
        <Banner state={removeState} />
      </div>

      <ul className="mt-3 divide-y divide-rule">
        {members.map((member) => (
          <li
            key={member.membershipId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {member.name}
                {member.isSelf && <span className="ml-1.5 text-xs text-ink-3">(you)</span>}
              </p>
              <p className="text-xs text-ink-3">{member.email}</p>
            </div>

            {canManage && !member.isSelf ? (
              <div className="flex items-center gap-2">
                <form action={changeRole} className="flex items-center gap-2">
                  <input type="hidden" name="membershipId" value={member.membershipId} />
                  <select
                    name="role"
                    defaultValue={member.role}
                    className="field w-auto py-1.5 text-sm"
                  >
                    {(['OWNER', 'ADMIN', 'MEMBER'] as RoleKey[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn-secondary btn-sm">
                    Update
                  </button>
                </form>
                <form action={remove}>
                  <input type="hidden" name="membershipId" value={member.membershipId} />
                  <button type="submit" className="btn-ghost btn-sm text-low hover:bg-low-bg">
                    Remove
                  </button>
                </form>
              </div>
            ) : (
              <span className="text-sm text-ink-2">{ROLE_LABELS[member.role]}</span>
            )}
          </li>
        ))}
      </ul>

      {canInvite && (
        <form action={invite} className="mt-5 space-y-3 border-t border-rule pt-5">
          <SectionTitle>Invite someone</SectionTitle>
          <Banner state={inviteState} />

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label className="label sr-only" htmlFor="invite-email">
                Email
              </label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                className="field"
                placeholder="colleague@practice.com"
              />
            </div>
            <select name="role" defaultValue="MEMBER" className="field sm:w-40">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <Submit>Send invite</Submit>
          </div>
          <p className="hint">
            Members use the coding tools and see their own history. Admins also manage the team
            and see everyone&rsquo;s searches.
          </p>
        </form>
      )}
    </Card>
  )
}
