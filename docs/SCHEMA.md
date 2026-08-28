# Proposed Database Schema

PostgreSQL 16 + Prisma. Phase 1 proposal — not yet implemented.

Conventions on every tenant-scoped table: `id uuid pk`, `organization_id uuid not null`
(FK, indexed, leading column of composite indexes), `created_at`, `updated_at`.
Soft delete (`deleted_at`) only where noted. Confidence is `smallint` 0–100.

---

## Tenancy, identity, access

**organizations** — `name`, `slug` (unique), `specialty`, `timezone`, `status`,
`business_hours` (jsonb), `holiday_calendar` (jsonb), `installed_rule_pack`, `settings_id`

**organization_settings** — `organization_id` (unique), `confidence_bands` (jsonb),
`unknown_diagnosis_behavior` (`YELLOW`|`UNKNOWN`), `rule_precedence` (jsonb ordered list),
`marketing_followup_days` (default 14), `untouched_alert_business_days` (default 1),
`stale_referral_days` (default 7), `missing_info_followup_days` (default 3),
`duplicate_match_thresholds` (jsonb), `document_caps` (jsonb)

**users** — `email` (citext, unique), `name`, `password_hash`, `mfa_secret_encrypted`,
`mfa_enrolled_at`, `status`, `last_login_at`, `failed_login_count`, `locked_until`
*(a user belongs to one or more organizations via `memberships`)*

**memberships** — `user_id`, `organization_id`, `status`, `invited_by`, `accepted_at`
· unique `(user_id, organization_id)`

**roles** — `organization_id`, `key` (`ADMINISTRATOR`|`MANAGER`|`REFERRAL_COORDINATOR`|
`FRONT_DESK`|`MARKETING`), `name`, `is_system`, `permissions` (text[])

**membership_roles** — `membership_id`, `role_id` · unique pair

**sessions** — `user_id`, `organization_id`, `token_hash`, `ip_hash`, `user_agent`,
`expires_at`, `idle_expires_at`, `revoked_at`

**invitations** — `organization_id`, `email`, `role_id`, `token_hash`, `expires_at`,
`accepted_at`, `invited_by`

---

## Patients (pre-EHR staging) and referrals

**patients** — the staging record. A patient exists here **without** an EHR chart.
`first_name`, `last_name`, `date_of_birth` (date), `sex`, `phone_primary`, `phone_secondary`,
`email`, `address_line1`, `address_line2`, `city`, `state`, `postal_code`,
`preferred_language`, `notes`, `merged_into_patient_id` (nullable, set only by explicit
human action), `deleted_at`
· indexes: `(organization_id, last_name, first_name, date_of_birth)`,
`(organization_id, date_of_birth)`, `(organization_id, phone_primary)`,
trigram on `last_name`

**patient_match_candidates** — surfaced duplicate suspicions, never auto-merged.
`patient_id`, `candidate_patient_id`, `score`, `matched_on` (text[]), `status`
(`OPEN`|`LINKED`|`DISMISSED`), `reviewed_by`, `reviewed_at`

**ehr_links** — `patient_id` (unique per org), `mrn`, `ehr_patient_id`, `ehr_system`,
`created_in_ehr_at`, `linked_by`, `link_method` (`MANUAL`|`API`) — API path is designed
for, not implemented in V1

**payers** — `name`, `category`, `is_accepted`, `notes`, `external_ids` (jsonb), `is_active`

**referrals**
`patient_id`, `intake_channel` (`FAX`|`PORTAL`|`PHONE`|`EMAIL`|`MANUAL`|`API`),
`received_at`, `referring_organization_id`, `referring_provider_id`,
`referral_diagnosis_text`, `referring_diagnosis_code`, `payer_id`, `payer_raw_name`,
`member_id_encrypted`, `assigned_user_id`, `status`, `priority`, `notes`,
`first_touched_at`, `first_triaged_at`, `first_contacted_at`, `ready_to_schedule_at`,
`scheduled_at`, `closed_at`, `closed_reason`,
`current_triage_evaluation_id`, `confirmed_category_id`, `confirmed_by`, `confirmed_at`,
`marketing_attribution_id`, `deleted_at`
· indexes: `(organization_id, status, received_at)`,
`(organization_id, assigned_user_id, status)`,
`(organization_id, referring_organization_id, received_at)`,
`(organization_id, received_at)`, partial index on open statuses

