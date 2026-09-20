# Dental Coding Assistant

A CDT coding assistant for small and independent dental practices, focused on
**general dentistry**.

> **Tell us what you did. We'll help you identify the appropriate code, check the
> documentation, and catch potential problems before the claim goes out.**

This is not a searchable code database. It reads a description of a procedure —
in the shorthand a practice actually types — extracts the clinical facts,
retrieves candidate codes from an approved reference database, and either
recommends one or **asks a question rather than guessing**.

---

## The rule the whole design hangs on

**The language model never supplies a procedure code.**

That is enforced structurally, not by prompt wording:

| Step | What does it | Can it name a code? |
| --- | --- | --- |
| Extract clinical facts | Claude + deterministic rules | No — the response schema has no field for one |
| Identify procedure family | Controlled vocabulary | No |
| Retrieve candidates | `CodeRepository` (database) | This is the only source of codes |
| Rank candidates | Deterministic attribute matching | No |
| Review documentation | Deterministic rules | No |
| Validate before render | Re-checks every code against the dataset | Removes anything unverifiable |

A test drives a deliberately hostile extraction provider that invents teeth,
surfaces and materials, and tries to smuggle code numbers through every text
field it has. None of it reaches the screen.

---

## Running it locally

### Fastest path — no credentials at all

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET
npm run dev
```

With only `SESSION_SECRET` set, the coding engine runs against the demo dataset
held in memory and extracts facts with the rules engine. Shorthand like
`MOD composite #30` and `exam bwx cleaning fluoride` works. Accounts, history
and saved cases need a database.

### Full setup

```bash
npm install
cp .env.example .env
# Set SESSION_SECRET (openssl rand -base64 32), DATABASE_URL, DIRECT_DATABASE_URL

npm run db:deploy             # apply migrations, including row-level security
npm run db:seed               # demo dataset + two fabricated practices
npm run dev
```

Sign in with any seeded address — `owner@riverside.example`,
`office@riverside.example`, `front@riverside.example` — and the password
`correct-horse-battery-staple`. `owner@riverside.example` is also a platform
admin and can open `/admin`.

### The database needs two roles

```sql
CREATE ROLE dental_owner LOGIN PASSWORD '...';   -- owns the schema, runs migrations
CREATE ROLE dental_app   LOGIN PASSWORD '...';   -- the application connects as this
CREATE DATABASE dental_coding OWNER dental_owner;

\c dental_coding
GRANT USAGE ON SCHEMA public TO dental_app;
GRANT CREATE ON SCHEMA public TO dental_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE dental_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dental_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dental_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dental_app;
```

`dental_app` **must not** be a superuser and **must not** have `BYPASSRLS`.
Row-level security is only a real backstop if the application is subject to it —
an integration test asserts this and fails if it is not.

Supabase works: use the pooler URL for `DATABASE_URL` and the direct URL for
`DIRECT_DATABASE_URL`.

### Verifying it

```bash
npm run typecheck
npm run lint
npm test          # 80 tests
npm run build
```

The engine and guardrail tests need no database and no API key. The tenant
isolation tests under `tests/integration` skip themselves when `DATABASE_URL`
is absent.

---

## Environment variables

| Variable | Required | What it unlocks |
| --- | --- | --- |
| `SESSION_SECRET` | **Yes** | HMACs session, invitation and reset tokens. 32+ random bytes. |
| `DATABASE_URL` | No | Accounts, history, saved cases, usage, admin. The app role. |
| `DIRECT_DATABASE_URL` | No | Migrations and the code importer. Needs DDL rights. |
| `ANTHROPIC_API_KEY` | No | Understanding longer free-text notes. Server-side only. |
| `APP_URL` | No | Absolute links in invitation and reset URLs. |
| `STRIPE_*` | Not used yet | Reserved. See *Before production*. |
| `EMAIL_*` / `RESEND_API_KEY` | Not used yet | Reserved. Invitation and reset delivery. |

Nothing is exposed to the browser. There is no `NEXT_PUBLIC_*` variable in the
project, and the Anthropic key is read only inside server code.

