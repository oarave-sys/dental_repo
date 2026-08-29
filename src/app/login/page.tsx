'use client'

import { useActionState } from 'react'
import { signIn, type FormState } from './actions'
import { Field } from '@/components/ui'

export default function LoginPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {})

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-ink">Referral OS</h1>
          <p className="mt-1 text-sm text-ink-3">Sign in to continue.</p>
        </div>

        <form action={action} className="card space-y-4 p-5">
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required autoFocus className="field" />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autoComplete="current-password" required className="field" />
          </Field>

          {state.error && (
            <p role="alert" className="rounded bg-red-bg px-3 py-2 text-sm text-red">{state.error}</p>
          )}

          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-xs text-ink-3">
            You will be asked for a code from your authenticator app next.
          </p>
        </form>
      </div>
    </main>
  )
}
