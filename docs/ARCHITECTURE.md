# System Architecture

Phase 1 proposal. Nothing here is built yet.

---

## 1. System architecture

### 1.1 Shape of the system

The product is one Next.js application plus one background worker, sharing one PostgreSQL
database and one object store. The worker exists because a 100-page scanned referral packet
cannot be OCR'd inside a serverless request.

```
                    ┌──────────────────────────────────────────────┐
   Browser ───TLS──▶│  Next.js (App Router, RSC + Server Actions)   │
                    │  · UI            · authn/authz choke point    │
                    │  · services      · tenant-bound data access   │
                    └───────┬───────────────────────┬──────────────┘
                            │                       │
                enqueue job │                       │ read/write
                            ▼                       ▼
                    ┌───────────────┐      ┌──────────────────────┐
                    │ pg-boss queue │◀────▶│  PostgreSQL          │
                    │ (in Postgres) │      │  · tenant tables+RLS │
                    └───────┬───────┘      │  · audit (append-only)│
                            │              │  · job queue          │
                            ▼              └──────────────────────┘
                    ┌────────────────────────────┐        ▲
                    │ Document Worker (Node)     │        │
                    │  validate → extract → OCR  │────────┘
                    │  → segment → detect ICD-10 │
                    │  → find requirements       │        ┌──────────────────┐
                    │  → rank evidence           │───────▶│ Object store     │
                    │  → evaluate rules          │        │ (S3-compatible)  │
                    │  → score confidence        │        │ SSE-KMS, private │
                    └──────────┬─────────────────┘        └──────────────────┘
                               │
                        ┌──────▼──────────────┐
                        │ AI Provider Gateway │ (PHI-gated, per-org config)
                        └─────────────────────┘
```

### 1.2 Why a separate worker

- Serverless function timeouts (Vercel: 60s Hobby/Pro, 300s max) do not cover OCR of a
  100-page fax. A single long-running Node process does.
- Document processing is bursty and CPU-bound. It should scale and fail independently of
  the interactive app; a stuck OCR job must never degrade the referral inbox.
- It creates a natural boundary for the one process that touches raw document bytes.

**Queue choice: `pg-boss` (jobs stored in PostgreSQL).** This deliberately avoids adding
Redis/SQS/Upstash as an additional vendor that would hold PHI-adjacent job payloads. Job
payloads carry only IDs, never clinical text. If throughput ever outgrows Postgres, the
`JobQueue` interface allows swapping the driver without touching pipeline code.

### 1.3 Layering rules (enforced, not aspirational)

```
app/            React Server/Client Components. No business logic. No Prisma imports.
  ↓
lib/services/   Use-case orchestration. Transactions. Emits audit + activity events.
  ↓
lib/repositories/  The ONLY place Prisma is imported. Every method is tenant-bound.
  ↓
lib/db/         Prisma client + tenant extension + RLS session binding.

lib/rules/      Pure. No I/O. evaluate(facts, compiledRuleSet) → TriageResult.
lib/confidence/ Pure. No I/O. score(evidence, modelVersion) → Score + breakdown.
lib/icd10/      Pure matching + a data importer.
lib/documents/  Pipeline stages behind interfaces (TextExtractor, OcrProvider, Storage).
lib/ai/         Provider gateway. The only egress point for clinical text.
lib/authz/      Policy. can(actor, action, resource).
lib/audit/      Append-only writer.
```

Enforced by ESLint `no-restricted-imports` (`@prisma/client` importable only under
`lib/db` and `lib/repositories`; `lib/services` not importable from `app/**/*.tsx` client
components) and by an architecture test that fails CI on violations.

The rules engine and the confidence scorer are **pure functions over plain data**. That is
the single most important testability decision in the system: every triage outcome in the
test suite is a fixture in, an object out, with no database.

### 1.4 Runtime environments

