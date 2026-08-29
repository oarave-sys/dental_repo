'use client'

import Link from 'next/link'
import { useEffect } from 'react'

/**
 * Errors never surface their message: it may carry PHI from a driver error.
 * The digest is enough to correlate with the server log.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Intentionally not logging the error object here — the server already did,
    // through the PHI-safe logger.
  }, [error])

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">
        Nothing was saved. Try again, and tell an administrator if it keeps happening.
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-ink-3">Reference {error.digest}</p>
      )}
      <div className="mt-5 flex justify-center gap-2">
        <button onClick={reset} className="btn-primary">Try again</button>
        <Link href="/" className="btn-secondary">Back to dashboard</Link>
      </div>
    </div>
  )
}
