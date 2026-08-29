CREATE TYPE "RequirementStatus" AS ENUM ('PRESENT', 'ABSENT', 'UNCHECKED');

-- CreateEnum
CREATE TYPE "CodeMatchType" AS ENUM ('EXACT_CODE', 'CODE_FAMILY', 'CODE_RANGE', 'DIAGNOSIS_CATEGORY', 'TEXT_SYNONYM', 'NONE');

-- CreateEnum
CREATE TYPE "SynonymMatchMode" AS ENUM ('PHRASE', 'ABBREVIATION', 'TOKEN');

-- CreateEnum
CREATE TYPE "RuleSetStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TriageDimension" AS ENUM ('DIAGNOSIS', 'PAYER', 'DOCUMENTATION', 'REFERRAL_SOURCE', 'PATIENT_STATUS', 'ORG_EXCEPTION', 'PROVIDER_REVIEW');

-- CreateEnum
CREATE TYPE "TriageOutcome" AS ENUM ('GREEN', 'YELLOW', 'RED', 'INCOMPLETE', 'UNKNOWN', 'REVIEW', 'NO_EFFECT');

-- CreateEnum
CREATE TYPE "RuleActionType" AS ENUM ('REQUIRE_DOCUMENT', 'SET_PRIORITY', 'ADD_TAG', 'ROUTE_TO_ROLE', 'REQUEST_INFO_TEMPLATE', 'FLAG_PHYSICIAN_REVIEW');