**referral_status_history** — append-only. `referral_id`, `from_status`, `to_status`,
`changed_by`, `changed_at`, `reason`, `actor_type` (`USER`|`SYSTEM`)

**referral_activities** — append-only operational timeline. `referral_id`, `type`
(referral received/created, document uploaded/processed, diagnosis identified, triage
generated, triage confirmed, info requested, document received, assignment changed, status
changed, contact attempt, scheduled, EHR linked, closed), `actor_type`, `user_id`,
`occurred_at`, `note`, `subject_type`, `subject_id`, `metadata` (jsonb, no PHI)

**contact_attempts** — `referral_id`, `patient_id`, `attempted_at`, `user_id`, `method`
(`PHONE`|`VOICEMAIL`|`TEXT`|`EMAIL`|`MAIL`|`IN_PERSON`), `outcome`, `note`, `next_attempt_at`

**referral_touch_metrics** — denormalized, recomputed on transition, for fast reporting.
`referral_id` (unique), `seconds_to_first_touch`, `seconds_to_first_triage`,
`seconds_to_complete`, `seconds_to_first_contact`, `seconds_to_scheduled`,
`seconds_total_lifecycle`, `business_seconds_*` variants (org calendar aware)

---

## Documents and extraction

**documents** — `referral_id`, `patient_id`, `filename_original`, `content_type`,
`byte_size`, `sha256`, `storage_key`, `page_count`, `document_type`
(`REFERRAL_ORDER`|`DEMOGRAPHICS`|`INSURANCE_CARD`|`OFFICE_NOTE`|`LAB`|`IMAGING`|`DXA`|`OTHER`),
`document_date`, `uploaded_by`, `processing_status`, `processing_error_code`,
`packet_coverage`, `quarantined_at`, `quarantine_reason`
· the stored object is immutable; re-processing never rewrites it

**document_pages** — `document_id`, `page_number`, `text`, `char_count`,
`extraction_method` (`EMBEDDED_TEXT`|`OCR`|`NONE`), `ocr_confidence`,
`word_boxes` (jsonb, nullable), `section_labels` (text[])
· unique `(document_id, page_number)`; GIN full-text index on `text`

**document_processing_runs** — one row per stage attempt. `document_id`, `stage`,
`pipeline_version`, `started_at`, `finished_at`, `status`, `attempt`, `error_code`,
`error_detail` (no PHI), `metrics` (jsonb)

**evidence_items** — the provenance spine (§8). Append-only.
`document_id`, `page_id`, `page_number`, `start_offset`, `end_offset`, `snippet`,
`finding_type` (`ICD10_CODE`|`DIAGNOSIS_TEXT`|`LAB_RESULT`|`REQUIREMENT_HIT`|
`CONTRADICTION`|`DATE`), `context_label` (`REFERRAL_REASON`|`ASSESSMENT_PLAN`|
`PROBLEM_LIST`|`HPI`|`PMH`|`FAMILY_HISTORY`|`BILLING`|`UNKNOWN`),
`polarity` (`AFFIRMED`|`HEDGED`|`RULED_OUT`|`HISTORICAL`|`FAMILY`|`CONTRADICTS`),
`extraction_method` (`REGEX`|`DICTIONARY`|`SECTION_HEURISTIC`|`LLM`|`HUMAN`),
`extractor_version`, `confidence`, `document_date`, `bounding_boxes` (jsonb),
`normalized_code`, `matched_category_id`

---

## Clinical reference and organization rule pack

**diagnosis_codes** — global reference, not tenant-scoped.
`code`, `code_normalized`, `description_short`, `description_long`, `chapter`,
`category_3char`, `version_year`, `is_billable`, `is_active`, `valid_from`, `valid_to`
· unique `(code, version_year)`; prefix index on `code_normalized`; trigram on descriptions

**referral_categories** — org-scoped clinical concepts ("Rheumatoid Arthritis").
`key`, `name`, `description`, `specialty`, `is_active`, `sort_order`

