# Development Phases and Complexity

Estimates assume one experienced full-stack engineer working steadily, and describe
*engineering* time only — not BAA negotiation, security review by a third party, or
customer onboarding. Ranges are honest, not optimistic.

| Phase | Scope | Complexity | Estimate |
| --- | --- | --- | --- |
| 1 | Architecture (this document set) | — | Complete, pending approval |
| 2 | Core platform | High | 3–4 weeks |
| 3 | Triage rules engine | High | 3–4 weeks |
| 4 | Document intelligence | **Very High** | 4–6 weeks |
| 5 | Confidence and explainability | High | 2–3 weeks |
| 6 | Workflow automation | Medium | 2 weeks |
| 7 | CRM and marketing | Medium | 1.5–2 weeks |
| 8 | Analytics and reporting | Medium | 2 weeks |
| 9 | Hardening | High | 2–3 weeks |
| | **Total to a defensible pilot** | | **~20–27 weeks** |

Phases 2 and 3 are independently useful. A practice can run its whole referral workflow on
Phases 2+3 with manually entered diagnoses and get real value before any document AI exists.
That is the recommended sequencing under any schedule pressure — §55 of the brief allows it
explicitly, and it is the right call.

---

## Phase 2 — Core platform · High · 3–4 weeks

Authentication with MFA · organizations, memberships, roles, permissions · the four-layer
tenant isolation and its test suite · Prisma schema and migrations · referral inbox with
filters, sorting, saved views · pre-EHR patient staging · duplicate detection · referral
detail · status workflow with history · activity timeline · audit logging foundation ·
seed data.

**Exit criteria.** A coordinator can take a referral from NEW to SCHEDULED entirely by hand.
The tenant-isolation suite passes. Every state change appears in the timeline and the audit
log. No document processing yet.

*Risk to watch:* the RLS + connection-pooling benchmark (`SECURITY.md` §1, Layer 3). Do this
in week 1 of Phase 2, not at the end — the answer changes the data-access layer.

## Phase 3 — Triage rules · High · 3–4 weeks

Referral categories · ICD-10 reference import · category↔code maps · synonym table · rule
sets with versioning and copy-on-write publish · the seven dimensions · the pure
`evaluateTriage` function · precedence combination · payer rules · requirement definitions
(REQUIRED / RECOMMENDED / OPTIONAL) · the rheumatology rule pack as data · admin rule editor
· the rule simulator.

**Exit criteria.** Every rule in the practice's triage guide is expressed as data, not code.
The full §58 test matrix passes against the pure function. An administrator can change a
rule, simulate it against history, see the diff, and publish — with no deploy.

*This is the phase that makes the product configurable rather than bespoke.* It deserves the
time.

## Phase 4 — Document intelligence · Very High · 4–6 weeks

Upload and storage · validation and quarantine · the worker and queue · per-page text
extraction · OCR abstraction with Tesseract · section segmentation · ICD-10 detection with
reference validation · assertion/negation classification · requirement detectors · evidence
storage with offsets and boxes · evidence ranking · the PDF viewer with page deep-links and
highlighting · the AI gateway with its PHI gate · **bulk intake from a shared drive**:
presigned multipart upload, batch progress, content-hash deduplication, document-first
draft referrals, and the intake review queue.

**Exit criteria.** The §63 scenario runs end to end: a 60-page fixture, M06.9 found on page
37, supporting evidence on 2 and 17, one click to the highlighted source span.

*Highest-variance phase.* Fax-quality OCR is where estimates go to die. Ship native-PDF text
extraction first and treat scanned-fax OCR as a distinct milestone with its own accuracy bar
measured on real (de-identified) fax samples.

Bulk drive intake adds roughly a week to this phase and is the natural first milestone in
it — uploading, deduplicating and reviewing a folder of packets is useful before any
extraction works, because it gets the backlog into the system and gives every later stage
real documents to run against. Multi-referral packet splitting is the piece I would cut
first if the phase runs long; a manual split tool covers it.

## Phase 5 — Confidence · High · 2–3 weeks

Diagnosis confidence · disposition confidence with the dependency ceiling · versioned
confidence-model weights · the "Why this score?" panel · conflicting-evidence detection and
display · human confirmation and override with both values retained · the evaluation harness
and labeled fixture set.

**Exit criteria.** Every number on screen is clickable and every explanation reaches a page.
Overrides are captured as a calibration signal from the first day of use.

## Phase 6 — Workflow automation · Medium · 2 weeks

Missing-information composer with generated messages · mark-sent with status transition and
follow-up task · tasks with deduplication · notifications linking to objects · business-day
aware SLA timers · touch-time calculation.

**Exit criteria.** Nothing needing attention is discoverable only by a human remembering it.

## Phase 7 — CRM and marketing · Medium · 1.5–2 weeks

Referring organizations and providers · per-office metrics · outreach log · 14-day follow-up
tasks · attribution (association, labeled as such) · the marketing role's PHI-minimized
views.

## Phase 8 — Analytics · Medium · 2 weeks

Exception dashboard · KPI tiles · the §41 report set with date ranges and CSV export ·
marketing and staff performance reporting.

*Design note:* reports read from denormalized metric tables refreshed on write, not from
ad-hoc aggregate scans over `referrals`. Reporting that gets slower as a practice succeeds
is a product defect.

## Phase 9 — Hardening · High · 2–3 weeks

Security review · authorization matrix review · tenant-isolation red-teaming · log and PHI
leakage audit · load testing on the inbox and the pipeline · WCAG 2.1 AA accessibility pass ·
error handling and empty states · backup and restore drill with documented RTO/RPO · runbooks
· the vendor/BAA register completed with real executed agreements.

---

## Testing strategy across phases

Written alongside each phase, not after.

- **Pure-function suites** for the rules engine, confidence scorer, ICD-10 matcher, and
  business-day calculator. Fast, exhaustive, fixture-driven. The §58 matrix lives here:
  green + complete, green + missing docs, green + excluded payer, yellow, red, unknown,
  conflicting, historical vs active, exact code, family code, **diagnosis on page 58 of 60**,
  and nothing found at all. Plus the primary-diagnosis cases from ARCHITECTURE.md §5.5:
  a RED category present but not primary alongside a GREEN primary (→ GREEN), a RED category
  as the primary (→ RED), a GREEN category demoted to secondary under a RED primary (→ RED),
  and a contested primary within the margin (→ YELLOW).
- **Bulk intake suites**: re-dropping an identical file is deduplicated, a 500-file batch
  does not starve live referrals, `received_at` is proposed from document content rather
  than upload time, and a filename containing a patient name never reaches a log, a URL, a
  job payload, or an audit metadata value.
- **Repository/integration suites** against a real PostgreSQL, including the generated
  tenant-isolation matrix and the role-authorization matrix.
- **Pipeline fixtures**: synthetic referral packets (native PDF, scanned/degraded, mixed)
  generated by a committed script — never real patient documents, never real names.
- **End-to-end** (Playwright) for the coordinator's critical path: inbox → detail →
  evidence → source page → confirm → status change.
- **Guardrail tests**: PHI never reaches the logger; audit rows are immutable; the AI gate
  refuses unapproved providers; architecture-layering lint.