| Concern | MVP | Notes |
| --- | --- | --- |
| App | Next.js 15, App Router, React 19, Node runtime (not Edge) | Edge runtime excluded — Prisma + PHI logging controls |
| Worker | Same repo, `worker/` entrypoint, long-running container | Shares `lib/` |
| DB | PostgreSQL 16 | RLS enabled; app connects as a non-BYPASSRLS role |
| Storage | S3-compatible behind a `DocumentStorage` interface | Local filesystem adapter for dev |
| Sessions | Database-backed (not JWT-only) | Enables server-side revocation |

---

## 2. Database schema

See [`SCHEMA.md`](SCHEMA.md) for the table-by-table proposal.

Conventions applied to every table:

- `id uuid` primary key (v7 where available, for index locality).
- `organization_id uuid not null` on every tenant-scoped table, with an FK and an index —
  and it is the **leading column** of most composite indexes.
- `created_at`, `updated_at timestamptz not null`.
- Soft deletion (`deleted_at`) only on user-editable operational records. Never on
  `audit_logs`, `referral_status_history`, `referral_activities`, `triage_evaluations`,
  `ai_processing_records`, or `evidence_items`.
- Money/duration fields stored as integers (cents, seconds). No floats for anything
  reported on.
- Confidence stored as `smallint` 0–100 plus a JSONB breakdown, never as a bare float.

---

## 3. Tenant-security model

See [`SECURITY.md`](SECURITY.md) for the full treatment. Summary: **four independent
layers**, any one of which alone would be a single point of failure.

1. **Session-derived tenancy.** `organizationId` comes from the server session only. There
   is no code path that reads a tenant identifier from a request body, query string,
   header, or JWT claim the client can influence.
2. **Tenant-bound data access.** All Prisma access flows through a client extension that
   injects `where: { organizationId }` on read and `data: { organizationId }` on write for
   every tenant-scoped model. Bypassing it requires an explicitly named
   `unsafeCrossTenantClient` used only by platform-admin tooling and the seeder.
3. **PostgreSQL Row-Level Security as a backstop.** Every tenant table carries
   `USING (organization_id = current_setting('app.current_org_id')::uuid)`. Each request
   opens a transaction that issues `SET LOCAL app.current_org_id`. If the ORM layer has a
   bug, the database still refuses. *(Risk: this requires interactive transactions and a
   pooler in transaction mode — see §12 Risk R-2.)*
4. **Tests.** A generated test suite iterates every tenant-scoped model and asserts that
   org A cannot read, update, delete, or relate to org B's rows through the repository
   layer, the server actions, and raw SQL under the app role.

---

## 4. Document-processing pipeline

Ten stages. Each is an idempotent job, individually retriable, individually versioned, and
individually recorded in `document_processing_runs`.

```
1  INTAKE          store original bytes, sha256, never mutate
2  VALIDATE        magic-byte sniff, size/page caps, reject encrypted/JS PDFs, AV scan
3  EXTRACT_TEXT    embedded text layer per page (pdfjs-dist)
4  OCR             per page, only where text density < threshold
5  SEGMENT         section labels (A/P, HPI, Problem List, Family Hx, labs, DXA, fax hdr)
6  DETECT_CODES    ICD-10-CM regex → validate against reference table → context window
7  EXTRACT_FINDINGS  diagnoses, assertion polarity, dates, labs; deterministic first
8  DETECT_REQUIREMENTS  per-requirement detectors (e.g. DXA) across the whole packet
9  RANK_EVIDENCE   score and order evidence items per candidate diagnosis
10 EVALUATE        rules engine → triage result → confidence scores → notifications
```

### 4.1 Non-negotiable: the whole packet

Every stage runs across **all pages**. The diagnosis may be on page 47. Page-level records
exist for every page, including pages that yielded no text, and `packet_coverage`
(fraction of pages with usable text) is carried into confidence scoring so the system can
say "I searched 61 of 63 pages; 2 pages were unreadable."

### 4.2 Safe handling of untrusted files

- Content-type is determined by magic bytes, not by the client's `Content-Type` or the
  filename extension.
- PDFs are parsed with JavaScript execution disabled and external resource loading off.
  Encrypted PDFs and PDFs containing `/JavaScript`, `/Launch`, or `/EmbeddedFile` actions
  are quarantined for human review rather than processed.