**referral_category_code_maps** — `category_id`, `match_type`
(`EXACT_CODE`|`CODE_FAMILY`|`CODE_RANGE`), `value`, `value_to`, `weight`,
`specificity_note`

**diagnosis_synonyms** — `category_id`, `term`, `term_normalized`, `match_mode`
(`PHRASE`|`ABBREVIATION`|`TOKEN`), `weight`, `case_sensitive`

**rule_set_versions** — `version` (int, per org), `status` (`DRAFT`|`PUBLISHED`|`ARCHIVED`),
`published_at`, `published_by`, `source_rule_pack`, `notes`
· published versions are immutable; edits copy-on-write into a new draft

**triage_rules** — `rule_set_version_id`, `dimension`, `name`, `priority`, `condition`
(jsonb, Zod-validated), `outcome`, `blocking`, `rationale`, `is_active`

**triage_rule_actions** — `triage_rule_id`, `type` (`REQUIRE_DOCUMENT`|`SET_PRIORITY`|
`ADD_TAG`|`ROUTE_TO_ROLE`|`REQUEST_INFO_TEMPLATE`|`FLAG_PHYSICIAN_REVIEW`), `params` (jsonb)

**requirement_definitions** — `rule_set_version_id`, `key` (`REFERRAL_ORDER`,
`DEMOGRAPHICS`, `INSURANCE_CARD`, `OFFICE_NOTES`, `DXA_REPORT`, `RF`, `CCP`, `ESR_CRP`,
`URIC_ACID`, `RENAL_FUNCTION`, …), `label`, `level` (`REQUIRED`|`RECOMMENDED`|`OPTIONAL`),
`applies_to_category_id` (null = all), `detector` (jsonb: terms, regexes, section hints)
· **only `REQUIRED` blocks readiness**

**payer_rules** — `rule_set_version_id`, `payer_id` or `payer_category`, `outcome`,
`notes`, `is_active` — organization configuration, never global application code

---

## Evaluation results

**triage_evaluations** — one per evaluation run, append-only.
`referral_id`, `rule_set_version_id`, `pipeline_version`, `confidence_model_version_id`,
`evaluated_at`, `trigger` (`AUTOMATIC`|`REEVALUATION`|`SIMULATION`),
`final_disposition` (`GREEN`|`YELLOW`|`RED`|`INCOMPLETE`|`UNKNOWN`),
`disposition_confidence`, `next_action`, `facts_hash`, `superseded_by_id`

**triage_dimension_results** — `triage_evaluation_id`, `dimension`, `outcome`, `summary`,
`matched_rule_ids` (uuid[]), `blocking`

**diagnosis_candidates** — `triage_evaluation_id`, `category_id`, `rank`,
`diagnosis_confidence`, `match_type`, `strongest_context`, `polarity`,
`best_code`, `possible_codes` (jsonb — shown when specificity is genuinely undetermined),
`breakdown` (jsonb: each scoring term, its value, its evidence ids)

**diagnosis_candidate_evidence** — `diagnosis_candidate_id`, `evidence_item_id`, `weight`

**referral_requirement_results** — `triage_evaluation_id`, `requirement_key`, `level`,
`present`, `detection_confidence`, `search_coverage`, `human_override`,
`overridden_by`, `overridden_at`

**requirement_result_evidence** — `referral_requirement_result_id`, `evidence_item_id`

**confidence_model_versions** — `version`, `weights` (jsonb: family weights, caps, K,
penalty table), `bands` (jsonb), `published_at`, `published_by`
· historical scores remain reproducible because every evaluation names its version

**human_confirmations** — AI output is never destroyed by a correction.
`referral_id`, `field` (`DIAGNOSIS_CATEGORY`|`DISPOSITION`|`REQUIREMENT_PRESENT`|`PAYER`|…),
`ai_value` (jsonb), `ai_confidence`, `human_value` (jsonb), `reason`, `confirmed_by`,
`confirmed_at`, `triage_evaluation_id`

**ai_processing_records** — `referral_id`, `document_id`, `provider`, `model`,
`prompt_template_version`, `pipeline_version`, `input_sha256` (hash, **not** the input),
`token_input`, `token_output`, `latency_ms`, `status`, `error_code`