-- CreateEnum
CREATE TYPE "RequirementLevel" AS ENUM ('REQUIRED', 'RECOMMENDED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "EvaluationTrigger" AS ENUM ('AUTOMATIC', 'REEVALUATION', 'SIMULATION');

-- CreateEnum
CREATE TYPE "EvidenceContext" AS ENUM ('REFERRAL_REASON', 'ASSESSMENT_PLAN', 'ENCOUNTER_DIAGNOSIS', 'PROBLEM_LIST', 'HPI', 'PAST_HISTORY', 'FAMILY_HISTORY', 'BILLING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EvidencePolarity" AS ENUM ('AFFIRMED', 'HEDGED', 'RULED_OUT', 'HISTORICAL', 'FAMILY', 'CONTRADICTS');

-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "confirmedCategoryId" UUID,
ADD COLUMN     "currentTriageEvaluationId" UUID,
ADD COLUMN     "triageConfirmedAt" TIMESTAMPTZ(6),
ADD COLUMN     "triageConfirmedByUserId" UUID;

-- CreateTable
CREATE TABLE "diagnosis_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "codeNormalized" TEXT NOT NULL,
    "descriptionShort" TEXT NOT NULL,
    "descriptionLong" TEXT,
    "chapter" TEXT,
    "category3" TEXT NOT NULL,
    "versionYear" INTEGER NOT NULL,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "diagnosis_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_categories" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "specialty" TEXT NOT NULL DEFAULT 'RHEUMATOLOGY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_category_code_maps" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "matchType" "CodeMatchType" NOT NULL,
    "value" TEXT NOT NULL,
    "valueTo" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "specificityNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_category_code_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnosis_synonyms" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "termNormalized" TEXT NOT NULL,
    "matchMode" "SynonymMatchMode" NOT NULL DEFAULT 'PHRASE',
    "weight" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "diagnosis_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_set_versions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RuleSetStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceRulePack" TEXT,
    "notes" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "publishedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rule_set_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleSetVersionId" UUID NOT NULL,
    "dimension" "TriageDimension" NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "condition" JSONB NOT NULL,
    "outcome" "TriageOutcome" NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "triage_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_rule_actions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "triageRuleId" UUID NOT NULL,
    "type" "RuleActionType" NOT NULL,
    "params" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_rule_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_definitions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleSetVersionId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "level" "RequirementLevel" NOT NULL DEFAULT 'REQUIRED',
    "appliesToCategoryKey" TEXT,
    "detector" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "requirement_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleSetVersionId" UUID NOT NULL,
    "payerId" UUID,
    "payerCategory" TEXT,
    "outcome" "TriageOutcome" NOT NULL,
    "rationale" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payer_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_evaluations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "ruleSetVersionId" UUID NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "trigger" "EvaluationTrigger" NOT NULL DEFAULT 'AUTOMATIC',
    "evaluatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalDisposition" "TriageOutcome" NOT NULL,
    "dispositionConfidence" INTEGER NOT NULL,
    "nextAction" TEXT NOT NULL,
    "factsHash" TEXT NOT NULL,
    "supersededById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "triage_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_dimension_results" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "triageEvaluationId" UUID NOT NULL,
    "dimension" "TriageDimension" NOT NULL,
    "outcome" "TriageOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "matchedRuleIds" TEXT[],
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "decisive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_dimension_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnosis_candidates" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "triageEvaluationId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "diagnosisConfidence" INTEGER NOT NULL,
    "matchType" "CodeMatchType" NOT NULL,
    "strongestContext" "EvidenceContext" NOT NULL DEFAULT 'UNKNOWN',
    "polarity" "EvidencePolarity" NOT NULL DEFAULT 'AFFIRMED',
    "bestCode" TEXT,
    "possibleCodes" JSONB,
    "breakdown" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosis_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_requirement_results" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "triageEvaluationId" UUID NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "level" "RequirementLevel" NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'UNCHECKED',
    "detectionConfidence" INTEGER,
    "searchCoverage" INTEGER,
    "humanOverride" BOOLEAN NOT NULL DEFAULT false,
    "overriddenByUserId" UUID,
    "overriddenAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_requirement_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diagnosis_codes_versionYear_codeNormalized_idx" ON "diagnosis_codes"("versionYear", "codeNormalized");

-- CreateIndex
CREATE INDEX "diagnosis_codes_versionYear_category3_idx" ON "diagnosis_codes"("versionYear", "category3");

-- CreateIndex
CREATE UNIQUE INDEX "diagnosis_codes_code_versionYear_key" ON "diagnosis_codes"("code", "versionYear");

-- CreateIndex
CREATE UNIQUE INDEX "referral_categories_organizationId_key_key" ON "referral_categories"("organizationId", "key");

-- CreateIndex
CREATE INDEX "referral_category_code_maps_organizationId_categoryId_idx" ON "referral_category_code_maps"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "diagnosis_synonyms_organizationId_categoryId_idx" ON "diagnosis_synonyms"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "rule_set_versions_organizationId_status_idx" ON "rule_set_versions"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_versions_organizationId_version_key" ON "rule_set_versions"("organizationId", "version");

-- CreateIndex
CREATE INDEX "triage_rules_organizationId_ruleSetVersionId_dimension_idx" ON "triage_rules"("organizationId", "ruleSetVersionId", "dimension");

-- CreateIndex
CREATE INDEX "triage_rule_actions_organizationId_triageRuleId_idx" ON "triage_rule_actions"("organizationId", "triageRuleId");

-- CreateIndex
CREATE INDEX "requirement_definitions_organizationId_ruleSetVersionId_idx" ON "requirement_definitions"("organizationId", "ruleSetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "requirement_definitions_ruleSetVersionId_key_appliesToCateg_key" ON "requirement_definitions"("ruleSetVersionId", "key", "appliesToCategoryKey");

-- CreateIndex
CREATE INDEX "payer_rules_organizationId_ruleSetVersionId_idx" ON "payer_rules"("organizationId", "ruleSetVersionId");

-- CreateIndex
CREATE INDEX "triage_evaluations_organizationId_referralId_evaluatedAt_idx" ON "triage_evaluations"("organizationId", "referralId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "triage_dimension_results_organizationId_triageEvaluationId_idx" ON "triage_dimension_results"("organizationId", "triageEvaluationId");

-- CreateIndex
CREATE INDEX "diagnosis_candidates_organizationId_triageEvaluationId_idx" ON "diagnosis_candidates"("organizationId", "triageEvaluationId");

-- CreateIndex
CREATE INDEX "referral_requirement_results_organizationId_triageEvaluatio_idx" ON "referral_requirement_results"("organizationId", "triageEvaluationId");

-- AddForeignKey
ALTER TABLE "referral_categories" ADD CONSTRAINT "referral_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_category_code_maps" ADD CONSTRAINT "referral_category_code_maps_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_category_code_maps" ADD CONSTRAINT "referral_category_code_maps_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "referral_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_synonyms" ADD CONSTRAINT "diagnosis_synonyms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_synonyms" ADD CONSTRAINT "diagnosis_synonyms_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "referral_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set_versions" ADD CONSTRAINT "rule_set_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_rules" ADD CONSTRAINT "triage_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_rules" ADD CONSTRAINT "triage_rules_ruleSetVersionId_fkey" FOREIGN KEY ("ruleSetVersionId") REFERENCES "rule_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_rule_actions" ADD CONSTRAINT "triage_rule_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_rule_actions" ADD CONSTRAINT "triage_rule_actions_triageRuleId_fkey" FOREIGN KEY ("triageRuleId") REFERENCES "triage_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_definitions" ADD CONSTRAINT "requirement_definitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_definitions" ADD CONSTRAINT "requirement_definitions_ruleSetVersionId_fkey" FOREIGN KEY ("ruleSetVersionId") REFERENCES "rule_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_rules" ADD CONSTRAINT "payer_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_rules" ADD CONSTRAINT "payer_rules_ruleSetVersionId_fkey" FOREIGN KEY ("ruleSetVersionId") REFERENCES "rule_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_evaluations" ADD CONSTRAINT "triage_evaluations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_evaluations" ADD CONSTRAINT "triage_evaluations_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_evaluations" ADD CONSTRAINT "triage_evaluations_ruleSetVersionId_fkey" FOREIGN KEY ("ruleSetVersionId") REFERENCES "rule_set_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_dimension_results" ADD CONSTRAINT "triage_dimension_results_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_dimension_results" ADD CONSTRAINT "triage_dimension_results_triageEvaluationId_fkey" FOREIGN KEY ("triageEvaluationId") REFERENCES "triage_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_candidates" ADD CONSTRAINT "diagnosis_candidates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_candidates" ADD CONSTRAINT "diagnosis_candidates_triageEvaluationId_fkey" FOREIGN KEY ("triageEvaluationId") REFERENCES "triage_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_candidates" ADD CONSTRAINT "diagnosis_candidates_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "referral_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requirement_results" ADD CONSTRAINT "referral_requirement_results_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_requirement_results" ADD CONSTRAINT "referral_requirement_results_triageEvaluationId_fkey" FOREIGN KEY ("triageEvaluationId") REFERENCES "triage_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
