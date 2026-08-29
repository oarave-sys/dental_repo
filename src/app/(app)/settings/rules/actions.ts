'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withAuthorizedAction } from '@/lib/actions/guard'
import { installRulePack, publishRuleSet, forkRuleSet } from '@/lib/services/rule-packs'
import { simulateRuleSet } from '@/lib/services/triage'
import { rheumatologyRulePack } from '@/lib/rule-packs/rheumatology'

export const installPackAction = withAuthorizedAction({
  name: 'rules.installPack',
  permission: 'config:manage',
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const result = await installRulePack(ctx, rheumatologyRulePack)
    revalidatePath('/settings/rules')
    return result
  },
})

export const forkAction = withAuthorizedAction({
  name: 'rules.fork',
  permission: 'config:manage',
  schema: z.object({ ruleSetVersionId: z.uuid() }),
  handler: async (input, ctx) => {
    const result = await forkRuleSet(ctx, input.ruleSetVersionId)
    revalidatePath('/settings/rules')
    return result
  },
})

export const publishAction = withAuthorizedAction({
  name: 'rules.publish',
  permission: 'config:manage',
  schema: z.object({ ruleSetVersionId: z.uuid() }),
  handler: async (input, ctx) => {
    await publishRuleSet(ctx, input.ruleSetVersionId)
    revalidatePath('/settings/rules')
    return { ok: true }
  },
})

/** Dry run. Persists nothing — that is the whole point. */
export const simulateAction = withAuthorizedAction({
  name: 'rules.simulate',
  permission: 'config:manage',
  schema: z.object({ ruleSetVersionId: z.uuid() }),
  handler: async (input, ctx) =>
    simulateRuleSet(ctx.db, ctx.actor.organizationId, {
      ruleSetVersionId: input.ruleSetVersionId,
      limit: 200,
    }),
})