---

## Referral-source CRM and marketing

**referring_organizations** — `name`, `address_*`, `phone`, `fax`, `website`, `npi`,
`notes`, `is_active`, `last_referral_at`, `last_marketing_interaction_at`, `deleted_at`

**referring_providers** — `referring_organization_id`, `first_name`, `last_name`,
`credential`, `specialty`, `npi`, `phone`, `fax`, `notes`, `is_active`

**referring_organization_metrics** — materialized, refreshed nightly + on referral events.
`referring_organization_id` (unique), `referrals_total`, `referrals_30d`, `referrals_90d`,
`referrals_365d`, `referrals_scheduled`, `referrals_seen`, `conversion_rate_bp`,
`avg_processing_seconds`, `computed_at`

**marketing_interactions** — `referring_organization_id`, `referring_provider_id`,
`occurred_on`, `user_id`, `type` (`IN_PERSON`|`LUNCH`|`PHONE`|`EMAIL`|`DROP_OFF`|
`MEETING`|`OTHER`), `notes`, `follow_up_on`, `status`

**marketing_attributions** — association, explicitly **not** causation.
`referral_id`, `marketing_interaction_id`, `days_between`, `window_days`, `method`
(`MOST_RECENT_WITHIN_WINDOW`), `computed_at`
· surfaced in the UI as "referral received 6 days after outreach", never as "caused by"

---

## Work management

**tasks** — `type` (`REFERRAL_UNTOUCHED`|`MISSING_INFO_OVERDUE`|`CONTACT_ATTEMPT_DUE`|
`REFERRAL_STALE`|`PHYSICIAN_REVIEW`|`LOW_CONFIDENCE`|`MARKETING_FOLLOW_UP`|
`DOCUMENT_PROCESSING_FAILED`|`DUPLICATE_REVIEW`), `subject_type`, `subject_id`,
`assigned_user_id`, `assigned_role_id`, `due_at`, `snoozed_until`, `status`,
`completed_by`, `completed_at`, `dedupe_key` (unique per org, prevents task storms)

**information_requests** — `referral_id`, `requested_items` (text[] of requirement keys),
`message_body`, `channel` (`MANUAL_COPY`|`FAX`|`SECURE_MESSAGE` — V1 is manual copy only),
`marked_sent_by`, `marked_sent_at`, `response_received_at`, `status`

**notifications** — `user_id`, `type`, `title`, `body` (no PHI), `link_path`, `read_at`,
`subject_type`, `subject_id`

**saved_views** — `user_id` (nullable = org-shared), `name`, `resource`, `filters` (jsonb),
`sort` (jsonb), `is_default`

---

## Audit

**audit_logs** — append-only, no soft delete, no updates.
`organization_id`, `user_id`, `actor_type`, `action` (`LOGIN_SUCCESS`, `LOGIN_FAILURE`,
`MFA_CHALLENGE`, `PATIENT_VIEW`, `REFERRAL_VIEW`, `DOCUMENT_VIEW`, `DOCUMENT_DOWNLOAD`,
`RECORD_CREATE`, `RECORD_UPDATE`, `TRIAGE_OVERRIDE`, `RULE_PUBLISH`, `CONFIG_CHANGE`,
`ROLE_CHANGE`, `EXPORT`), `resource_type`, `resource_id`, `occurred_at`, `ip_hash`,
`user_agent`, `metadata` (jsonb — IDs and field names only, **never PHI values**)
· enforced by a database role that holds `INSERT` and `SELECT` but not `UPDATE`/`DELETE`,
plus a `BEFORE UPDATE OR DELETE` trigger that raises
· partitioned monthly by `occurred_at`; retention ≥ 6 years

---

## Integration seams (designed, not built in V1)

**integration_connections** — `kind` (`EHR`|`FAX`|`ELIGIBILITY`|`SCHEDULING`|
`SECURE_MESSAGE`|`OCR`|`AI`), `vendor`, `status`, `config` (jsonb, secrets by reference),
`baa_on_file`, `approved_by`, `approved_at`

**outbound_events** — transactional outbox for future integrations.
`kind`, `payload_ref`, `status`, `attempts`, `next_attempt_at`
