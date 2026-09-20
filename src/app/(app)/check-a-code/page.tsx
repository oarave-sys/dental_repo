import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui'
import { CheckACode } from './client'

export const metadata: Metadata = { title: 'Check a Code' }

export default function CheckACodePage() {
  return (
    <div>
      <PageHeader
        title="Check a Code"
        description="Look up what a code covers, what it is commonly confused with, and whether it matches what you documented."
      />
      <CheckACode />
    </div>
  )
}
