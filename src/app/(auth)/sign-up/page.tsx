'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Card } from '@/components/ui'
import { signUpAction, type FormState } from '../actions'
import { FieldFor, StateBanner, SubmitButton } from '../form-parts'

export default function SignUpPage() {
  const [state, action] = useActionState<FormState, FormData>(signUpAction, {})

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Create your practice</h1>
      <p className="mt-1 text-sm text-ink-2">
        You will be the owner of this account and can invite your team afterwards.
      </p>

      <form action={action} className="mt-5 space-y-4">
        <StateBanner state={state} />

        <div>
          <label className="label" htmlFor="practiceName">
            Practice name
          </label>
          <input
            id="practiceName"
            name="practiceName"
            required
            autoComplete="organization"
            className="field"
            placeholder="Riverside Family Dental"
          />
          <FieldFor state={state} name="practiceName" />
        </div>

        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input id="name" name="name" required autoComplete="name" className="field" />
          <FieldFor state={state} name="name" />
        </div>

        <div>
          <label className="label" htmlFor="email">
            Work email
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

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={12}
            className="field"
          />
          <p className="hint">At least 12 characters. Longer is better than complicated.</p>
          <FieldFor state={state} name="password" />
        </div>

        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="mt-5 text-sm text-ink-2">
        Already have an account?{' '}
        <Link href="/sign-in" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  )
}
