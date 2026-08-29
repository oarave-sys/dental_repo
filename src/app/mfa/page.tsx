'use client'

import { useActionState } from 'react'
import { verifyMfa, type FormState } from '../login/actions'
import { Field } from '@/components/ui'

export default function MfaPage() {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyMfa, {})

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-ink">Authentication code</h1>
          <p className="mt-1 text-sm text-ink-3">
            Enter the six-digit code from your authenticator app.
          </p>
        </div>

        <form action={action} className="card space-y-4 p-5">
          <Field label="Code">
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              className="field tnum text-center text-lg tracking-[0.4em]"
            />
          </Field>

          {state.error && (
            <p role="alert" className="rounded bg-red-bg px-3 py-2 text-sm text-red">{state.error}</p>
          )}

          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </main>
  )
}
