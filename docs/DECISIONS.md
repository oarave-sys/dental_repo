# Implementation Decisions

Choices made during Phase 2 that differ from the Phase 1 plan, or that a
reviewer would otherwise have to reverse-engineer from the code.

---

## D-1. Sessions are opaque database tokens, not Auth.js

**Planned:** Auth.js v5 with database sessions.
**Built:** a minimal opaque-token session layer.

Auth.js's Credentials provider mandates the JWT session strategy. A JWT cannot
be revoked server-side, cannot express an MFA step-up, and cannot carry a
sliding idle timeout — and all three are launch requirements here (A-7).

What was built instead is the standard, boring design: a 256-bit random token in
an httpOnly cookie, stored only as an HMAC, resolved by a database lookup on
every request. Roughly 150 lines in `src/lib/auth/session.ts`. Revocation,
idle expiry, absolute expiry and the MFA flag are all columns.

The cost is that SSO does not come for free. When Q-4 is revisited for Google
Workspace or Entra, an OIDC provider slots in beside this: the session table
does not change, only how a user proves who they are before one is issued.

## D-2. Tenancy is bound by closure, not by AsyncLocalStorage

The first implementation carried the current tenant in an `AsyncLocalStorage`
store that the Prisma extension read. It passed its tests and then failed in the
real application, which is the interesting part.

**Prisma promises are lazy.** A call site written as

```ts
withTenant(orgId, (tx) => tx.patient.findMany())     // no await inside
```

returns the promise without starting it. `run()` exits, the context is popped,
and the query executes afterwards seeing no tenant at all. Awaiting inside the
callback worked; returning did not. The two styles are indistinguishable at a
call site, which makes it exactly the kind of bug that reaches production.

`withTenant` now builds an extended client that closes over the organization ID.
A closure cannot drift out of scope. `tests/isolation` asserts both call styles
behave identically, so this cannot regress silently.

## D-3. Row-level security has two tiers, and no FORCE

**STRICT** — every PHI-bearing table. Unset tenant yields zero rows.

**BOOTSTRAP** — the identity tables (`organizations`, `sessions`, `memberships`,
`roles`, `membership_roles`, `invitations`, `organization_settings`). A session
token must be looked up *before* the organization is known, so these permit
access when no tenant is bound and restrict once one is. They hold PII, not PHI,
and are reached only by a secret token lookup.

`membership_roles` has no `organizationId` of its own and would have received no
policy at all; it is scoped through its membership with a subquery.

`FORCE ROW LEVEL SECURITY` is deliberately **not** set, so the table owner stays
exempt. Migrations, the seeder and retention jobs need cross-tenant access, run
offline as a privileged role, and are not the surface being defended — a leaked
request handler is. The application role has neither `SUPERUSER` nor
`BYPASSRLS`, so the policies bite where it matters.

A test reads the policies out of `pg_policies` and asserts the two tiers match
the sets the application layer uses, so the layers cannot drift apart.

## D-4. Writes name the tenant explicitly; reads have it injected

Prisma's generated types require `organizationId` on `create`, and defeating
that would mean substantial type surgery. Rather than fight it, the contract is
asymmetric on purpose:

- **Writes** name the tenant explicitly — TypeScript will not let you forget —
  and the extension *verifies* it matches the bound tenant, rejecting a mismatch
  rather than silently correcting it.
- **Reads** have it injected, because TypeScript does not require it there and
  forgetting is therefore possible.

Row-level security backstops both.

## D-5. Physical column names are camelCase

`docs/SCHEMA.md` writes columns in snake_case for readability. The database uses
Prisma's default camelCase (`organizationId`, not `organization_id`); table
names are snake_case via `@@map`. Mapping ~200 columns to change this would be
churn without benefit. The RLS generator reads real column names from
`information_schema`, so the two cannot disagree.

## D-6. shadcn/ui was not installed