- Caps: 100 MB, 400 pages, 30 min wall clock per document (configurable per org).
- ClamAV runs in the worker container. Files are never executed, never rendered by a
  headless browser server-side, and never served from the app's own origin without
  `Content-Disposition: attachment` and a strict `Content-Security-Policy: sandbox`.
- Originals are immutable. Derived text lives in separate tables. A re-run never overwrites
  the source document.

### 4.3 OCR

`OcrProvider` interface with three planned adapters:

| Adapter | PHI egress | When |
| --- | --- | --- |
| `TesseractOcrProvider` (in-worker) | None | Default. No vendor, no BAA needed. |
| `TextractOcrProvider` (AWS) | Yes → AWS | Higher accuracy on faxes; AWS BAA covers it. |
| `NullOcrProvider` | None | Deployments that decline OCR entirely. |

Only pages that need OCR are OCR'd, which is the main cost control on a 400-page fax.

### 4.4 Deterministic before AI

Stages 5–8 are deterministic (regex, dictionaries, section heuristics, a NegEx-style
assertion classifier) as the primary implementation. The LLM is a **second pass on
ambiguous spans only**, and its outputs are stored as evidence with
`extraction_method = 'LLM'` so they can be filtered, audited, and compared against the
deterministic baseline. If the AI gateway is disabled or a provider is not PHI-approved,
the pipeline completes in deterministic-only mode with a visible banner on the referral.

---

## 5. Deterministic triage-rules architecture

### 5.1 Facts in, result out

```ts
// Pure. No database. No network. No clock (time is passed in).
export function evaluateTriage(
  facts: TriageFacts,
  ruleSet: CompiledRuleSet,
): TriageEvaluation;

export interface TriageFacts {
  diagnosisCandidates: Array<{
    categoryId: string;
    confidence: number;              // 0-100
    matchType: MatchType;            // EXACT_CODE | CODE_FAMILY | CATEGORY | TEXT_SYNONYM
    strongestContext: ContextLabel;  // REFERRAL_REASON | ASSESSMENT_PLAN | PROBLEM_LIST | ...
    polarity: Polarity;              // AFFIRMED | HEDGED | RULED_OUT | HISTORICAL | FAMILY
    evidenceIds: string[];
  }>;
  payer: { payerId: string | null; rawName: string; category: string | null };
  requirements: Array<{ key: string; level: RequirementLevel; present: boolean;
                        detectionConfidence: number; evidenceIds: string[] }>;
  referralSource: { organizationId: string | null; providerId: string | null; tags: string[] };
  patientStatus: 'NEW' | 'CURRENT_PATIENT' | 'FORMER_PATIENT' | 'UNKNOWN';
  packetCoverage: number;            // 0-100
}
```

### 5.2 Seven independent dimensions

Each is evaluated on its own and each produces its own outcome, its own reason, and its own
matched rules. They are never collapsed into one unexplained verdict.

| Dimension | Question |
| --- | --- |
| `DIAGNOSIS` | Does the practice accept this condition? |
| `PAYER` | Is this payer accepted? |
| `DOCUMENTATION` | Are the organization's REQUIRED items present? |
| `REFERRAL_SOURCE` | Does this referring office have a configured exception? |
| `PATIENT_STATUS` | Current/former patient handling? |
| `ORG_EXCEPTION` | Any organization-specific override? |
| `PROVIDER_REVIEW` | Does anything force physician review? |

### 5.3 Rule shape

Rules are **data**, stored per organization, never in application code or React components.

