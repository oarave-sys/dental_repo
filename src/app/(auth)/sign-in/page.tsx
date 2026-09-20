'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Card, FormBanner } from '@/components/ui'
import { signInAction, type FormState } from '../actions'
import { FieldFor, StateBanner, SubmitButton } from '../form-parts'

function SignInForm() {
  const [state, action] = useActionState<FormState, FormData>(signInAction, {})
  const params = useSearchParams()

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-2">Welcome back.</p>

      <form action={action} className="mt-5 space-y-4">
        {params.get('reset') === '1' && (
          <FormBanner tone="success">
            Your password has been reset. Sign in with your new password.
          </FormBanner>
        )}
        <StateBanner state={state} />

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="field"
          />
          <FieldFor state={state} name="email" />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">
              Password
            </label>
            <Link href="/forgot-password" className="mb-1.5 text-sm text-brand hover:underline">
              Forgot?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="field"
          />
          <FieldFor state={state} name="password" />
        </div>

        <SubmitButton>Sign in</SubmitButton>
      </form>

      <p className="mt-5 text-sm text-ink-2">
        New here?{' '}
        <Link href="/sign-up" className="font-medium text-brand hover:underline">
          Create a practice account
        </Link>
      </p>
    </Card>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={<Card className="p-6">Loading…</Card>}>
      <SignInForm />
    </Suspense>
  )
}
