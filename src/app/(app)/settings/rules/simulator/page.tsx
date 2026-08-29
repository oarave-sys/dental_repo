import { withAuthorizedQuery } from '@/lib/actions/guard'
import { Breadcrumb, Card } from '@/components/ui'
import { SimulatorPanel } from './panel'
import { simulateAction } from '../actions'

export const dynamic = 'force-dynamic'

/**
 * The safety feature that makes rule editing by a non-engineer viable: see what
 * a draft would change across real referrals BEFORE publishing it, rather than
 * discovering it afterwards in the inbox.
 */
export default async function SimulatorPage() {
  const versions = await withAuthorizedQuery('config:manage', ({ db }) =>
    db.ruleSetVersion.findMany({
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true },
    }),
  )

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: 'Triage rules', href: '/settings/rules' }, { label: 'Simulator' }]} />
      <div>
        <h1 className="text-lg font-semibold text-ink">Rule simulator</h1>
        <p className="text-sm text-ink-3">
          Runs a rule set against recent referrals and shows what would change. Nothing is
          saved and no referral is altered.
        </p>
      </div>

      {versions.length === 0 ? (
        <Card><p className="text-sm text-ink-2">No rule sets to simulate yet.</p></Card>
      ) : (
        <SimulatorPanel versions={versions} action={simulateAction} />
      )}
    </div>
  )
}