```ts
interface TriageRule {
  id: string; ruleSetVersionId: string;
  dimension: Dimension;
  name: string;                       // shown to users verbatim
  priority: number;                   // lower runs first, ties resolved deterministically
  condition: RuleCondition;           // Zod discriminated union, validated on save
  outcome: 'GREEN' | 'YELLOW' | 'RED' | 'INCOMPLETE' | 'REVIEW' | 'NO_EFFECT';
  blocking: boolean;
  actions: RuleAction[];              // REQUIRE_DOCUMENT, SET_PRIORITY, ADD_TAG,
                                      // ROUTE_TO_ROLE, REQUEST_INFO_TEMPLATE, ...
  rationale: string;                  // the sentence shown in "why this score?"
}

type RuleCondition =
  | { type: 'DIAGNOSIS_CATEGORY'; categoryId: string; minConfidence: number;
      allowedContexts: ContextLabel[]; allowedPolarities: Polarity[] }
  | { type: 'ICD10_EXACT'; codes: string[] }
  | { type: 'ICD10_FAMILY'; prefixes: string[] }      // 'M05' matches M05.79
  | { type: 'ICD10_RANGE'; from: string; to: string }
  | { type: 'TEXT_MATCH'; terms: string[]; scope: 'REFERRAL_REASON' | 'PACKET' }
  | { type: 'PAYER_IN'; payerIds: string[] }
  | { type: 'PAYER_CATEGORY'; categories: string[] }
  | { type: 'REQUIREMENT_MISSING'; keys: string[] }
  | { type: 'REFERRAL_SOURCE_IN'; referringOrganizationIds: string[] }
  | { type: 'PATIENT_STATUS'; values: PatientStatus[] }
  | { type: 'ALL_OF'; of: RuleCondition[] }
  | { type: 'ANY_OF'; of: RuleCondition[] }
  | { type: 'NOT'; of: RuleCondition };
```

### 5.4 Combination and priority

Default precedence, itself an org-editable ordered list:

```
1. HARD_BLOCK / excluded payer                     → RED
2. Diagnosis RED (strong match, primary context)   → RED
3. Missing REQUIRED documentation                  → INCOMPLETE
4. Any dimension raising PROVIDER_REVIEW           → YELLOW
5. Diagnosis YELLOW                                → YELLOW
6. Diagnosis UNKNOWN or below confidence floor     → YELLOW or UNKNOWN (configurable)
7. All dimensions GREEN                            → GREEN
```

Payer-RED intentionally outranks INCOMPLETE by default: chasing a DXA report for a patient
the practice cannot accept is wasted staff time. Organizations that prefer the opposite can
reorder it.

**A RED diagnosis rule requires a strong match in a primary context.** A passing mention of
"fibromyalgia" on page 50 of a packet whose referral reason is rheumatoid arthritis must
not turn the referral RED. This is encoded as `allowedContexts` +
`allowedPolarities` + `minConfidence` on every RED rule in the shipped rheumatology pack.

The result always carries **all** dimension outcomes, not just the deciding one:

```
DIAGNOSIS       GREEN   — Osteoporosis (M81.0, exact) · rule "Osteoporosis" v4
PAYER           GREEN   — Accepted commercial · rule "Default accepted payers" v4
DOCUMENTATION   RED     — DXA report not detected in 63 pages
FINAL           INCOMPLETE — Request DXA report
```

### 5.5 Versioning and safe rule changes

- `rule_set_versions` are immutable once published. Editing produces a new draft version by
  copy-on-write; publishing stamps it and freezes it.
- Every evaluation stores `rule_set_version_id`, the matched rule IDs, the inputs hash, the
  confidence model version, and the extractor pipeline version. "Why did the system say
  this on that date?" is answerable forever.
- **Rule simulator**: an admin can run a draft version against the last N historical
  referrals and see a diff — *"14 referrals change from GREEN to INCOMPLETE"* — before
  publishing. This is the safety feature that makes rule editing by non-engineers viable.
- Re-running triage under current rules is an explicit, audited administrator action. It
  creates a new evaluation row; it never rewrites the old one.

### 5.6 Specialty rule packs

The engine is specialty-agnostic. Rheumatology ships as a **rule pack**: a versioned,
validated JSON bundle (categories, ICD-10 mappings, synonyms, requirements, rules,
message templates) installed into an organization at provisioning and thereafter owned and
editable by that organization. Cardiology, GI, neurology packs are additional data files,
not code changes.

---

## 6. ICD-10 matching architecture

### 6.1 Reference data

`diagnosis_codes` is loaded from the annual CMS ICD-10-CM release (public domain, published
by CMS/NCHS). Stored per code: `code` (display, with dot), `code_normalized` (no dot, for
prefix matching), `description_short`, `description_long`, `chapter`, `category` (first 3
chars), `version_year`, `is_billable`, `is_active`, `valid_from`, `valid_to`.

