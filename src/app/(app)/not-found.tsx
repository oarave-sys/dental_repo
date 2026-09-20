import Link from 'next/link'
import { Card } from '@/components/ui'

export default function NotFound() {
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink">Not found</h1>
      <p className="mt-1 text-[15px] text-ink-2">That page does not exist.</p>
      <Link href="/dashboard" className="btn-secondary mt-4">
        Back to dashboard
      </Link>
    </Card>
  )
}
