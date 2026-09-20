import type { Metadata } from 'next'
import { PageHeader } from '@/components/ui'
import { DocumentationCheck } from './client'

export const metadata: Metadata = { title: 'Documentation Check' }

export default function DocumentationCheckPage() {
  return (
    <div>
      <PageHeader
        title="Documentation Check"
        description="Paste a clinical note. We show which coding-relevant details are present, which are missing, and what the note supports."
      />
      <DocumentationCheck />
    </div>
  )
}