---

## Architecture

```
src/
  app/
    (auth)/            sign-in, sign-up, password reset, invitation acceptance
    (app)/             the authenticated product
      dashboard/       three tools, recent searches, saved cases
      find-a-code/     tool 1, with the clarification loop
      check-a-code/    tool 2, lookup + comparison
      documentation-check/  tool 3, note review
      claim-scrubber/  tool 4, not built — says so
      history/  cases/  settings/
    admin/             internal, cross-tenant, aggregates only
  lib/
    coding/            THE ENGINE — pure, no database, no framework
      teeth.ts         tooth validation (1-32, A-T) and derived anatomy
      surfaces.ts      surface normalisation and counting
      vocabulary.ts    the controlled procedure vocabulary
      extract-deterministic.ts   rule-based extraction
      ai/              Claude, constrained to fact extraction
      extract.ts       merge: rules win, the model fills gaps
      rank.ts          deterministic ranking and elimination
      documentation.ts documentation review and completeness scoring
      pipeline.ts      orchestration, confidence, final validation
      tools.ts         the three tools as services
    codes/             the replaceable reference-data layer
    db/                tenant-scoped Prisma client
    auth/  authz/  usage/  billing/  admin/  tools/
data/demo-dataset/     the demo dataset (sample data, clearly labelled)
```

### Two enforced boundaries

ESLint fails the build on either being crossed:

1. **Database access stays in the data layer.** Everything else goes through a
   repository or service, so the tenant-scoping extension cannot be bypassed.
2. **The coding engine stays pure.** `src/lib/coding` may not import Prisma,
   the database client, or Next.js. That is what lets the entire reasoning
   layer be tested with no infrastructure.

### Tenant isolation, in three layers

1. **Session-derived tenancy.** `organizationId` comes only from the session
   row — never from a request body, header or query parameter.
2. **A Prisma extension** injects `organizationId` into every query on a
   tenant-scoped model, and rejects a write that names a different one.
3. **PostgreSQL row-level security**, generated from the schema by
   `scripts/gen-rls-migration.mjs` so a new model cannot arrive without a
   policy. The generator throws if it meets a table it cannot classify.

### Confidence

`HIGH` requires that the facts supplied actually distinguish the
recommendation from its rivals — one surviving candidate, nothing left open.
Where candidates disagree on a fact the note does not settle, the engine asks
a targeted question instead of breaking the tie. It asks **only** where the
answer would change the code.

---

## Where licensed CDT data plugs in

CDT is maintained by the American Dental Association and using it commercially
requires a license from them. This repository contains **no CDT descriptor
text**.

The seam is one file format and one script:

- `src/lib/codes/dataset-schema.ts` — the dataset format. It **refuses** a
  dataset marked `DEMO` that carries `officialDescriptor` text.
- `scripts/import-codes.ts` — the importer.

To switch to licensed data:

```bash
# 1. Obtain a CDT license from the ADA.
# 2. Convert the distribution to the dataset format, with the official
#    descriptor in `officialDescriptor` and kind set to "LICENSED".
# 3. Put the file in data/licensed/ (gitignored — never committed).
npm run codes:import -- data/licensed/cdt-2026.json --activate
```

Nothing else changes. The engine retrieves from whichever dataset is active,
and the UI shows the official descriptor only when one is present.

Our own writing — `shortLabel`, `plainLanguage`, `commonUse`, `distinctions`,
`documentationConsiderations`, `verifyQuestions` — is a separate set of fields
and stays ours across a dataset swap. The demo dataset's code *numbers* are
real; every word of description in it was written independently for this
application and is not the ADA's.

---

## Privacy and PHI

**This application is not HIPAA compliant, and nothing here claims it is.**
Technical safeguards are necessary but nowhere near sufficient — compliance
also requires agreements, policies, training, risk analysis and vendor BAAs
that do not exist yet.

What the MVP does instead:

- Tells users plainly, above every clinical input: *do not enter
  patient-identifying information*.
