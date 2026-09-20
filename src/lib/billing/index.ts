import { withTenant } from '@/lib/db/client'

/**
 * Billing.
 *
 * Stripe is not connected in the MVP, and this module is deliberately the only
 * place that would need to change when it is. The subscription row already
 * holds every field a Stripe webhook writes (customer, subscription and price
 * IDs, status, period end), so connecting Stripe means adding a webhook route
 * that updates those columns — not reshaping the application.
 *
 * Required environment variables when that happens:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID
 */

export const PLAN = {
  name: 'Dental Coding Assistant',
  /** Cents, so the displayed price never depends on a float. */
  unitAmountCents: 9900,
  currency: 'usd',
  interval: 'month',
  description: 'Per dental office. Unlimited users at the practice.',
  features: [
    'Find a Code, Check a Code and Documentation Check',
    'Unlimited team members at one practice',
    'Shared search history and saved cases',
    'Claim Scrubber when it ships',
  ],
} as const

export const TRIAL_DAYS = 14

export function formatPlanPrice(): string {
  return `$${(PLAN.unitAmountCents / 100).toFixed(0)}/${PLAN.interval}`
}

export interface SubscriptionView {
  plan: string
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED'
  statusLabel: string
  trialEndsAt: Date | null
  trialDaysRemaining: number | null
  currentPeriodEnd: Date | null
  priceLabel: string
  /** True once Stripe is connected for this organization. */
  stripeConnected: boolean
}

const STATUS_LABELS: Record<SubscriptionView['status'], string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment overdue',
  CANCELED: 'Canceled',
}

export async function subscriptionFor(organizationId: string): Promise<SubscriptionView | null> {
  return withTenant(organizationId, async (db) => {
    const row = await db.subscription.findUnique({ where: { organizationId } })
    if (!row) return null

    const trialDaysRemaining = row.trialEndsAt
      ? Math.max(0, Math.ceil((row.trialEndsAt.getTime() - Date.now()) / 86_400_000))
      : null

    return {
      plan: PLAN.name,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status],
      trialEndsAt: row.trialEndsAt,
      trialDaysRemaining,
      currentPeriodEnd: row.currentPeriodEnd,
      priceLabel: formatPlanPrice(),
      stripeConnected: Boolean(row.stripeSubscriptionId),
    }
  })
}

/** Whether the organization may use the coding tools right now. */
export function subscriptionAllowsAccess(subscription: SubscriptionView | null): boolean {
  if (!subscription) return true // no billing configured yet
  if (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') return true
  // Past-due keeps working; cutting a practice off mid-day is worse than
  // carrying an unpaid invoice for a few days. Canceled does not.
  return subscription.status === 'PAST_DUE'
}
