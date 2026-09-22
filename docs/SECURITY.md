# Security and privacy

## 1. Tenant isolation

Every dental practice is an organization, and no practice may reach another's
searches, notes or saved cases. Three independent layers enforce this, so a
mistake in any one of them is caught by the next.

### Layer 1 — tenancy originates in the session

`organizationId` is read from the session row in `src/lib/auth/session.ts` and
nowhere else. It is never taken from a request body, header, query parameter,
or any other value a client can influence. Every server action begins by
resolving the actor, and the organization travels with it.

### Layer 2 — the Prisma extension

`src/lib/db/client.ts` wraps the client so that for every model carrying an
`organizationId`:

- reads have `organizationId` merged into `where`;
- writes have it stamped into `data`;
- a supplied `organizationId` that disagrees with the bound tenant raises
  `TENANT_MISMATCH` rather than being silently overridden — that combination
  means a bug worth surfacing.

The set of tenant-scoped models is derived from the schema at runtime, so
adding a model with an `organizationId` covers it automatically.

The tenant is held in a **closure** over the extended client, not in ambient
async context. Prisma promises are lazy: with `AsyncLocalStorage`, a call site
that returned a query without awaiting it inside the context would execute
after the context had been popped and would see no tenant at all. A closure
cannot drift.

### Layer 3 — PostgreSQL row-level security

Generated from the schema by `scripts/gen-rls-migration.mjs`, which throws if
it meets a table it cannot classify — a new model cannot quietly arrive
without a policy.

| Tier | Tables | Policy |
| --- | --- | --- |
| `TENANT` | coding queries, messages, saved cases, usage events, AI requests, subscriptions | visible only where `organizationId` matches the bound tenant |
| `BOOTSTRAP` | organizations, users, sessions, memberships, invitations, reset tokens | readable before a tenant is known |
| `REFERENCE` | code datasets, codes, attributes, relationships, documentation rules | readable by all; writable only by the table owner |

**Why BOOTSTRAP exists.** Resolving a session token is what *discovers* which
organization a request belongs to, so that lookup necessarily runs with no
tenant bound. A strict policy there would return zero rows and nobody could
sign in. These tables are still tenant-scoped at Layer 2 — only the
deliberately ugly `unsafeCrossTenantClient()` reaches them unscoped — and they
hold account records, not clinical content.

**Why REFERENCE is not `FORCE`d.** Procedure-code data is global and carries no
clinical content. Leaving `FORCE` off means the table owner — the role the
importer runs as — can load a dataset, while the application role, which does
not own the tables, is confined to `SELECT` by the policy.

### The role requirement

The application must connect as a role that is **not** a superuser and does
**not** hold `BYPASSRLS`. Otherwise Layer 3 is decoration.
`tests/integration/tenant-isolation.test.ts` asserts this and fails the suite
if it is not true.

### A bug worth recording

`set_config('app.current_org_id', ..., true)` is transaction-local. When that
transaction ends, PostgreSQL resets the setting to an **empty string** rather
than leaving it unset. A policy comparing against a bare
`current_setting('app.current_org_id', true)::uuid` therefore evaluated
`''::uuid` on the next unscoped query to reuse that pooled connection, and
raised *invalid input syntax for type uuid* instead of matching no rows. It
took out the admin area entirely and would have affected anything unscoped
under connection reuse.

Policies use `NULLIF(current_setting('app.current_org_id', true), '')::uuid`,
so the comparison yields `NULL` and the row stays invisible — the intended
behaviour. There is a regression test.

This was found by running the application, not by running the tests. It is the
argument for doing both.

## 2. Roles

Three roles, deliberately few:

| | Member | Admin | Owner |
| --- | --- | --- | --- |
| Use the coding tools | yes | yes | yes |
| Save cases | yes | yes | yes |
| See own history | yes | yes | yes |
| See the whole practice's history | | yes | yes |
| Delete saved cases | | yes | yes |
| Invite and manage members | | yes | yes |
| Change practice settings | | yes | yes |
| Manage billing | | | yes |

