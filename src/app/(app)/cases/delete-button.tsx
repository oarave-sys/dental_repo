'use client'

import { useActionState } from 'react'
import { deleteCaseAction, type CaseActionState } from './actions'

export function DeleteCaseButton({ caseId }: { caseId: string }) {
  const [state, action] = useActionState<CaseActionState, FormData>(deleteCaseAction, {})

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="caseId" value={caseId} />
      <button
        type="submit"
        className="btn-ghost btn-sm text-low hover:bg-low-bg"
        aria-label="Delete this case"
      >
        Delete
      </button>
      {state.error && <p className="mt-1 text-xs text-low">{state.error}</p>}
    </form>
  )
}
