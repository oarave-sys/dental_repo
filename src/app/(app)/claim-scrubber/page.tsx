import Link from 'next/link'
import type { Metadata } from 'next'
import { Card, PageHeader, SectionTitle, ToolIcon } from '@/components/ui'
import { toolByKey } from '@/lib/tools/registry'

export const metadata: Metadata = { title: 'Claim Scrubber' }

/**
 * Not yet built, and says so.
 *
 * The page exists because the tool is in the registry and the registry drives
 * the navigation — a link that 404s would be worse than a page that explains
 * itself. There are no controls here, because a button that does nothing is
 * the thing this page is designed to avoid.
 */
export default function ClaimScrubberPage() {
  const tool = toolByKey('CLAIM_SCRUBBER')

  return (
    <div>
      <PageHeader title="Claim Scrubber" description={tool?.tagline} />

      <Card className="p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
          <ToolIcon name="shield" className="h-6 w-6" />
        </span>

        <h2 className="mt-4 text-[15px] font-semibold text-ink">Not available yet</h2>
        <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-ink-2">
          Claim Scrubber will take the procedures and codes being prepared for submission,
          together with the supporting documentation, and flag possible problems before the claim
          goes out — a surface count that disagrees with the selected code, a tooth documented
          without its surfaces, a code that the note does not support.
        </p>

        <div className="mt-5 border-t border-rule pt-4">
          <SectionTitle>Until then</SectionTitle>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            Documentation Check already performs the same comparison for a single note: paste the
            note, enter the codes you intend to submit, and it will flag anything inconsistent
            between them.
          </p>
          <Link href="/documentation-check" className="btn-secondary mt-4">
            Open Documentation Check
          </Link>
        </div>
      </Card>
    </div>
  )
}