An idempotent `icd10:import` CLI loads a release year. Multiple years coexist; a referral is
matched against the version active on its received date. The code set is **never** bundled
into frontend components — search is a server-side indexed query
(`pg_trgm` on description, prefix index on `code_normalized`).

### 6.2 Five match strategies, ranked

| Strategy | Example | Strength |
| --- | --- | --- |
| `EXACT_CODE` | `M79.7` → Fibromyalgia | Highest |
| `CODE_FAMILY` | `M05*`, `M06*` → Rheumatoid Arthritis | High |
| `CODE_RANGE` | `M15`–`M19` → Osteoarthritis | High |
| `DIAGNOSIS_CATEGORY` | curated category membership | Medium |
| `TEXT_SYNONYM` | "temporal arteritis" → Giant Cell Arteritis | Lower |

`referral_category_code_maps` holds `(category_id, match_type, value, weight, note)`.
Where the triage guide names a condition that spans several codes, we store the **family or
range**, not a guessed leaf code. Where specificity genuinely depends on information the
referral does not contain, the UI shows *possible* matches side by side rather than
inventing a leaf:

```
Giant cell arteritis
  M31.6   Other giant cell arteritis
  M31.5   Giant cell arteritis with polymyalgia rheumatica   ← if PMR also documented
  Specificity depends on documented PMR. 2 candidates shown.
```

### 6.3 Detection in text

Regex `\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?\b`, then validated against the
reference table for the applicable year — this discards the many false positives that
plague raw regex matching on fax text (dates, lab identifiers, form codes). Each hit stores
the surrounding ±250 characters, the section label, the page, and the character offsets.

### 6.4 Synonyms and abbreviations

`diagnosis_synonyms` is a curated in-house table: `term`, `term_normalized`, `category_id`,
`match_mode` (`PHRASE` | `ABBREVIATION` | `TOKEN`), `weight`. Abbreviations ("RA", "GCA",
"PMR", "MCTD") are matched case-sensitively with word boundaries and carry a **low standalone
weight** — "RA" alone never establishes rheumatoid arthritis; it corroborates.

Original text is always preserved alongside the normalized mapping. Synonyms are treated as
*evidence toward a category*, never as clinical equivalence.

> Licensing note: SNOMED CT and UMLS carry license terms. The MVP uses a curated in-house
> synonym list plus public-domain CMS descriptions. See `SECURITY.md` §Vendors.

---

## 7. Confidence-scoring methodology

Two scores, deliberately separate, both computed by **documented deterministic formulas over
extracted evidence**. No score is ever "whatever the model said its confidence was."

### 7.1 Diagnosis confidence

*"How confident is the system that it correctly identified the reason for this referral?"*

Evidence is grouped into families; each family has a weight and a **cap**, so twenty copies
of a copied-forward problem list cannot manufacture certainty.

| Family | Weight | Cap |
| --- | --- | --- |
| F1 Explicit referral intent (order / "reason for referral" names it) | 3.0 | 3.0 |
| F2 Coded evidence — ICD-10 mapped to the category | context-weighted: A/P 2.5 · encounter dx 2.2 · problem list 1.2 · billing 0.8 · history 0.5, × match-type factor (exact 1.0 · family 0.8 · category 0.6) | 3.0 |
| F3 Narrative assertion in Assessment/Plan | 2.0 | 2.0 |
| F4 Corroborating objective data (RF/CCP, ESR/CRP, DXA T-score, imaging) | 0.5 each | 1.5 |
| F5 Repetition across distinct pages/documents | 0.4·ln(1+n) | 1.2 |

