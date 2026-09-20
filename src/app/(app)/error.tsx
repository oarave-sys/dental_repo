'use client'

import { Card } from '@/components/ui'

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="mt-1 text-[15px] text-ink-2">
        That action could not be completed. Nothing was saved.
      </p>
      <button type="button" onClick={reset} className="btn-secondary mt-4">
        Try again
      </button>
    </Card>
  )
}
