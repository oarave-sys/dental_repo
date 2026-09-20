-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DatasetKind" AS ENUM ('DEMO', 'LICENSED');

-- CreateEnum
CREATE TYPE "ProcedureCategory" AS ENUM ('DIAGNOSTIC', 'PREVENTIVE', 'RESTORATIVE', 'ENDODONTICS', 'PERIODONTICS', 'PROSTHODONTICS_REMOVABLE', 'PROSTHODONTICS_FIXED', 'IMPLANT_SERVICES', 'ORAL_SURGERY', 'ADJUNCTIVE');

-- CreateEnum
CREATE TYPE "CodeStatus" AS ENUM ('ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('COMMONLY_CONFUSED_WITH', 'ALTERNATIVE_TO', 'BUNDLED_WITH', 'MUTUALLY_EXCLUSIVE_WITH', 'SAME_FAMILY_DIFFERENT_COUNT');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('CODING_REQUIRED', 'CLAIM_SUPPORT');

-- CreateEnum
CREATE TYPE "RuleScope" AS ENUM ('CATEGORY', 'CODE');

-- CreateEnum
CREATE TYPE "CodingTool" AS ENUM ('FIND_CODE', 'CHECK_CODE', 'DOCUMENTATION_CHECK', 'CLAIM_SCRUBBER');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('NEEDS_INPUT', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT_QUESTION', 'USER_ANSWER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "practiceType" TEXT NOT NULL DEFAULT 'GENERAL_DENTISTRY',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "retainQueryText" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "idleExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_datasets" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DatasetKind" NOT NULL DEFAULT 'DEMO',
    "sourceNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "code_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_codes" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" "ProcedureCategory" NOT NULL,
    "subcategory" TEXT,
    "shortLabel" TEXT NOT NULL,
    "plainLanguage" TEXT NOT NULL,
    "commonUse" TEXT,
    "distinctions" TEXT,
    "documentationConsiderations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verifyQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "officialDescriptor" TEXT,
    "officialDescriptorSource" TEXT,
    "status" "CodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "procedure_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_code_attributes" (
    "id" UUID NOT NULL,
    "codeId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "procedure_code_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedure_code_relationships" (
    "id" UUID NOT NULL,
    "fromCodeId" UUID NOT NULL,
    "toCodeId" UUID NOT NULL,
    "type" "RelationshipType" NOT NULL,
    "note" TEXT,

    CONSTRAINT "procedure_code_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentation_rules" (
    "id" UUID NOT NULL,
    "scope" "RuleScope" NOT NULL,
    "category" "ProcedureCategory",
    "codeId" UUID,
    "factKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "RequirementKind" NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "promptQuestion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coding_queries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tool" "CodingTool" NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'COMPLETE',
    "inputText" TEXT,
    "displayLabel" TEXT,
    "result" JSONB,
    "confidence" "Confidence",
    "primaryCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coding_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coding_query_messages" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "queryId" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "factKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coding_query_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_cases" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "queryId" UUID,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID,
    "eventType" TEXT NOT NULL,
    "tool" "CodingTool",
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_requests" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "queryId" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMillicents" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'dental_coding_assistant_monthly',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "unitAmountCents" INTEGER NOT NULL DEFAULT 9900,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "trialEndsAt" TIMESTAMPTZ(6),
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "canceledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organization_members_organizationId_role_idx" ON "organization_members"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_userId_organizationId_key" ON "organization_members"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_email_idx" ON "invitations"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "code_datasets_key_key" ON "code_datasets"("key");

-- CreateIndex
CREATE INDEX "procedure_codes_datasetId_category_idx" ON "procedure_codes"("datasetId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "procedure_codes_datasetId_code_key" ON "procedure_codes"("datasetId", "code");

-- CreateIndex
CREATE INDEX "procedure_code_attributes_key_value_idx" ON "procedure_code_attributes"("key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "procedure_code_attributes_codeId_key_value_key" ON "procedure_code_attributes"("codeId", "key", "value");

-- CreateIndex
CREATE INDEX "procedure_code_relationships_toCodeId_idx" ON "procedure_code_relationships"("toCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "procedure_code_relationships_fromCodeId_toCodeId_type_key" ON "procedure_code_relationships"("fromCodeId", "toCodeId", "type");

-- CreateIndex
CREATE INDEX "documentation_rules_scope_category_idx" ON "documentation_rules"("scope", "category");

-- CreateIndex
CREATE INDEX "documentation_rules_codeId_idx" ON "documentation_rules"("codeId");

-- CreateIndex
CREATE INDEX "coding_queries_organizationId_createdAt_idx" ON "coding_queries"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "coding_queries_organizationId_userId_createdAt_idx" ON "coding_queries"("organizationId", "userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "coding_query_messages_organizationId_queryId_createdAt_idx" ON "coding_query_messages"("organizationId", "queryId", "createdAt");

-- CreateIndex
CREATE INDEX "saved_cases_organizationId_createdAt_idx" ON "saved_cases"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "usage_events_organizationId_createdAt_idx" ON "usage_events"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "usage_events_eventType_createdAt_idx" ON "usage_events"("eventType", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_requests_organizationId_createdAt_idx" ON "ai_requests"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ai_requests_createdAt_idx" ON "ai_requests"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_codes" ADD CONSTRAINT "procedure_codes_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "code_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_code_attributes" ADD CONSTRAINT "procedure_code_attributes_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "procedure_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_code_relationships" ADD CONSTRAINT "procedure_code_relationships_fromCodeId_fkey" FOREIGN KEY ("fromCodeId") REFERENCES "procedure_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedure_code_relationships" ADD CONSTRAINT "procedure_code_relationships_toCodeId_fkey" FOREIGN KEY ("toCodeId") REFERENCES "procedure_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentation_rules" ADD CONSTRAINT "documentation_rules_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "procedure_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_queries" ADD CONSTRAINT "coding_queries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_queries" ADD CONSTRAINT "coding_queries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_query_messages" ADD CONSTRAINT "coding_query_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_query_messages" ADD CONSTRAINT "coding_query_messages_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "coding_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_cases" ADD CONSTRAINT "saved_cases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_cases" ADD CONSTRAINT "saved_cases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_cases" ADD CONSTRAINT "saved_cases_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "coding_queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "coding_queries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

