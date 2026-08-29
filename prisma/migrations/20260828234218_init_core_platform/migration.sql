-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('ADMINISTRATOR', 'MANAGER', 'REFERRAL_COORDINATOR', 'FRONT_DESK', 'MARKETING');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'MISSING_INFORMATION', 'WAITING_ON_REFERRING_OFFICE', 'READY_TO_CONTACT', 'PATIENT_CONTACTED', 'READY_TO_SCHEDULE', 'SCHEDULED', 'DECLINED', 'UNABLE_TO_REACH', 'NOT_ACCEPTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReferralPriority" AS ENUM ('ROUTINE', 'EXPEDITE');

-- CreateEnum
CREATE TYPE "IntakeChannel" AS ENUM ('FAX', 'PORTAL', 'PHONE', 'EMAIL', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('OPEN', 'LINKED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "EhrLinkMethod" AS ENUM ('MANUAL', 'API');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('PHONE', 'VOICEMAIL', 'TEXT', 'EMAIL', 'MAIL', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "ContactOutcome" AS ENUM ('REACHED', 'LEFT_VOICEMAIL', 'NO_ANSWER', 'WRONG_NUMBER', 'DECLINED', 'CALLBACK_REQUESTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('REFERRAL_ORDER', 'DEMOGRAPHICS', 'INSURANCE_CARD', 'OFFICE_NOTE', 'LAB', 'IMAGING', 'DXA', 'OTHER');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "IntakeBatchStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'REVIEW', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "IntakePriority" AS ENUM ('LIVE', 'BACKLOG');

-- CreateEnum
CREATE TYPE "IntakeItemState" AS ENUM ('QUEUED', 'UPLOADING', 'PROCESSING', 'NEEDS_REVIEW', 'CONFIRMED', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('REFERRAL_RECEIVED', 'REFERRAL_CREATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_PROCESSED', 'DIAGNOSIS_IDENTIFIED', 'TRIAGE_GENERATED', 'TRIAGE_CONFIRMED', 'INFORMATION_REQUESTED', 'DOCUMENT_RECEIVED', 'ASSIGNMENT_CHANGED', 'STATUS_CHANGED', 'CONTACT_ATTEMPT', 'PATIENT_REACHED', 'SCHEDULED', 'EHR_PATIENT_LINKED', 'NOTE_ADDED', 'REFERRAL_CLOSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'MFA_ENROLLED', 'MFA_CHALLENGE_SUCCESS', 'MFA_CHALLENGE_FAILURE', 'SESSION_REVOKED', 'PATIENT_VIEW', 'PATIENT_SEARCH', 'REFERRAL_VIEW', 'REFERRAL_LIST', 'DOCUMENT_VIEW', 'DOCUMENT_DOWNLOAD', 'RECORD_CREATE', 'RECORD_UPDATE', 'RECORD_DELETE', 'STATUS_CHANGE', 'ASSIGNMENT_CHANGE', 'TRIAGE_OVERRIDE', 'EHR_LINK_CREATED', 'PATIENT_MERGE_REVIEWED', 'RULE_PUBLISH', 'CONFIG_CHANGE', 'ROLE_CHANGE', 'USER_CREATE', 'USER_DISABLE', 'EXPORT');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "specialty" TEXT NOT NULL DEFAULT 'RHEUMATOLOGY',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "businessHours" JSONB NOT NULL,
    "holidayDates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "untouchedAlertBusinessDays" INTEGER NOT NULL DEFAULT 1,
    "staleReferralDays" INTEGER NOT NULL DEFAULT 7,
    "missingInfoFollowupDays" INTEGER NOT NULL DEFAULT 3,
    "marketingFollowupDays" INTEGER NOT NULL DEFAULT 14,
    "duplicateReviewThreshold" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mfaSecretEncrypted" TEXT,
    "mfaEnrolledAt" TIMESTAMPTZ(6),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMPTZ(6),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "acceptedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" "RoleKey" NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "permissions" TEXT[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "id" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaSatisfied" BOOLEAN NOT NULL DEFAULT false,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "idleExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "invitedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "sex" TEXT,
    "phonePrimary" TEXT,
    "phoneSecondary" TEXT,
    "email" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "preferredLanguage" TEXT,
    "notes" TEXT,
    "mergedIntoPatientId" UUID,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_match_candidates" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "candidatePatientId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "matchedOn" TEXT[],
    "status" "MatchStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "patient_match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ehr_links" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "mrn" TEXT NOT NULL,
    "ehrPatientId" TEXT,
    "ehrSystem" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "createdInEhrAt" TIMESTAMPTZ(6) NOT NULL,
    "linkedByUserId" UUID,
    "linkMethod" "EhrLinkMethod" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ehr_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referring_organizations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "website" TEXT,
    "npi" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastReferralAt" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referring_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referring_providers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referringOrganizationId" UUID,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "credential" TEXT,
    "specialty" TEXT,
    "npi" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referring_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payers" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "isAccepted" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "intakeChannel" "IntakeChannel" NOT NULL DEFAULT 'MANUAL',
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "referringOrganizationId" UUID,
    "referringProviderId" UUID,
    "referralDiagnosisText" TEXT,
    "referringDiagnosisCode" TEXT,
    "payerId" UUID,
    "payerRawName" TEXT,
    "memberId" TEXT,
    "assignedUserId" UUID,
    "status" "ReferralStatus" NOT NULL DEFAULT 'NEW',
    "priority" "ReferralPriority" NOT NULL DEFAULT 'ROUTINE',
    "notes" TEXT,
    "firstTouchedAt" TIMESTAMPTZ(6),
    "firstTriagedAt" TIMESTAMPTZ(6),
    "firstContactedAt" TIMESTAMPTZ(6),
    "readyToScheduleAt" TIMESTAMPTZ(6),
    "scheduledAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "closedReason" TEXT,
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_status_history" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "fromStatus" "ReferralStatus",
    "toStatus" "ReferralStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "changedByUserId" UUID,
    "reason" TEXT,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_activities" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "userId" UUID,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "subjectType" TEXT,
    "subjectId" UUID,
    "metadata" JSONB,

    CONSTRAINT "referral_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_attempts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "attemptedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "method" "ContactMethod" NOT NULL,
    "outcome" "ContactOutcome" NOT NULL,
    "note" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_touch_metrics" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "secondsToFirstTouch" INTEGER,
    "secondsToFirstTriage" INTEGER,
    "secondsToFirstContact" INTEGER,
    "secondsToReadyToSchedule" INTEGER,
    "secondsToScheduled" INTEGER,
    "secondsTotalLifecycle" INTEGER,
    "businessSecondsToFirstTouch" INTEGER,
    "businessSecondsToScheduled" INTEGER,
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "referral_touch_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "referralId" UUID,
    "patientId" UUID,
    "filenameOriginal" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "pageCount" INTEGER,
    "documentType" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "documentDate" DATE,
    "uploadedByUserId" UUID,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processingErrorCode" TEXT,
    "packetCoverage" INTEGER,
    "quarantinedAt" TIMESTAMPTZ(6),
    "quarantineReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_batches" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID,
    "sourceLabel" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "bytesTotal" BIGINT NOT NULL DEFAULT 0,
    "status" "IntakeBatchStatus" NOT NULL DEFAULT 'UPLOADING',
    "priority" "IntakePriority" NOT NULL DEFAULT 'BACKLOG',
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "intake_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_items" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "intakeBatchId" UUID NOT NULL,
    "filenameOriginal" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "state" "IntakeItemState" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "documentId" UUID,
    "draftReferralId" UUID,
    "duplicateOfDocumentId" UUID,
    "proposedFields" JSONB,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "intake_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "action" "AuditAction" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organizationId_key" ON "organization_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_organizationId_status_idx" ON "memberships"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_organizationId_key" ON "memberships"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organizationId_key_key" ON "roles"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "membership_roles_membershipId_roleId_key" ON "membership_roles"("membershipId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_organizationId_idx" ON "sessions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_email_idx" ON "invitations"("organizationId", "email");

-- CreateIndex
CREATE INDEX "patients_organizationId_lastName_firstName_dateOfBirth_idx" ON "patients"("organizationId", "lastName", "firstName", "dateOfBirth");

-- CreateIndex
CREATE INDEX "patients_organizationId_dateOfBirth_idx" ON "patients"("organizationId", "dateOfBirth");

-- CreateIndex
CREATE INDEX "patients_organizationId_phonePrimary_idx" ON "patients"("organizationId", "phonePrimary");

-- CreateIndex
CREATE INDEX "patient_match_candidates_organizationId_status_idx" ON "patient_match_candidates"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "patient_match_candidates_patientId_candidatePatientId_key" ON "patient_match_candidates"("patientId", "candidatePatientId");

-- CreateIndex
CREATE UNIQUE INDEX "ehr_links_patientId_key" ON "ehr_links"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "ehr_links_organizationId_mrn_key" ON "ehr_links"("organizationId", "mrn");

-- CreateIndex
CREATE INDEX "referring_organizations_organizationId_name_idx" ON "referring_organizations"("organizationId", "name");

-- CreateIndex
CREATE INDEX "referring_providers_organizationId_lastName_idx" ON "referring_providers"("organizationId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "payers_organizationId_name_key" ON "payers"("organizationId", "name");

-- CreateIndex
CREATE INDEX "referrals_organizationId_status_receivedAt_idx" ON "referrals"("organizationId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "referrals_organizationId_assignedUserId_status_idx" ON "referrals"("organizationId", "assignedUserId", "status");

-- CreateIndex
CREATE INDEX "referrals_organizationId_referringOrganizationId_receivedAt_idx" ON "referrals"("organizationId", "referringOrganizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "referrals_organizationId_receivedAt_idx" ON "referrals"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "referrals_organizationId_lastActivityAt_idx" ON "referrals"("organizationId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "referral_status_history_organizationId_referralId_changedAt_idx" ON "referral_status_history"("organizationId", "referralId", "changedAt");

-- CreateIndex
CREATE INDEX "referral_activities_organizationId_referralId_occurredAt_idx" ON "referral_activities"("organizationId", "referralId", "occurredAt");

-- CreateIndex
CREATE INDEX "contact_attempts_organizationId_referralId_attemptedAt_idx" ON "contact_attempts"("organizationId", "referralId", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "referral_touch_metrics_referralId_key" ON "referral_touch_metrics"("referralId");

-- CreateIndex
CREATE INDEX "referral_touch_metrics_organizationId_idx" ON "referral_touch_metrics"("organizationId");

-- CreateIndex
CREATE INDEX "documents_organizationId_referralId_idx" ON "documents"("organizationId", "referralId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_organizationId_sha256_key" ON "documents"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "intake_batches_organizationId_status_idx" ON "intake_batches"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intake_items_documentId_key" ON "intake_items"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "intake_items_draftReferralId_key" ON "intake_items"("draftReferralId");

-- CreateIndex
CREATE INDEX "intake_items_organizationId_state_idx" ON "intake_items"("organizationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "intake_items_organizationId_sha256_key" ON "intake_items"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_occurredAt_idx" ON "audit_logs"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_resourceType_resourceId_idx" ON "audit_logs"("organizationId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_userId_occurredAt_idx" ON "audit_logs"("organizationId", "userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_mergedIntoPatientId_fkey" FOREIGN KEY ("mergedIntoPatientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT "patient_match_candidates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT "patient_match_candidates_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_match_candidates" ADD CONSTRAINT "patient_match_candidates_candidatePatientId_fkey" FOREIGN KEY ("candidatePatientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ehr_links" ADD CONSTRAINT "ehr_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ehr_links" ADD CONSTRAINT "ehr_links_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referring_organizations" ADD CONSTRAINT "referring_organizations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referring_providers" ADD CONSTRAINT "referring_providers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referring_providers" ADD CONSTRAINT "referring_providers_referringOrganizationId_fkey" FOREIGN KEY ("referringOrganizationId") REFERENCES "referring_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payers" ADD CONSTRAINT "payers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referringOrganizationId_fkey" FOREIGN KEY ("referringOrganizationId") REFERENCES "referring_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referringProviderId_fkey" FOREIGN KEY ("referringProviderId") REFERENCES "referring_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "payers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_status_history" ADD CONSTRAINT "referral_status_history_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_status_history" ADD CONSTRAINT "referral_status_history_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_activities" ADD CONSTRAINT "referral_activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_activities" ADD CONSTRAINT "referral_activities_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_activities" ADD CONSTRAINT "referral_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_touch_metrics" ADD CONSTRAINT "referral_touch_metrics_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_touch_metrics" ADD CONSTRAINT "referral_touch_metrics_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_batches" ADD CONSTRAINT "intake_batches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_intakeBatchId_fkey" FOREIGN KEY ("intakeBatchId") REFERENCES "intake_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_items" ADD CONSTRAINT "intake_items_draftReferralId_fkey" FOREIGN KEY ("draftReferralId") REFERENCES "referrals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