The brief allows shadcn "where appropriate". Phase 2's UI is tables, badges,
forms and selects — none of which need Radix primitives, and installing shadcn
would add roughly ten dependencies against a brief that asks to avoid
unnecessary ones. `src/components/ui` is a small hand-written set using the same
conventions, and shadcn can be dropped in later without rework.

## D-7. Known dependency advisories

`npm audit` reports five advisories, all in build and development tooling — the
Prisma CLI's config chain (`@prisma/config`, `deepmerge-ts`) and PostCSS, which
Next pulls in at build time. None sit in the runtime request path. The only
available fix is a Prisma 8 release candidate, which is a worse trade than the
advisories. Recheck when Prisma 8 ships stable.

## D-8. A permission denial is a page, not an error

`withAuthorizedQuery` redirects to `/access-denied` rather than throwing into the
error boundary. A denial is a normal outcome and deserves a plain sentence; a
generic "something went wrong" both misleads the user and hides a signal worth
logging. The denial is recorded via `logger.warn('authz.denied')` — repeated
denials from one account are worth noticing.

## D-9. What Phase 2 deliberately does not do

No document upload or analysis, no triage rules engine, no confidence scoring —
those are Phases 3 to 5. The referral detail page says so where the intelligence
card will go, rather than showing an empty container. The schema already carries
`documents`, `intake_batches` and `intake_items` because `documents.referralId`
being nullable (a bulk-dropped packet exists before its referral does) is a
structural decision that is painful to retrofit.

---

## D-10. Requirements have three states, not two

The first Phase 3 implementation modelled a required document as `present:
boolean`. Seeding revealed what that means in practice: **every referral came
out INCOMPLETE**, because nothing had been ticked, and the system was therefore
asserting that documents were missing when nobody had looked at the fax yet.

That is the same error `docs/OPEN-QUESTIONS.md` A-2 argues against — claiming an
absence that has not been established. Requirements are now `PRESENT | ABSENT |
UNCHECKED`:

- **ABSENT** blocks, and produces the records request.
- **UNCHECKED** does not block. The documentation dimension reports UNKNOWN and
  the next action becomes *"Confirm the required documents, then contact
  patient"* rather than *"Request records"*.
- Only a human confirmation (or, from Phase 4, a packet search that ran and
  found nothing) turns UNCHECKED into ABSENT.

Human confirmations carry forward across re-evaluations. A coordinator's
statement about what is in a fax does not expire because the rules changed.

## D-11. Confidence penalties apply only to the dimension the decision rests on

An early version of the disposition-confidence formula subtracted 8 points for
*every* dimension with insufficient data. That quietly undermined the reason the
two scores are separate: a Medicaid exclusion was losing confidence because the
diagnosis was unclear, when an excluded payer is excluded whatever the patient
turns out to have.

Penalties now apply to the decisive dimension only — plus, when documentation
decides, to the diagnosis, because which documents are required depends on the
primary category. Caught by the test asserting a payer-RED stays ≥90 on a
low-confidence diagnosis.

## D-12. Non-primary categories are noted even when they could never block

The RED rules carry context and polarity filters so only a properly asserted
primary diagnosis can decline a referral. Applying those same filters when
deciding what to *tell* a coordinator was wrong: a fibromyalgia line in a
problem list can never block, but it is still worth showing.

Whether a category may BLOCK and whether it is worth SURFACING are separate
questions, and the engine now answers them separately.

## D-13. ICD-10 ranges are compared at category level

`M15`–`M19` covers osteoarthritis. Comparing full normalised codes
lexicographically excludes `M19.9`, because `"M199"` sorts after `"M19"`.
Range membership is therefore decided on the three-character category, which is
the unit ICD-10 ranges are actually defined in. There is a test for exactly this.

## D-14. ICD-10 reference data is not bundled

`diagnosis_codes` is a global, version-stamped table loaded from the annual
public-domain CMS ICD-10-CM release. The importer is a seam, not a bundled data
file: shipping a 70,000-row code set in the repository would bloat it and go
stale annually. The rule pack references code families and ranges directly, so
triage works before any import — the reference table adds descriptions and
search.
