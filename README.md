# Referral Operating System — Rheumatology Rule Pack (Working Title)

A HIPAA-conscious, multi-tenant referral management and referral intelligence platform that
sits **in front of** the EHR. It receives referrals, stages patients before EHR creation,
analyzes large referral packets, applies each organization's own deterministic triage rules,
and explains every recommendation back to its source page.

> **Status: Phase 2 (core platform) built and tested. Phases 3–9 not started.**

## Core principle

> AI reads the referral. The organization's rules determine the workflow.
> The system explains its reasoning. The human makes the final decision.

A referral does **not** automatically equal an EHR patient. Patients live in this system's
staging database until they progress far enough to be worth creating in the EHR.

## Documents

| Document | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture, document pipeline, rules engine, ICD-10 matching, confidence scoring, evidence model, AI abstraction, routes, component architecture |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Proposed relational schema, table by table |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Tenant-security model, RBAC, HIPAA risk register, vendor/BAA analysis |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Development phases with complexity estimates and exit criteria |
| [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) | Requirements recommended for change, and the decisions taken |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Implementation choices that differ from the plan, and why |

## Running it

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET to `openssl rand -base64 32`
npm run db:deploy             # apply migrations, including row-level security
npm run db:seed               # fabricated data: two organizations, all five roles
npm run dev
```

Sign in with any seeded address — `coordinator@lakeside.example`,
`admin@lakeside.example`, `marketing@lakeside.example` — and the password
`correct-horse-battery-staple`. Every account has TOTP enrolled;
`npx tsx scripts/dev-totp.ts <email>` prints a current code.

The database needs two roles: an owner that holds DDL, and an application role
with neither `SUPERUSER` nor `BYPASSRLS`. Row-level security is only a real
backstop if the application connects as a role it applies to.

## Verifying it

```bash
npm run typecheck     # strict TypeScript
npm run lint          # includes the architecture-layering rules
npm run test          # 81 unit and integration tests
```

The integration tests run against a real PostgreSQL as the application role —
testing tenant isolation through a privileged connection would prove nothing.

For an end-to-end check against a real build in a real browser:

```bash
npm run build && npm start &
BASE_URL=http://localhost:3000 npx tsx tests/e2e/smoke.mts
```

## What is built

Phase 2 is the referral workflow with staff-entered diagnoses: authentication
with mandatory MFA, four-layer tenant isolation, role-based access, the
pre-EHR patient staging database with duplicate detection, the referral inbox
and detail screen, the status workflow, the exception dashboard, touch-time
metrics, and an append-only audit trail.

Document upload and analysis (Phase 4), the triage rules engine (Phase 3) and
confidence scoring (Phase 5) are not built. The referral detail screen says so
where they will go.

## Not a compliance claim

Implementing the technical controls described here does not make a deployment HIPAA
compliant. Compliance additionally requires executed BAAs, administrative and physical
safeguards, a risk analysis, workforce training, and policies and procedures.
See [`docs/SECURITY.md`](docs/SECURITY.md).
