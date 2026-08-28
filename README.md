# Referral Operating System — Rheumatology Rule Pack (Working Title)

A HIPAA-conscious, multi-tenant referral management and referral intelligence platform that
sits **in front of** the EHR. It receives referrals, stages patients before EHR creation,
analyzes large referral packets, applies each organization's own deterministic triage rules,
and explains every recommendation back to its source page.

> **Status: Phase 1 — architecture proposal. Awaiting approval. No application code has been written.**

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
| [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) | Requirements I recommend changing, and decisions I need from you |

## Not a compliance claim

Implementing the technical controls described here does not make a deployment HIPAA
compliant. Compliance additionally requires executed BAAs, administrative and physical
safeguards, a risk analysis, workforce training, and policies and procedures.
See [`docs/SECURITY.md`](docs/SECURITY.md).