A practice must always retain at least one owner; demoting or removing the last
one is refused. Role changes and removals revoke that person's sessions
immediately rather than at next sign-in.

Platform administration is **not** a role. It is a flag on the user record with
no UI that can grant it, because it is a property of our staff rather than of a
practice.

## 3. Authentication

- Passwords: Argon2id, OWASP's second recommended configuration
  (19 MiB, t=2, p=1). Length-led validation per NIST SP 800-63B rather than
  composition rules.
- Sessions: a random 256-bit token in an `httpOnly`, `sameSite=lax` cookie,
  stored only as an HMAC. A database read cannot reconstruct a usable session,
  and a session can be revoked server-side.
- Sliding idle window (12h) capped by an absolute expiry (30 days). These are
  long on purpose: the product holds no PHI, and a chairside user signing in
  repeatedly all day is the fastest way to get a practice to stop using it.
  They tighten before PHI handling is enabled.
- Invitation and reset tokens are HMACed the same way and are single-use.
- A password reset revokes every session for that user.
- Sign-in returns one message for every failure mode, so the form cannot be
  used to discover which addresses have accounts. A password verification runs
  even when no user matched, so timing does not reveal it either.

## 4. Containment of clinical input

The product asks users not to enter patient identifiers. A log is the wrong
place to discover they did anyway.

`src/lib/logging/logger.ts` redacts by key name against a denylist covering
identifiers, clinical fields and credentials, and **refuses to emit unkeyed
free text at all**. Anything it does not recognise as safe is redacted rather
than serialised. `tests/guardrails/logging.test.ts` pushes a payload full of
names, dates of birth, member IDs and clinical text through it and fails if any
value survives.

`AppError.message` is rendered to the browser and written to logs, so it never
quotes clinical input; identifiers go in `meta`, restricted to opaque IDs and
field names.

Retention is a practice setting. With *Keep the text of searches* off, the
description is never written down — the structured result is stored, the
wording is discarded.

## 5. What reaches the AI provider

Only the text the user typed, sent from server code, only when
`ANTHROPIC_API_KEY` is set. The key is never exposed to the browser; there is
no `NEXT_PUBLIC_*` variable in the project.

The provider is constrained to extracting facts. Its response schema has no
field capable of carrying a procedure code, and everything it returns is
re-validated — tooth numbers through the tooth parser, surfaces through the
surface parser, procedure kinds against the controlled vocabulary — before any
of it is believed.

`src/lib/usage` records token counts, latency, cost and success for each
request. It records no content.

## 6. The audit log

`audit_events` records who accessed clinical content and who changed the
account, and is **append-only in the database**: the policy grants `INSERT`
and `SELECT` and grants no `UPDATE` or `DELETE`, so PostgreSQL refuses both
even for the application role. An audit log the application can rewrite is
worth nothing during the incident it exists for. An integration test inserts an
entry, attempts to change and delete it, and asserts the original survives.

Entries hold no clinical text. `subjectId` points at the row that was touched,
so an investigator can follow the reference while the content stays where it
already lives under its own access control. Opening a colleague's search is
itself recorded.

One deliberate weakness, recorded rather than hidden: a failed audit write is
logged and swallowed rather than failing the request. For a product holding no
PHI, refusing to show a result because the audit write failed is the worse
trade. **This must be revisited before PHI handling is enabled** — an auditable
system generally has to fail closed. Retention is also currently unbounded.

## 7. The admin area

Reads across every tenant by necessity, and is confined to
`src/lib/admin/metrics.ts`, gated on `isPlatformAdmin`. Every query in it is an
aggregate or an account-level field: counts, sums, enum values, timestamps.
Nothing selects `inputText`, note content, a result payload or a saved case's
notes. The return shapes have nowhere to put clinical content, so a careless
future addition cannot leak it either.

## 8. Not HIPAA compliant

Stated plainly because the opposite is commonly implied. Technical safeguards
are necessary and not remotely sufficient: compliance also requires business
associate agreements, policies, workforce training, risk analysis, incident
response and breach notification, none of which exist.

The README lists what must happen before PHI can be handled.
