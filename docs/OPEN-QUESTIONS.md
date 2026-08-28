# Requirements I Recommend Changing, and Decisions I Need

Item 16 of the brief asks what I would change before development. Item 64 asks me to raise
consequential assumptions rather than make them silently. Both are below.

---

## Part A — Recommended changes to the requirements

### A-1. Vercel alone cannot host this. *(Highest impact)*

The brief specifies Vercel "where appropriate." Two problems:

1. Vercel signs a BAA only on **Enterprise**. Pro is not an option for PHI.
2. Serverless functions cap at 300 seconds. OCR of a 100-page scanned fax does not fit.

**Recommendation:** keep Next.js, but deploy the app and a long-running worker container to
a host with an accessible BAA (AWS ECS/Fargate, App Runner, Fly.io, or Render), or accept
Vercel Enterprise for the app and put the worker on AWS. Either way the worker is separate.
This is decision Q-1.

### A-2. "Confidence in absence: 91%" should not be a percentage.

§22 asks for a confidence-in-absence score when a required document is not found. A
calibrated probability that a document is absent from a packet is not achievable at MVP —
there is no labeled data to calibrate against, and a precise-looking number invites staff to
trust it.

**Recommendation:** replace it with **search coverage**, which is honest and computable:

```
DXA REPORT — not detected
Searched 63 of 63 pages · 61 pages high-quality text, 2 pages low-quality OCR
Detectors: "DXA", "dual-energy X-ray absorptiometry", "bone mineral density",
           "T-score", "BMD"                                    [Mark as present]
```

Keep the *found* case as a confidence percentage (that one is measurable — it is the strength
of a match that exists). Revisit a true absence probability in Phase 5 once the evaluation
harness has real labels.

### A-3. RED rules must require primary context, or they will hurt someone.

A 60-page packet for a patient with rheumatoid arthritis will frequently contain the word
"fibromyalgia" somewhere — a past visit, a problem list, a family history line. Under a naive
text rule, that referral turns RED and the patient is not scheduled.

**Recommendation, already built into §5.4 of the architecture:** every RED rule requires a
**strong match** (exact code or code family) in a **primary context** (referral reason or
Assessment/Plan) with **affirmed polarity** and a confidence floor. A weak or incidental
mention can produce YELLOW for human review. It must never produce RED on its own. I would
like this treated as a non-negotiable product rule, not a tunable default.

### A-4. Marketing attribution should stay descriptive — and stop short of incentives.

Tracking that a referral arrived six days after outreach is legitimate operational analysis.
Building anything that ties referral *volume* from a specific referring provider to
compensation, incentives, gifts, or targeted spend moves toward Anti-Kickback Statute and
Stark territory, and the platform would be the evidence.

**Recommendation:** keep attribution and per-office volume reporting; label it "association,
not causation" in the UI (the brief already says this — I want it enforced in copy, not just
intent); and add an explicit non-goal: **no feature that computes or recommends
provider-level compensation, payment, gifts, or incentive tiers.** Practices should confirm
their outreach program with their own counsel. I am not offering a legal opinion here — I am
flagging where the product could make an existing risk worse.

### A-5. Payer-based RED must never look like a coverage denial.

Declining to schedule based on payer is an ordinary practice-management decision, but the
wording matters and the transmission matters more.

**Recommendation:** payer-RED routes to a human with the contract reason shown; the system
never auto-communicates anything to a patient or referring office about payer status, and
the generated missing-information template can never contain a denial. The disposition label
should read *"Not accepted — payer not contracted (review required)"* rather than a bare RED.

### A-6. Ship deterministic triage before document AI.

§55 permits staged development. I recommend taking it. Phases 2+3 deliver a complete,
useful referral workflow with staff-entered diagnoses. Phase 4's document intelligence then
lands on a system that already works, with real referrals to test against, rather than
being the thing everything else waits on. This also front-loads the parts that are certain
and defers the part with the widest estimate range.

### A-7. Enforce MFA for every user at launch.

The brief lists authentication generally. For a system holding PHI accessed by front-desk
staff on shared workstations, TOTP MFA for all users, a 15-minute idle timeout, and
server-revocable sessions should be launch requirements rather than hardening-phase items.
The cost is one Phase 2 day.

### A-8. Audit immutability needs a database-level guarantee.

§43 and §47 say audit records must not be edited or deleted. Application-level discipline is
not enough — grant the app role `INSERT` and `SELECT` only on `audit_logs`, and add a trigger
that raises on `UPDATE` or `DELETE`. Same for `referral_activities` and `triage_evaluations`.

### A-9. Add an intake-channel field now.

Live fax ingestion is out of scope for V1, but `referrals.intake_channel`
(`FAX | PORTAL | PHONE | EMAIL | MANUAL | API`) costs nothing today and prevents a painful
backfill when fax ingestion arrives. Same reasoning for the `outbound_events` outbox table.

### A-10. Business days need an organization calendar.

"No activity > 1 business day" and "waiting > 3 days" are not computable without the
organization's timezone, business hours, and holiday list. Small, but it must exist in Phase 2
or every SLA metric will be quietly wrong.

### A-11. Synonym data licensing.

SNOMED CT and UMLS carry license terms; ICD-10-CM from CMS is public domain. The MVP should
use a curated in-house synonym list plus CMS descriptions. If richer terminology is wanted
later, license it properly. Nothing gets scraped.

### A-12. Set explicit packet limits.

The brief says "100+ pages." Unbounded means an unbounded bill and an unbounded timeout.
Recommend defaults of 400 pages, 100 MB, and a 30-minute processing budget per document,
configurable per organization, with anything beyond that queued for staff review rather than
silently truncated.

---

## Part B — Decisions I need before Phase 2

These change the architecture materially, so I would rather ask than assume.

**Q-1 · Hosting and data platform.** Vercel Enterprise (BAA) + AWS worker; all-AWS
(ECS + RDS + S3); or Supabase (Postgres + storage, HIPAA add-on on Team plan) with the app
and worker on a container host? This decides the deployment model, the BAA list, and how RLS
is wired. *(Supabase tooling is already available in this session, which may indicate a
preference — say so if it does.)*

**Q-2 · AI posture for PHI at MVP.** Deterministic-only for V1 with the AI gateway built but
switched off; Bedrock or Anthropic under a BAA from day one; or de-identify-then-send? This
determines whether Phase 4 needs a signed BAA before it can be demonstrated on real packets.

**Q-3 · OCR at MVP.** In-worker Tesseract (no vendor, lower fax accuracy), AWS Textract
(better on faxes, BAA-covered, per-page cost), or native-PDF text only for V1 with scanned
faxes deferred? Roughly: how many incoming referrals are scanned faxes versus native PDFs?

**Q-4 · Authentication.** Self-hosted Auth.js with password + TOTP (my recommendation — no
identity vendor in the PHI conversation), Google Workspace / Microsoft Entra SSO if the
practice already uses one, or a managed provider (Clerk / WorkOS)?

Secondary questions, lower stakes, happy to proceed on my stated defaults if you have no
preference:

- The full payer list from your triage guide was referenced but not included in the brief.
  I will seed the payer *rule structure* and leave the specific payer entries for you to
  enter in `/settings/payers`, unless you want to send the list.
- Which EHR is in use, for the eventual integration seam? NextGen is mentioned in the
  exclusions — confirming it is the target shapes the `EhrProvider` interface.
- Roughly how many referrals per day, and how many concurrent staff? This sets the
  performance targets I design the inbox and reports against.
