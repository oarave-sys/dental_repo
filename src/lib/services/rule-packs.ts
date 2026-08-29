import type { TenantDb } from '@/lib/db/client'
import type { Actor } from '@/lib/authz'
import type { AuditInput } from '@/lib/audit'
import type { RulePack } from '@/lib/rule-packs/types'
import { conflict, notFound } from '@/lib/errors'

interface Ctx {
  db: TenantDb
  actor: Actor
  audit: (input: AuditInput) => void
  now?: Date
}

/**
 * Installs a specialty rule pack into an organization as a DRAFT version.
 *
 * Nothing is published automatically: an administrator reviews the rules,
 * simulates them against history, and publishes deliberately. A rule set that
 * appeared and started routing patients without anyone looking at it would be
 * exactly the failure mode the versioning exists to prevent.
 */
export async function installRulePack(
  ctx: Ctx,
  pack: RulePack,
): Promise<{ ruleSetVersionId: string; version: number }> {
  const orgId = ctx.actor.organizationId

  // Categories, code maps and synonyms are organization-level reference data,
  // not versioned policy — a rule refers to a category by key.
  for (const category of pack.categories) {
    const existing = await ctx.db.referralCategory.findFirst({
      where: { key: category.key },
      select: { id: true },
    })
    const categoryId = existing
      ? existing.id
      : (
          await ctx.db.referralCategory.create({
            data: {
              organizationId: orgId,
              key: category.key,
              name: category.name,
              description: category.description ?? null,
              specialty: pack.specialty,
              sortOrder: category.sortOrder,
            },
            select: { id: true },
          })
        ).id

    if (!existing) {
      for (const map of category.codeMaps) {
        await ctx.db.referralCategoryCodeMap.create({
          data: {
            organizationId: orgId,
            categoryId,
            matchType: map.matchType,
            value: map.value,
            valueTo: map.valueTo ?? null,
            weight: map.weight ?? 100,
            specificityNote: map.specificityNote ?? null,
          },
        })
      }
      for (const synonym of category.synonyms) {
        await ctx.db.diagnosisSynonym.create({
          data: {
            organizationId: orgId,
            categoryId,
            term: synonym.term,
            termNormalized: synonym.term.toLowerCase().trim(),
            matchMode: synonym.matchMode ?? 'PHRASE',
            weight: synonym.weight ?? 60,
          },
        })
      }
    }
  }

  const latest = await ctx.db.ruleSetVersion.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const version = (latest?.version ?? 0) + 1

  const ruleSet = await ctx.db.ruleSetVersion.create({
    data: {
      organizationId: orgId,
      version,
      status: 'DRAFT',
      sourceRulePack: `${pack.key}@${pack.version}`,
      notes: pack.notes,
    },
    select: { id: true },
  })

  for (const rule of pack.rules) {
    const created = await ctx.db.triageRule.create({
      data: {
        organizationId: orgId,
        ruleSetVersionId: ruleSet.id,
        dimension: rule.dimension,
        name: rule.name,
        priority: rule.priority,
        condition: rule.condition as never,
        outcome: rule.outcome,
        blocking: rule.blocking ?? false,
        rationale: rule.rationale,
      },
      select: { id: true },
    })
    for (const action of rule.actions ?? []) {
      await ctx.db.triageRuleAction.create({
        data: {
          organizationId: orgId,
          triageRuleId: created.id,
          type: action.type,
          params: (action.params ?? undefined) as never,
        },
      })
    }
  }

  for (const requirement of pack.requirements) {
    await ctx.db.requirementDefinition.create({
      data: {
        organizationId: orgId,
        ruleSetVersionId: ruleSet.id,
        key: requirement.key,
        label: requirement.label,
        level: requirement.level,
        appliesToCategoryKey: requirement.appliesToCategoryKey ?? null,
        detector: (requirement.detector ?? undefined) as never,
        sortOrder: requirement.sortOrder,
      },
    })
  }

  for (const payerRule of pack.payerRules) {
    const payer = payerRule.payerName
      ? await ctx.db.payer.findFirst({ where: { name: payerRule.payerName }, select: { id: true } })
      : null
    await ctx.db.payerRule.create({
      data: {
        organizationId: orgId,
        ruleSetVersionId: ruleSet.id,
        payerId: payer?.id ?? null,
        payerCategory: payerRule.payerCategory ?? null,
        outcome: payerRule.outcome,
        rationale: payerRule.rationale,
      },
    })
  }

  ctx.audit({
    action: 'CONFIG_CHANGE',
    resourceType: 'rule_set_version',
    resourceId: ruleSet.id,
    metadata: {
      rulePack: `${pack.key}@${pack.version}`,
      version,
      rules: pack.rules.length,
      requirements: pack.requirements.length,
    },
  })

  return { ruleSetVersionId: ruleSet.id, version }
}