```
raw   = Σ min(familyScore, familyCap)                 × recencyFactor
        recency: ≤90d ×1.00 · 91–365d ×0.85 · >365d ×0.60 (on the decisive document)
base  = 100 · (1 − e^(−raw / 2.5))                    raw 2.5→63  5.0→86  7.5→95

penalties (subtractive, applied after base):
  evidence is hedged / rule-out only               −25
  evidence is historical only ("history of")       −20
  explicit contradiction of the candidate          −15 each, capped −35
  competing candidate within 15 points             −10
  the decisive span came from OCR only             −10
  packet coverage < 90%                            −5

score = clamp(base − penalties, 0, 99)     // never 100
```

Every term that fired is stored in `confidence_results.breakdown` (JSONB) with its evidence
IDs, which is exactly what the "Why this score?" panel renders. The weight table is a
**versioned database record** (`confidence_model_versions`), not a code constant, so it can
be tuned without a deploy and historical scores remain reproducible.

### 7.2 Disposition confidence

*"How confident is the system that the organization's rules support this routing?"*

```
start from the strength of the rule that decided the outcome:
  EXACT_CODE 95 · CODE_FAMILY 88 · CATEGORY 82 · TEXT_SYNONYM 70 · SPECIAL_RULE per-rule

adjustments:
  each dimension with insufficient data                 −8
  competing rules at equal priority, unresolved         −20
  packet coverage < 90% (documentation dimension only)  −8

dependency ceiling:
  if the deciding dimension is DIAGNOSIS →
      cap at diagnosisConfidence + 3
  if the deciding dimension is PAYER, DOCUMENTATION, REFERRAL_SOURCE or ORG_EXCEPTION →
      NO ceiling (these do not depend on the diagnosis being right)
```

That ceiling rule is the interesting part, and it produces the behaviour the spec asks for:

```
Fibromyalgia, dx confidence 97, exact M79.7, org rule RED
  → RED, disposition confidence 99? No: capped at 97+3 = 99 → 95 after no penalties. RED, 95.

"Possible inflammatory arthritis", dx confidence 58, no definitive code
  → YELLOW physician review, disposition confidence 52.

Unknown diagnosis, but payer is on the excluded list
  → RED, disposition confidence 96 — because the payer rule does not care what the
    diagnosis is. Diagnosis confidence stays low and is displayed as low.
```

### 7.3 Bands and the human in the loop

| Score | Band |
| --- | --- |
| 90–100 | VERY HIGH |
| 75–89 | HIGH |
| 60–74 | MODERATE |
| 40–59 | LOW |
| 0–39 | INSUFFICIENT |

Thresholds are org-configurable. **No score, at any value, causes a referral to be
scheduled or declined automatically.** Confidence changes what is surfaced first and how
loudly, not what happens to a patient.

### 7.4 Honest calibration

These are heuristic scores, not calibrated probabilities, and the UI will say so on the
explanation panel until we have evidence otherwise. Phase 5 ships an **evaluation harness**:
a labeled fixture set plus a sampling workflow that captures every human confirmation and
override, so we can measure agreement and recalibrate the weight table against real data.
Overrides are the training signal; that is why §30's "never destroy the original AI output"
requirement matters operationally, not just for audit. See `OPEN-QUESTIONS.md` Q-2 on the
"confidence in absence" number specifically.

---

## 8. Evidence and provenance model

**Every clinical fact used in triage points back to a character span on a page.** This is
treated as a hard invariant, enforced by a check in the evaluation service: a diagnosis
candidate or requirement result with zero evidence items cannot be persisted.

```
documents ──< document_pages ──< evidence_items
                                    │
      ┌─────────────────────────────┼──────────────────────────────┐
      ▼                             ▼                              ▼
diagnosis_candidate_evidence   requirement_result_evidence   triage_result_evidence
```

`evidence_items` stores: `document_id`, `page_id`, `page_number`, `start_offset`,
`end_offset`, `snippet`, `finding_type`, `context_label`, `polarity`, `extraction_method`
(`REGEX` | `DICTIONARY` | `SECTION_HEURISTIC` | `LLM` | `HUMAN`), `extractor_version`,
`confidence`, `document_date`, and optional `bounding_boxes` (JSONB) for pixel-accurate
highlighting.

