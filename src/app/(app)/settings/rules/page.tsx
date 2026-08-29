import Link from 'next/link'
import { withAuthorizedQuery } from '@/lib/actions/guard'
import { Card, DataTable, EmptyState, formatDateTime } from '@/components/ui'
import { DispositionBadge, type TriageOutcome } from '@/components/ui/triage'
import { RuleSetControls } from './controls'
import { installPackAction, forkAction, publishAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Triage rules. The whole of the practice's policy, as data an administrator
 * can read and change without a deploy.
 */
export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ version?: string }>
}) {
  const { version } = await searchParams

  const { versions, selected } = await withAuthorizedQuery('config:manage', async ({ db }) => {
    const versions = await db.ruleSetVersion.findMany({
      orderBy: { version: 'desc' },
      select: {
        id: true, version: true, status: true, publishedAt: true,
        sourceRulePack: true, notes: true,
        _count: { select: { rules: true, requirements: true, payerRules: true, evaluations: true } },
      },
    })
    const target = version
      ? versions.find((v) => String(v.version) === version)
      : versions.find((v) => v.status === 'PUBLISHED') ?? versions[0]

    const selected = target
      ? await db.ruleSetVersion.findUnique({
          where: { id: target.id },
          include: {
            rules: { orderBy: [{ dimension: 'asc' }, { priority: 'asc' }], include: { actions: true } },
            requirements: { orderBy: { sortOrder: 'asc' } },
            payerRules: true,
          },
        })
      : null
    return { versions, selected }
  })

  if (versions.length === 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold text-ink">Triage rules</h1>
        <Card>
          <EmptyState
            title="No rule set installed yet."
            hint="Install the rheumatology pack to get the practice's starting rules, then review and publish them."
          />
          <div className="flex justify-center pb-2">
            <RuleSetControls mode="install" action={installPackAction} />
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Triage rules</h1>
          <p className="text-sm text-ink-3">
            Published versions are immutable. Editing creates a new draft; publishing
            freezes it and archives the previous one.
          </p>
        </div>
        <Link href="/settings/rules/simulator" className="btn-secondary">Simulator</Link>
      </div>

      <Card title="Versions">
        <DataTable head={['Version', 'Status', 'Rules', 'Requirements', 'Payer rules', 'Evaluations', 'Published', '']}>
          {versions.map((v) => (
            <tr key={v.id} className={selected?.id === v.id ? 'bg-surface-2' : ''}>
              <td className="tnum px-3 py-2">
                <Link href={`/settings/rules?version=${v.version}`} className="font-medium text-ink hover:text-brand hover:underline">
                  v{v.version}
                </Link>
              </td>
              <td className="px-3 py-2">
                <span className={
                  v.status === 'PUBLISHED' ? 'rounded bg-green-bg px-2 py-0.5 text-xs text-green'
                  : v.status === 'DRAFT' ? 'rounded bg-amber-bg px-2 py-0.5 text-xs text-amber'
                  : 'rounded bg-surface-2 px-2 py-0.5 text-xs text-ink-3'
                }>
                  {v.status.toLowerCase()}
                </span>
              </td>
              <td className="tnum px-3 py-2 text-ink-2">{v._count.rules}</td>
              <td className="tnum px-3 py-2 text-ink-2">{v._count.requirements}</td>
              <td className="tnum px-3 py-2 text-ink-2">{v._count.payerRules}</td>
              <td className="tnum px-3 py-2 text-ink-2">{v._count.evaluations}</td>
              <td className="px-3 py-2 text-xs text-ink-3">{formatDateTime(v.publishedAt)}</td>
              <td className="px-3 py-2">
                <RuleSetControls
                  mode={v.status === 'DRAFT' ? 'draft' : 'published'}
                  ruleSetVersionId={v.id}
                  version={v.version}
                  forkAction={forkAction}
                  publishAction={publishAction}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {selected && (
        <>
          <Card title={`Payer rules — v${selected.version}`}>
            {selected.payerRules.length === 0 ? (
              <EmptyState title="No payer restrictions." />
            ) : (
              <ul className="divide-y divide-rule text-sm">
                {selected.payerRules.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-ink">
                      {p.payerCategory
                        ? <>Any payer in category <span className="font-mono text-xs">{p.payerCategory}</span></>
                        : 'Specific payer'}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-ink-2">{p.rationale}</span>
                      <DispositionBadge outcome={p.outcome as TriageOutcome} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Required documentation — v${selected.version}`}>
            <DataTable head={['Item', 'Level', 'Applies to']}>
              {selected.requirements.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-ink">{r.label}</td>
                  <td className="px-3 py-2">
                    <span className={
                      r.level === 'REQUIRED'
                        ? 'rounded bg-red-bg px-2 py-0.5 text-xs text-red'
                        : 'rounded bg-surface-2 px-2 py-0.5 text-xs text-ink-2'
                    }>
                      {r.level.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {r.appliesToCategoryKey ?? 'Every referral'}
                  </td>
                </tr>
              ))}
            </DataTable>
            <p className="mt-2 text-xs text-ink-3">
              Only REQUIRED items hold up a referral. Recommended items are surfaced so staff
              can chase them, but a clinical suggestion is not practice policy.
            </p>
          </Card>

          <Card title={`Triage rules — v${selected.version}`}>
            <DataTable head={['Dimension', 'Rule', 'Priority', 'Outcome', 'Position', 'Rationale']}>
              {selected.rules.map((r) => {
                const condition = r.condition as { position?: string; type?: string }
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono text-[11px] uppercase text-ink-3">
                      {r.dimension.replaceAll('_', ' ')}
                    </td>
                    <td className="px-3 py-2 text-ink">{r.name}</td>
                    <td className="tnum px-3 py-2 text-ink-3">{r.priority}</td>
                    <td className="px-3 py-2"><DispositionBadge outcome={r.outcome as TriageOutcome} /></td>
                    <td className="px-3 py-2 text-xs">
                      {condition.position === 'PRIMARY' ? (
                        <span className="rounded bg-brand-soft px-2 py-0.5 text-brand">primary only</span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{r.rationale}</td>
                  </tr>
                )
              })}
            </DataTable>
            <p className="mt-2 text-xs text-ink-3">
              Every rule that declines a referral is marked <strong>primary only</strong>: it
              applies solely when that condition is the reason for referral. A category
              mentioned elsewhere in the packet is reported but never blocks.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
