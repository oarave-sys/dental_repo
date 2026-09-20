'use client'

import { useFormStatus } from 'react-dom'
import { FieldError, FormBanner } from '@/components/ui'
import type { FormState } from './actions'

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Working…' : children}
    </button>
  )
}

export function StateBanner({ state }: { state: FormState }) {
  if (state.success) return <FormBanner tone="success">{state.success}</FormBanner>
  // A field-specific error is rendered next to its field instead.
  if (state.error && !state.field) return <FormBanner tone="error">{state.error}</FormBanner>
  return null
}

export function FieldFor({ state, name }: { state: FormState; name: string }) {
  return <FieldError message={state.field === name ? state.error : null} />
}