**Highlighting.** For PDFs with a text layer, `pdfjs-dist` gives per-item transforms during
extraction; we persist word boxes so the viewer can draw an overlay. For OCR'd pages, the
OCR provider returns word boxes. Where neither is available, the viewer falls back to
opening the correct page and showing the snippet in a side panel — degraded, never absent.

**Deep linking.** `/referrals/{id}/documents/{docId}?page=37&evidence={evidenceId}` opens
the viewer on page 37 with the span highlighted. Note the URL contains opaque UUIDs and a
page number only — no name, DOB, MRN, or diagnosis. That is a deliberate constraint from
§44 ("no PHI in URLs") and it shapes every route in §10.

**Conflicting evidence is first-class.** A dedicated pass looks for contradiction —
negation of a candidate, an alternative diagnosis asserted in an Assessment/Plan, a later
document superseding an earlier one — and stores it as evidence with
`polarity = 'CONTRADICTS'`. It is displayed in its own section of the intelligence card and
it lowers confidence. It is never suppressed because another finding supports GREEN.

---

## 9. AI-provider abstraction

### 9.1 Task-shaped interface, not a chat client

```ts
interface AiProvider {
  readonly id: string;
  readonly capabilities: AiCapability[];
  classifyAssertionContext(input: SpanBatch, ctx: AiCallContext): Promise<ContextLabels>;
  extractClinicalFindings(input: PageBatch, ctx: AiCallContext): Promise<Finding[]>;
  detectRequirementEvidence(input: RequirementProbe, ctx: AiCallContext): Promise<Hit[]>;
}
```

Business logic never sees a provider SDK. Swapping Bedrock for Anthropic direct, or
disabling AI entirely, is configuration.

### 9.2 The PHI gate

Configuration per organization, per provider:

```ts
interface AiProviderConfig {
  provider: 'anthropic' | 'bedrock' | 'azure-openai' | 'none';
  model: string;
  region: string;
  phiApproved: boolean;        // set only by a platform admin
  baaOnFile: boolean;
  zeroRetentionConfirmed: boolean;
  trainingOptOutConfirmed: boolean;
  approvedBy: string; approvedAt: Date;
}
```

The gateway **refuses to transmit any text derived from a document** unless
`phiApproved && baaOnFile && zeroRetentionConfirmed && trainingOptOutConfirmed`. On refusal
the pipeline completes deterministically and the referral shows
*"AI extraction disabled for this organization — deterministic analysis only."* This is a
code-enforced control, not a policy document.

An optional de-identification pre-pass (strip detected names, DOB, MRN, addresses, phone,
account numbers) can be enabled, but it is explicitly documented as **defense in depth, not
a substitute for a BAA** — free-text clinical narrative cannot be reliably de-identified.

### 9.3 Reproducibility records

`ai_processing_records` stores provider, model ID, prompt-template version, pipeline
version, rule-set version, confidence-model version, document version, token counts,
latency, and outcome. It stores a **hash** of the input, not the input. Full prompts
containing PHI are not persisted.

---

## 10. Application pages and routes

```
Auth
  /login                                  credentials + MFA
  /accept-invite/[token]
  /mfa/enroll

Work
  /                                       Exception dashboard — "what needs attention now?"
  /referrals                              Inbox: filter, sort, saved views, bulk assign
  /referrals/new                          Manual intake + duplicate check
  /referrals/[id]                         Referral detail
  /referrals/[id]/documents/[docId]       Viewer, ?page=&evidence=
  /referrals/[id]/request-info            Missing-information composer
  /patients                               Pre-EHR staging patients
  /patients/[id]                          Demographics, referral history, EHR linkage
  /patients/[id]/possible-duplicates      Review, link or dismiss — never auto-merge
  /tasks                                  My tasks / team tasks
  /notifications

CRM & marketing
  /sources                                Referring organizations
  /sources/[id]                           Metrics, providers, outreach history
  /sources/providers/[id]
  /marketing                              Outreach log
  /marketing/follow-ups                   Due follow-ups (14-day default)

Analytics
  /reports                                Report index
  /reports/[slug]                         Date-ranged report with CSV export

Administration
  /settings/organization                  Timezone, business hours, holidays, thresholds
  /settings/users        /settings/users/[id]
  /settings/categories                    Referral categories + ICD-10 maps + synonyms
  /settings/rules                         Triage rules by dimension
  /settings/rules/versions                Version history, publish, diff
  /settings/rules/simulator               Dry-run a draft against historical referrals
  /settings/requirements                  Required / recommended / optional, per category
  /settings/payers                        Payer rules (org config, never global code)
  /settings/confidence                    Bands, floors, unknown-handling
  /settings/integrations                  AI provider, storage, future EHR/fax
  /settings/audit                         Audit log search

Server
  /api/documents/[id]/stream              Authorized, audited byte proxy
  /api/health
  (future) /api/integrations/fax/inbound, /api/integrations/ehr/*
```

