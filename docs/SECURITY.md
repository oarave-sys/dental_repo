# Security, Tenancy, and HIPAA Risk

Phase 1 proposal.

> **This is not a compliance claim.** Implementing every control below does not make a
> deployment HIPAA compliant. Compliance additionally requires executed Business Associate
> Agreements with every vendor that touches PHI, a documented risk analysis, administrative
> and physical safeguards, workforce training, incident-response and breach-notification
> procedures, and written policies. The architecture is designed to *make* compliance
> achievable; it does not confer it.

---

## 1. Tenant-security model

Four independent layers. Any one alone would be a single point of failure.

### Layer 1 — Tenancy comes from the session, never the client

`organizationId` is resolved server-side from the authenticated session and the user's
membership. There is no code path that reads a tenant identifier from a request body, query
parameter, header, cookie, or client-supplied token claim. Users who belong to multiple
organizations switch tenants through an explicit, audited action that mints a new session
binding — not by changing a value in a request.

### Layer 2 — Tenant-bound data access

Prisma is reachable only from `lib/repositories/**`. That module builds its client through a
`$extends` extension that, for every model carrying `organizationId`:

- injects `where: { organizationId }` into `findMany`, `findFirst`, `findUnique`, `count`,
  `aggregate`, `groupBy`, `update`, `updateMany`, `delete`, `deleteMany`;
- injects `data: { organizationId }` into `create`, `createMany`, `upsert`;
- throws if a caller supplies a conflicting `organizationId`.

A separate, explicitly named `unsafeCrossTenantClient` exists for the seeder, the ICD-10
importer, and platform-admin tooling. Its use is grep-able and CI counts its call sites.

### Layer 3 — PostgreSQL Row-Level Security as a backstop

Every tenant table gets:

```sql
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON referrals
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
```

The application connects as a role **without** `BYPASSRLS` and **without** table ownership.
Each request opens a transaction that issues `SET LOCAL app.current_org_id = $1`. If the ORM
layer has a bug, the database still refuses to return the row.

*Trade-off, stated plainly:* this requires interactive transactions and a connection pooler
in transaction mode, and it adds a round trip per request. It is a **backstop** — the
application layer must be correct on its own. If Phase 2 benchmarking shows the cost is
unacceptable for the inbox's hot paths, the fallback is RLS on read paths only, plus
stricter repository tests. That decision gets made with numbers, not guesses.

### Layer 4 — Tests that would fail if any of the above regressed

A generated suite enumerates every tenant-scoped Prisma model and, for each, asserts that an
actor in org A cannot read, list, count, update, delete, relate-to, or export org B's rows —
through the repository layer, through every server action, and through raw SQL under the app
role. New models fail the suite until they are covered. Tenant isolation is not a feature to
test once; it is an invariant with a standing test.

---

## 2. Roles and minimum necessary access

Permissions are strings (`referral:read`, `referral:assign`, `patient:read`,
`document:download`, `triage:override`, `rules:publish`, `marketing:read`, `report:read`,
`audit:read`, `user:manage`, `config:manage`). Roles are permission bundles, stored per
organization so an org can create custom roles later without a code change.

| Permission area | ADMIN | MANAGER | COORDINATOR | FRONT DESK | MARKETING |
| --- | :-: | :-: | :-: | :-: | :-: |
| Referral read / process | ✓ | ✓ | ✓ | limited | ✗ |
| Referral edit | ✓ | ✓ | ✓ | limited | ✗ |
| Assign referrals | ✓ | ✓ | ✗ | ✗ | ✗ |
| Patient demographics | ✓ | ✓ | ✓ | ✓ | ✗ |
| Documents view/download | ✓ | ✓ | ✓ | ✗ | ✗ |
| Triage override | ✓ | ✓ | ✓ | ✗ | ✗ |
| Rules / requirements / payers | ✓ | ✗ | ✗ | ✗ | ✗ |
| Operational reports | ✓ | ✓ | ✗ | ✗ | ✗ |
| Referring orgs & providers | ✓ | ✓ | read | read | ✓ |
| Marketing interactions | ✓ | ✓ | ✗ | ✗ | ✓ |
| Aggregate referral-source performance | ✓ | ✓ | ✗ | ✗ | ✓ |
| Audit log | ✓ | ✗ | ✗ | ✗ | ✗ |
| Users & roles | ✓ | ✗ | ✗ | ✗ | ✗ |

