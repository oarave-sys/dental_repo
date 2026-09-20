'use client'

import { Suspense } from 'react'
import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, FormBanner } from '@/components/ui'
import { acceptInvitationAction, type FormState } from '../actions'
import { FieldFor, StateBanner, SubmitButton } from '../form-parts'

function AcceptForm() {
  const [state, action] = useActionState<FormState, FormData>(acceptInvitationAction, {})
  const token = useSearchParams().get('token') ?? ''

  if (!token) {
    return (
      <Card className="p-6">
        <FormBanner tone="error">
          That invitation link is missing its token. Ask an admin at your practice to send a new
          one.
        </FormBanner>
        <p className="mt-4 text-sm">
          <Link href="/sign-in" className="font-medium text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Join your practice</h1>
      <p className="mt-1 text-sm text-ink-2">Set a password to finish setting up your account.</p>

      <form action={action} className="mt-5 space-y-4">
        <StateBanner state={state} />
        <input type="hidden" name="token" value={token} />

        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input id="name" name="name" required autoComplete="name" className="field" />
          <FieldFor state={state} name="name" />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className="field"
          />
          <p className="hint">At least 12 characters.</p>
          <FieldFor state={state} name="password" />
        </div>

        <SubmitButton>Join practice</SubmitButton>
      </form>
    </Card>
  )
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<Card className="p-6">Loading…</Card>}>
      <AcceptForm />
    </Suspense>
  )
}