**Route-level authorization** is declared in one table (`lib/authz/routes.ts`) and enforced
in middleware plus re-checked in every server action. No page relies on the client hiding a
link.

---

## 11. Component architecture

```
app/(auth)/...                  unauthenticated shell
app/(app)/...                   authenticated shell: nav, org switcher, command palette (⌘K)

components/ui/                  shadcn primitives, unmodified where possible
components/data/                DataTable, FilterBar, SavedViews, DateRangePicker
components/referral/            StatusBadge, ReferralAgeChip, AssignmentPicker,
                                ReferralIntelligenceCard, TriageDimensionGrid
components/evidence/            ConfidenceChip (clickable), WhyThisScorePanel,
                                EvidenceList, EvidenceLink, ConflictPanel
components/viewer/              PdfViewer, PageNavigator, HighlightOverlay
components/timeline/            ActivityTimeline, ContactAttemptForm
components/rules/               RuleEditor, ConditionBuilder, RuleDiff, SimulatorResults
```

Two rules that keep this from rotting:

1. **No business logic in components.** A component receives a `TriageEvaluation` and
   renders it. It never decides what GREEN means.
2. **`ConfidenceChip` is the only way a confidence number reaches the screen**, and it is
   always clickable. Making the explainability affordance structural rather than optional is
   how §26 stays true a year from now.

Data flow: Server Components fetch through services; mutations are Server Actions wrapped in
`withAuthorizedAction(permission, schema, handler)` which performs authentication, tenant
binding, RBAC, Zod validation, the transaction, the audit write, and the activity write —
one choke point, so none of those can be forgotten individually.

---

## 12. Architectural risks

| ID | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R-1 | Serverless timeouts cannot process 100-page OCR | High | Separate worker container from day one (§1.2) |
| R-2 | Prisma + RLS needs `SET LOCAL` in an interactive transaction; interacts badly with some poolers and adds latency | High | Pooler in transaction mode; benchmark in Phase 2; RLS is a *backstop* — the app layer must be correct on its own, so RLS can be relaxed to read-only enforcement if the cost proves unacceptable |
| R-3 | A weak text match producing a RED disposition harms a real patient | High | RED rules require primary context + strong match + confidence floor; RED never auto-communicates; §5.4 |
| R-4 | Confidence numbers look calibrated but aren't | High | Explicit heuristic labeling, evaluation harness in Phase 5, override capture from day one |
| R-5 | PHI leaking into logs, errors, analytics, or AI prompts | High | Structured logger with a PHI-field denylist + redaction; Sentry `beforeSend` scrubber; no PHI in URLs; AI PHI gate (§9.2); a CI test that greps fixtures through the logger |
| R-6 | Cross-tenant data exposure | Critical | Four layers, §3 |
| R-7 | Malicious PDF exploiting the parser | Medium | §4.2 |
| R-8 | ICD-10 annual version drift silently changing historical triage | Medium | Version-stamped code table; referrals match against the version active on their received date |
| R-9 | Rule edits by an administrator silently breaking triage | Medium | Immutable published versions + simulator diff before publish |
| R-10 | Document storage cost/latency on large packets | Low | Page-level text in Postgres, originals in object storage, signed short-TTL streaming |

---

*Continued in [`SCHEMA.md`](SCHEMA.md), [`SECURITY.md`](SECURITY.md),
[`ROADMAP.md`](ROADMAP.md), [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md).*
