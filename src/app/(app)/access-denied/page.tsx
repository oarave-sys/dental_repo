import Link from 'next/link'

/**
 * A permission denial is a normal outcome, not a crash. It gets its own page so
 * the user is told plainly rather than shown a generic error — and so the
 * message never hints at what the record contains.
 */
export default function AccessDeniedPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-ink">You do not have access to this</h1>
      <p className="mt-2 text-sm text-ink-2">
        Your role does not include this area. If you need it, ask an administrator
        to change your access.
      </p>
      <Link href="/" className="btn-primary mt-5 inline-flex">Back to dashboard</Link>
    </div>
  )
}
