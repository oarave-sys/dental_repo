import { withAuthorizedQuery } from '@/lib/actions/guard'
import { Breadcrumb } from '@/components/ui'
import { IntakeForm } from './form'
import { checkDuplicatesAction, createReferralAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function NewReferralPage() {
  const options = await withAuthorizedQuery('referral:create', async ({ db }) => {
    const [offices, providers, payers] = await Promise.all([
      db.referringOrganization.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      db.referringProvider.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, referringOrganizationId: true },
        orderBy: { lastName: 'asc' },
      }),
      db.payer.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])
    return {
      offices,
      providers: providers.map((p) => ({
        id: p.id,
        name: `${p.lastName}, ${p.firstName}`,
        officeId: p.referringOrganizationId,
      })),
      payers,
    }
  })

  return (
    <div className="max-w-3xl space-y-4">
      <Breadcrumb items={[{ label: 'Referrals', href: '/referrals' }, { label: 'New referral' }]} />
      <div>
        <h1 className="text-lg font-semibold text-ink">Add a referral</h1>
        <p className="text-sm text-ink-3">
          This creates a staging record. No chart is created in the EHR.
        </p>
      </div>
      <IntakeForm
        options={options}
        checkDuplicates={checkDuplicatesAction}
        createReferral={createReferralAction}
      />
    </div>
  )
}
