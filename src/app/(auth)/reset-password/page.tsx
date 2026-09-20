'use client'

import { Suspense } from 'react'
import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, FormBanner } from '@/components/ui'
import { resetPasswordAction, type FormState } from '../actions'
import { FieldFor, StateBanner, SubmitButton } from '../form-parts'

function ResetForm() {
  const [state, action] = useActionState<FormState, FormData>(resetPasswordAction, {})
  const token = useSearchParams().get('token') ?? ''

  if (!token) {
    return (
      <Card className="p-6">
        <FormBanner tone="error">
          That reset link is missing its token. Request a new one.
        </FormBanner>
        <p className="mt-4 text-sm">
          <Link href="/forgot-password" className="font-medium text-brand hover:underline">
            Request a new reset link
          </Link>
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Choose a new password</h1>

      <form action={action} className="mt-5 space-y-4">
        <StateBanner state={state} />
        <input type="hidden" name="token" value={token} />

        <div>
          <label className="label" htmlFor="password">
            New password
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

        <SubmitButton>Set new password</SubmitButton>
      </form>
      <p className="mt-4 text-[13px] text-ink-3">
        Setting a new password signs you out everywhere else.
      </p>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card className="p-6">Loading…</Card>}>
      <ResetForm />
    </Suspense>
  )
}
