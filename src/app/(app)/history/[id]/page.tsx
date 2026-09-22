import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { requireActor } from '@/lib/auth/current'
import { can } from '@/lib/authz'
import { loadQuery } from '@/lib/coding/queries'
import { toolName } from '@/lib/tools/registry'
import { BackLink, Card, PageHeader, SectionTitle } from '@/components/ui'
import { CodingResultView } from '@/components/coding-result'
import type { CodingResult } from '@/lib/coding/result'

export const metadata: Metadata = { title: 'Search' }
export const dynamic = 'force-dynamic'

export default async function QueryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const actor = await requireActor()

  // Opening someone's clinical description is exactly what an audit log exists
  // to record, so the viewer is passed in.
  const query = await loadQuery(actor.organizationId, id, { userId: actor.userId }).catch(
    () => null,
  )
  if (!query) notFound()

  // A member can reopen their own work; seeing a colleague's needs the
  // practice-wide permission.
  if (query.userId !== actor.userId && !can(actor, 'history:read_all')) notFound()

  const result = query.result as unknown as CodingResult | null
  const userMessage = query.messages.find((m) => m.role === 'USER')
  const answers = query.messages.filter((m) => m.role === 'USER_ANSWER')
  const questions = query.messages.filter((m) => m.role === 'ASSISTANT_QUESTION')

  return (
    <div>
      <div className="mb-4">
        <BackLink href="/history">Back to history</BackLink>
      </div>

      <PageHeader
        title={query.displayLabel ?? 'Search'}
        description={`${toolName(query.tool)} · ${query.user.name} · ${query.createdAt.toLocaleString()}`}
      />

      <div className="space-y-5">
        <Card className="p-5">
          <SectionTitle>What was entered</SectionTitle>
          {userMessage ? (
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">
              {userMessage.content}
            </p>
          ) : (
            <p className="mt-2 text-sm text-ink-3">
              The description was not retained. Your practice has input retention turned off.
            </p>
          )}

          {questions.length > 0 && (
            <div className="mt-4 border-t border-rule pt-4">
              <SectionTitle>Clarifications</SectionTitle>
              <ul className="mt-2 space-y-2.5">
                {questions.map((question, i) => (
                  <li key={question.id} className="text-sm">
                    <p className="text-ink-2">{question.content}</p>
                    {answers[i] && (
                      <p className="mt-0.5 font-medium text-ink">{answers[i]?.content}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {result ? (
          <CodingResultView result={result} />
        ) : (
          <Card className="p-5">
            <p className="text-sm text-ink-2">No result was stored for this search.</p>
          </Card>
        )}
      </div>
    </div>
  )
}