**The MARKETING role is PHI-minimized structurally, not by hiding UI.** Marketing users are
served by dedicated repository methods that return aggregate projections only — counts,
rates, dates, referring-office attribution. There is no server action reachable by a
marketing-only session that returns a patient name, DOB, document, or clinical finding.
Marketing attribution shows *"referral received 6 days after outreach"*, never *which*
patient.

Enforcement is server-side at three points: route middleware, the
`withAuthorizedAction(permission, …)` wrapper on every mutation, and the repository's own
actor check. Client-side hiding of links is cosmetic and is never the control.

---

## 3. Application security controls

| Control | Approach |
| --- | --- |
| Authentication | Auth.js v5, database sessions (server-revocable), Argon2id password hashing, TOTP MFA required for all users |
| Session lifetime | 15-minute idle timeout, 12-hour absolute, revoke-all on password/role change |
| Brute force | Per-account and per-IP rate limits with lockout; generic failure messages |
| Authorization | Server-side only; permission checks in middleware + action wrapper + repository |
| Transport | TLS 1.2+ enforced, HSTS with preload |
| At rest | Database and object-store encryption (AES-256, managed keys); `member_id` and MFA secrets additionally application-encrypted |
| Input validation | Zod schemas at every trust boundary; parsed types flow inward, raw input never does |
| SQL injection | Parameterized queries via Prisma; no string-built SQL |
| XSS | React escaping; no `dangerouslySetInnerHTML`; strict CSP with nonces; extracted document text rendered as text nodes only |
| CSRF | SameSite=Lax + Origin verification on Server Actions |
| Headers | CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` |
| Rate limiting | Auth endpoints, document upload, document streaming, search, export |
| Secrets | Environment variables only; nothing in the repo; a CI secret scan |
| File uploads | §4.2 of ARCHITECTURE.md |
| Document delivery | Authorized, audited proxy route with short-TTL signed URLs; object store never public |
| Backups | Automated encrypted backups, PITR, quarterly documented restore drill |

### PHI containment rules (mechanically enforced, not just documented)

1. **No PHI in URLs.** Routes carry opaque UUIDs and page numbers only. No names, DOB, MRN,
   diagnosis text, or member IDs in paths or query strings — this is what makes referrer
   headers, browser history, proxy logs, and web analytics safe by construction.
2. **No PHI in application logs.** A structured logger with a field denylist and redaction;
   errors log codes and IDs, never record contents. A CI test pushes a PHI-laden fixture
   through the logger and fails if any value appears in the output.
3. **No PHI in third-party analytics.** Product analytics, if used at all, receives route
   *patterns* (`/referrals/[id]`) and never resolved paths or payloads.
4. **No PHI in error monitoring.** Sentry `beforeSend` scrubs request bodies, query strings,
   and known PHI fields; breadcrumbs disabled for form inputs.
5. **No PHI to unapproved AI providers.** Code-enforced gate, `ARCHITECTURE.md` §9.2.
6. **No PHI in audit metadata.** Audit rows record *which field changed*, not the value.
7. **No PHI in queue payloads.** Jobs carry IDs.
8. **No PHI in outbound notification bodies.** Notifications say "Referral needs review" plus
   a link, never a patient name.

---

## 4. Major HIPAA and security risks

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| 1 | Cross-tenant data exposure | Breach across customers | Four-layer isolation + standing test suite (§1) |
| 2 | Vendor receives PHI without a BAA | Regulatory violation | Vendor register (§5); AI gate refuses egress without confirmed BAA + retention + training opt-out |
| 3 | PHI in logs, errors, analytics, URLs | Silent, wide, hard to remediate | Eight containment rules above, with CI enforcement |
| 4 | Over-broad staff access | Minimum-necessary violation | Role matrix, marketing PHI-minimized structurally, audited views |
| 5 | Document store misconfiguration (public bucket) | Mass PHI exposure | Private-by-default IaC, block-public-access, no direct client access, proxy-only delivery, config test in CI |
| 6 | Insider misuse / snooping | Undetectable without records | Access-level audit on every patient/referral/document view and download; admin review UI |
| 7 | Malicious PDF exploiting the parser | RCE in the worker | Sandboxed worker, JS-disabled parsing, AV scan, quarantine, no headless browser rendering |
| 8 | Credential compromise | Account takeover | MFA for all, Argon2id, lockout, revocable server-side sessions, audited logins |
| 9 | Backup exposure | Breach via secondary copy | Encrypted backups, restricted restore role, access-audited |
| 10 | Rule/AI error causing patient harm | Clinical and legal | Human confirmation always required; RED needs primary-context strong match; no auto-decline; no auto-communication to patients |
| 11 | Retention drift (records kept forever) | Expands breach surface | Configurable retention for documents and derived text; audit retained ≥ 6 years |
| 12 | De-identification treated as sufficient | False safety | Explicitly documented as defense in depth only, never a BAA substitute |
| 13 | Payer-based RED perceived as a coverage denial | Legal/contractual | Payer rules route to a human with the contractual reason surfaced; the product never generates a denial of care |
| 14 | Marketing attribution used to reward referral volume | Anti-Kickback / Stark exposure | Attribution is descriptive and labeled as association; no per-provider compensation, incentive, or payment feature — see `OPEN-QUESTIONS.md` Q-4 |

---

## 5. External services — and which would handle PHI

**Would handle PHI → BAA and security review required before production.**

| Vendor | Role | PHI? | Why this one |
| --- | --- | :-: | --- |
| **Vercel** | App hosting | **Yes** | Best-in-class Next.js DX. *BAA is Enterprise-tier only* — a material cost decision, see Q-1. |
| **AWS (ECS/Fargate or App Runner)** | Alternative app + worker hosting | **Yes** | Standard AWS BAA covers HIPAA-eligible services; the worker needs a container host regardless of where the app lives |
| **AWS RDS PostgreSQL** *or* **Neon** *or* **Supabase** | Database | **Yes** | RDS: BAA-covered, boring, proven. Neon/Supabase: faster to start, BAA on paid business tiers. See Q-1. |
| **AWS S3** (or Supabase Storage) | Document storage | **Yes** | SSE-KMS, object lock, versioning, mature access controls |
| **Anthropic API** *or* **AWS Bedrock** | Document intelligence | **Yes** | Bedrock inherits the AWS BAA and keeps data in-region; Anthropic direct also offers a BAA. Either is acceptable; both are behind the same interface |
| **AWS Textract** *(optional)* | OCR of scanned faxes | **Yes** | Only if in-worker Tesseract accuracy proves insufficient; BAA-covered |
| **Sentry** | Error monitoring | **Possibly** | BAA available on Business tier; must be configured with aggressive scrubbing, or self-hosted |
| **AWS KMS / Secrets Manager** | Keys and secrets | Indirect | Envelope encryption, rotation, audited access |
| **Documo / Concord / Sfax** *(future)* | Secure fax in/out | **Yes** | Required before any automated transmission of a records request |
| **Eligibility clearinghouse** *(future)* | Payer verification | **Yes** | Availity / Change-type vendor, BAA required |
| **NextGen** *(future)* | EHR integration | **Yes** | Behind the `EhrProvider` interface from day one |

**Would not handle PHI.**

| Vendor | Role | Notes |
| --- | --- | --- |
| GitHub | Source control | No PHI in the repo, ever. Secret scanning + Dependabot on. |
| Auth.js (self-hosted) | Authentication | Deliberately self-hosted so staff credentials and sessions stay in our database and no identity vendor enters the PHI conversation |
| pg-boss | Job queue | Runs inside our own Postgres — this is why it was chosen over Redis/SQS |
| Tesseract (in-worker) | Default OCR | No egress at all |
| CMS / NCHS ICD-10-CM release | Reference data | Public domain |
| Playwright / Vitest / CI | Testing | Synthetic fixtures only; never real patient data |

**Explicitly excluded:** any general-purpose analytics, session-replay, heatmap, chat-widget,
or A/B-testing script on authenticated pages. Session replay in particular would capture PHI
from the screen and is prohibited outright.

**CPT:** not licensed, not scraped, not reproduced. The service-code architecture is
designed as an empty seam; if CPT content is ever needed it must arrive under an AMA
license. The system never infers a CPT code from a diagnosis, never asserts medical
necessity, and never generates a claim.