/** Publishing freezes a draft. Published versions are never edited in place. */
export async function publishRuleSet(
  ctx: Ctx,
  ruleSetVersionId: string,
): Promise<void> {
  const draft = await ctx.db.ruleSetVersion.findUnique({
    where: { id: ruleSetVersionId },
    select: { id: true, status: true, version: true },
  })
  if (!draft) throw notFound('That rule set no longer exists.')
  if (draft.status !== 'DRAFT') throw conflict('Only a draft can be published.')

  await ctx.db.ruleSetVersion.updateMany({
    where: { status: 'PUBLISHED' },
    data: { status: 'ARCHIVED' },
  })
  await ctx.db.ruleSetVersion.update({
    where: { id: ruleSetVersionId },
    data: {
      status: 'PUBLISHED',
      publishedAt: ctx.now ?? new Date(),
      publishedByUserId: ctx.actor.userId,
    },
  })

  ctx.audit({
    action: 'RULE_PUBLISH',
    resourceType: 'rule_set_version',
    resourceId: ruleSetVersionId,
    metadata: { version: draft.version },
  })
}

/**
 * Copy-on-write: editing a published version produces a new draft rather than
 * mutating policy that historical evaluations already point at.
 */
export async function forkRuleSet(
  ctx: Ctx,
  sourceVersionId: string,
): Promise<{ ruleSetVersionId: string; version: number }> {
  const source = await ctx.db.ruleSetVersion.findUnique({
    where: { id: sourceVersionId },
    include: {
      rules: { include: { actions: true } },
      requirements: true,
      payerRules: true,
    },
  })
  if (!source) throw notFound('That rule set no longer exists.')

  const latest = await ctx.db.ruleSetVersion.findFirst({
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const version = (latest?.version ?? 0) + 1
  const orgId = ctx.actor.organizationId

  const draft = await ctx.db.ruleSetVersion.create({
    data: {
      organizationId: orgId,
      version,
      status: 'DRAFT',
      sourceRulePack: source.sourceRulePack,
      notes: `Drafted from version ${source.version}.`,
    },
    select: { id: true },
  })

  for (const rule of source.rules) {
    const created = await ctx.db.triageRule.create({
      data: {
        organizationId: orgId,
        ruleSetVersionId: draft.id,
        dimension: rule.dimension,
        name: rule.name,
        priority: rule.priority,
        condition: rule.condition as never,
        outcome: rule.outcome,
        blocking: rule.blocking,
        rationale: rule.rationale,
        isActive: rule.isActive,
      },
      select: { id: true },
    })
    for (const action of rule.actions) {
      await ctx.db.triageRuleAction.create({
        data: {
          organizationId: orgId,
          triageRuleId: created.id,
          type: action.type,
          params: (action.params ?? undefined) as never,
        },
      })
    }
  }
  for (const r of source.requirements) {
    await ctx.db.requirementDefinition.create({
      data: {
        organizationId: orgId,
        ruleSetVersionId: draft.id,
        key: r.key, label: r.label, level: r.level,
        appliesToCategoryKey: r.appliesToCategoryKey,
        detector: (r.detector ?? undefined) as never,
        sortOrder: r.sortOrder,
      },
    })
  }
  for (const p of source.payerRules) {
    await ctx.db.payerRule.create({
      data: {
        organizationId: orgId,
        ruleSetVersionId: draft.id,
        payerId: p.payerId, payerCategory: p.payerCategory,
        outcome: p.outcome, rationale: p.rationale, isActive: p.isActive,
      },
    })
  }

  ctx.audit({
    action: 'CONFIG_CHANGE',
    resourceType: 'rule_set_version',
    resourceId: draft.id,
    metadata: { forkedFromVersion: source.version, version },
  })

  return { ruleSetVersionId: draft.id, version }
}
