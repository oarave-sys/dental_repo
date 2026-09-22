import Link from 'next/link'
import type { Metadata } from 'next'
import { requireActor } from '@/lib/auth/current'
import { ROLE_LABELS, can, type RoleKey } from '@/lib/authz'
import { withTenant } from '@/lib/db/client'
import { PLAN, TRIAL_DAYS, subscriptionFor } from '@/lib/billing'
import { codeRepository } from '@/lib/codes'
import { aiConfigured } from '@/lib/coding/ai'
import { Badge, Card, PageHeader, SectionTitle } from '@/components/ui'
import { MembersPanel, PracticeForm, type MemberRow } from './client'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const actor = await requireActor()

  const [organization, members, subscription, dataset] = await Promise.all([
    withTenant(actor.organizationId, (db) =>
      db.organization.findUnique({ where: { id: actor.organizationId } }),
    ).catch(() => null),
    withTenant(actor.organizationId, (db) =>
      db.membership.findMany({
        where: { status: 'ACTIVE' },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ).catch(() => []),
    subscriptionFor(actor.organizationId).catch(() => null),
    codeRepository().info().catch(() => null),
  ])

  const rows: MemberRow[] = members.map((m) => ({
    membershipId: m.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role as RoleKey,
    isSelf: m.userId === actor.userId,
  }))

  return (
    <div>
      <PageHeader title="Settings" description={`You are signed in as ${ROLE_LABELS[actor.role]}.`} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {can(actor, 'org:manage') && organization ? (
            <PracticeForm
              name={organization.name}
              retainQueryText={organization.retainQueryText}
            />
          ) : (
            <Card className="p-5">
              <SectionTitle>Practice</SectionTitle>
              <p className="mt-2 text-[15px] text-ink">{organization?.name ?? '—'}</p>
              <p className="mt-1 text-sm text-ink-3">
                Only owners and admins can change practice settings.
              </p>
            </Card>
          )}

          <MembersPanel
            members={rows}
            canManage={can(actor, 'member:manage')}
            canInvite={can(actor, 'member:invite')}
          />
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Plan</SectionTitle>
            <p className="mt-2 text-[15px] font-medium text-ink">{PLAN.name}</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">
              ${(PLAN.unitAmountCents / 100).toFixed(0)}
              <span className="text-base font-normal text-ink-3">/{PLAN.interval}</span>
            </p>
            <p className="mt-1 text-sm text-ink-2">{PLAN.description}</p>

            {subscription && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone={subscription.status === 'ACTIVE' ? 'high' : 'medium'}>
                  {subscription.statusLabel}
                </Badge>
                {subscription.trialDaysRemaining !== null && subscription.status === 'TRIALING' && (
                  <span className="text-sm text-ink-2">
                    {subscription.trialDaysRemaining} day
                    {subscription.trialDaysRemaining === 1 ? '' : 's'} left
                  </span>
                )}
              </div>
            )}

            <ul className="mt-4 space-y-1.5">
              {PLAN.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-ink-2">
                  <span aria-hidden className="mt-px text-high">
                    &#10003;
                  </span>
                  {feature}
                </li>
              ))}
            </ul>

            <p className="mt-4 border-t border-rule pt-3 text-[13px] leading-relaxed text-ink-3">
              Payment is not collected yet. Every practice starts with a {TRIAL_DAYS}-day trial,
              and billing will be enabled before any charge is made.
            </p>
          </Card>

          <Card className="p-5">
            <SectionTitle>System</SectionTitle>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Code dataset</dt>
                <dd className="text-right text-ink-2">
                  {dataset ? `${dataset.codeCount} codes` : 'unavailable'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Dataset type</dt>
                <dd className="text-right">
                  <Badge tone={dataset?.kind === 'LICENSED' ? 'high' : 'medium'}>
                    {dataset?.kind === 'LICENSED' ? 'Licensed' : 'Demo sample'}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Language model</dt>
                <dd className="text-right">
                  <Badge tone={aiConfigured() ? 'high' : 'neutral'}>
                    {aiConfigured() ? 'Connected' : 'Rules only'}
                  </Badge>
                </dd>
              </div>
            </dl>
            {!aiConfigured() && (
              <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
                Without an <code>ANTHROPIC_API_KEY</code>, shorthand still works through the rules
                engine. Longer free-text notes benefit from the model.
              </p>
            )}
          </Card>

          {can(actor, 'org:manage') && (
            <Card className="p-5">
              <SectionTitle>Audit log</SectionTitle>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                Who opened which search, and who changed the team. Entries cannot be edited or
                deleted.
              </p>
              <Link href="/settings/audit" className="btn-secondary btn-sm mt-3">
                View audit log
              </Link>
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle>Privacy</SectionTitle>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
              This product is not configured to handle protected health information. Ask your team
              not to enter patient names, dates of birth, member IDs or chart numbers.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