- Keeps the structured logger unable to emit clinical text or identifiers. It
  redacts by key name and refuses to serialise unkeyed free text. A guardrail
  test pushes a deliberately awful payload through it and fails if anything
  survives.
- Lets a practice turn off retention of input text entirely
  (Settings → *Keep the text of searches*). The answer is still produced; the
  wording is discarded.
- Records usage and AI cost with counts and enum values only — never content.
- Sends only what the user typed to the AI provider, from server code, and
  never when no key is configured.

See *Before handling PHI* below.

---

## Status

### What works

- All three tools, end to end, including the clarification loop.
- Sign-up with practice creation, sign-in, sign-out, password reset,
  invitations, Owner/Admin/Member roles.
- History, saved cases, settings, internal admin.
- Tenant isolation, verified against a live PostgreSQL instance.
- 80 automated tests.

### What needs external credentials

| Missing | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Long free-text notes fall back to the rules engine. **The live API call has not been exercised** — the code is typechecked and its merge behaviour is covered with a stub provider, but no request has been made against the real API from this environment. |
| `DATABASE_URL` | No accounts, history, saved cases or admin. The tools still run. |
| Email provider | Reset and invitation links are printed to the server console in development and shown to the inviter in the UI. Neither reaches a real inbox. |
| Stripe | No payment is collected. Every practice is on a trial. |

### Before production

1. Connect Stripe: a webhook route writing to the existing `subscriptions`
   columns, and a checkout session. No other change is needed.
2. Connect an email provider for invitations and password resets.
3. Move `SESSION_SECRET` into a managed secret store; stop deriving the
   application encryption key from it.
4. Add rate limiting to the auth routes and the coding endpoints.
5. Add error tracking and uptime monitoring.
6. Replace the demo dataset with licensed CDT data (above).
7. Have a dentist review the demo dataset's plain-language text and the
   documentation rules. The coding logic is sound; the *content* deserves
   clinical review before anyone bills against it.

### Before handling PHI

Everything above, plus:

1. A signed BAA with every vendor in the path — hosting, database, and
   Anthropic.
2. Encryption at rest with managed keys, and TLS everywhere.
3. An append-only audit log of access to clinical content. The schema has room
   for it; it is not built.
4. Tighter session timeouts and mandatory MFA. Sessions are deliberately long
   now because the product holds no PHI.
5. A documented retention and deletion policy, with automated enforcement.
6. Risk analysis, workforce training, incident response, and a breach
   notification procedure.
7. Only then, remove the "do not enter patient information" notice.

### Before using official CDT data commercially

1. A CDT license from the American Dental Association covering redistribution
   inside a software product.
2. Import through `scripts/import-codes.ts` with `kind: "LICENSED"`.
3. Display the attribution and notices the license requires.
4. A per-year update process — CDT changes annually, and the dataset format is
   versioned to make a swap routine.

---

## Recommended next five features

1. **Claim Scrubber.** The registry entry, the page and the comparison logic
   already exist; it needs a batch input and a per-line report.
2. **Practice code preferences.** Let a practice record how it codes a
   recurring situation, and have the engine surface that choice next time.
3. **Fee schedule and revenue impact.** Show what a coding difference is worth.
   This is the feature that makes the subscription obviously pay for itself.
4. **Bulk documentation review.** Paste a day's notes, get one report. Office
   managers work in batches, not one note at a time.
5. **Payer-specific rules, sourced and dated.** Only with a verified source
   attached to each rule — the product must never invent a payer requirement.

---

## Product rules

The application will not:

- fabricate a CDT code, or explain one it cannot verify;
- fabricate a clinical fact;
- tell anyone to document something that did not happen;
- guarantee reimbursement, or state that a payer requires something without a
  verified source;
- present a high-confidence recommendation built on an assumption it has not
  shown you.

Where it is uncertain, it asks. Where several codes remain plausible, it
explains the distinction. Where documentation is incomplete, it says what is
missing — as a statement of absence, never as a suggestion to add something.

Final coding and billing decisions remain the responsibility of the dental
practice.
