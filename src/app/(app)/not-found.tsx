import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-ink">Not found</h1>
      <p className="mt-2 text-sm text-ink-2">
        This record does not exist, or it belongs to another organization.
      </p>
      <Link href="/referrals" className="btn-primary mt-5 inline-flex">Back to referrals</Link>
    </div>
  )
}
