import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui'
import { FindACode } from './client'

export const metadata: Metadata = { title: 'Find a Code' }

export default function FindACodePage() {
  return (
    <div>
      <PageHeader
        title="Find a Code"
        description="Describe the procedure. We identify the likely code, show the facts we used, and ask if something is missing."
      />
      <FindACode />
    </div>
  )
}
