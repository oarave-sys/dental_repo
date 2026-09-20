'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Card } from '@/components/ui'
import { forgotPasswordAction, type FormState } from '../actions'
import { FieldFor, StateBanner, SubmitButton } from '../form-parts'

export default function ForgotPasswordPage() {
  const [state, action] = useActionState<FormState, FormData>(forgotPasswordAction, {})

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-2">
        Enter your email address and we will send you a reset link.
      </p>

      <form action={action} className="mt-5 space-y-4">
        <StateBanner state={state} />

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field"
          />
          <FieldFor state={state} name="email" />
        </div>

        <SubmitButton>Send reset link</SubmitButton>
      </form>

      <p className="mt-5 text-sm text-ink-2">
        <Link href="/sign-in" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  )
}
