# Architecture

## The coding engine

Seven steps. The language model appears in exactly one of them.

```
input text
    │
    ├─ 1  EXTRACT FACTS ─────────────────────────────────────────────
    │     extract-deterministic.ts   rules: teeth, surfaces, counts,
    │                                materials, negation
    │     ai/anthropic.ts            Claude: prose the rules cannot parse
    │     extract.ts                 merge — rules win, the model fills gaps
    │
    ├─ 2  IDENTIFY FAMILY ───────────────────────────────────────────
    │     vocabulary.ts              controlled procedure vocabulary
    │
    ├─ 3  RETRIEVE CANDIDATES ───────────────────────────────────────
    │     CodeRepository             THE ONLY SOURCE OF CODES
    │
    ├─ 4  DETERMINE WHAT IS MISSING ─────────────────────────────────
    │     rank.ts + documentation.ts  only facts that change the code
    │
    ├─ 5  RANK ──────────────────────────────────────────────────────
    │     rank.ts                    eliminate on contradiction,
    │                                score on match, confidence
    │
    ├─ 6  REVIEW DOCUMENTATION ──────────────────────────────────────
    │     documentation.ts           weighted, explainable completeness
    │
    └─ 7  ASSEMBLE AND VALIDATE ─────────────────────────────────────
          pipeline.ts                re-check every code against the
                                     dataset before it is rendered
```

### Why the model cannot name a code

The extraction schema in `src/lib/coding/facts.ts` has no field for one. A
model that returned a code would have nowhere to put it, and structured outputs
would reject the response. Codes enter only through `CodeRepository`, whose
methods all take structured queries — there is no method that accepts free text
and returns a code the caller has not justified.

`validateResult` then re-checks every code in the assembled output against the
database. It should never fire; it exists so that if it ever does, the failure
is a *missing* recommendation rather than an invented one.

### Why rules run first

A regular expression that matched `#30` is more trustworthy about the tooth
than a model is. The failure mode that matters most — a confidently wrong fact
silently steering code selection — is the one this ordering removes. The model
may **add** facts the rules missed; it may never **overwrite** one they found.
User answers to clarifying questions override both.

Everything the model returns is re-validated: tooth numbers through
`parseTooth`, surfaces through `parseSurfaceAnswer`, procedure kinds against
`PROCEDURE_KEYS`. A hallucinated tooth `#45` or an invented procedure key is
dropped here, not rendered.

### Ranking, and when to ask

Two mechanisms:

**Elimination.** A candidate whose required attribute contradicts a stated fact
is removed. A three-surface note cannot be a two-surface code; an anterior
tooth cannot take a posterior code.

**Unresolved discriminators.** Where surviving candidates disagree on an
attribute the note does not settle, that is recorded as an open question rather
than broken by a tie-break. This is what makes the engine ask instead of guess.

A question is asked **only** when answering it would change the outcome. If one
candidate remains, nothing is open — asking would be a question with a single
possible answer. Category-level documentation rules are additionally filtered
by whether the fact bears on that procedure at all, which is what stops the
engine asking a crown which surfaces were restored.

**Confidence.** `HIGH` requires one surviving candidate with nothing open, or a
clear scoring gap with nothing open. Anything less says so.

**Showing the choice.** While candidates remain, they are rendered side by side
with the attribute values that separate them, read off the codes themselves,
plus a note naming what the choice depends on. The targeted question stays as
well: someone who knows the distinction reads the answer off the table, while
someone who does not is told exactly what to supply.

### Deterministic work the model is not trusted with

- Tooth validation: permanent 1–32, primary A–T, with anterior/posterior,
  arch, quadrant and molar status derived by lookup.
- Surface normalisation and counting. Buccal, facial and labial normalise to
  one value, or `MB` and `MF` would count as different restorations.
- Rejecting shorthand that is really a word: `MOD` inside "moderate" is not
  three surfaces, and a lone `B` is as likely to be an initial as a surface.
- Negation: "no bone removal or sectioning" describes a *simple* extraction.
- Distinguishing a restoration being removed from one being placed. "Existing
  MOD amalgam was removed. MOD composite placed." is two restorations and one
  procedure — and it is the phrasing dental notes use most.

## Evidence: tracing a fact to its source

Every fact carries the character span of the input it was read from, so a
coder can check the engine's reading rather than take it on trust.

| Origin | Meaning | Highlighted |
| --- | --- | --- |
| `matched` | a rule matched this span directly | yes |
| `quoted` | the model quoted text and we located the quote | yes |
| `derived` | follows from another fact (#30 is posterior) | no — nobody wrote it |
| `unlocated` | the model supplied it but its quote was not found | no |

Two rules keep the highlights honest. Model-supplied facts are located by
searching for the text the model *quoted*, never by trusting an offset it
returned — an invented offset would highlight the wrong words with complete
confidence. And derived facts get no span at all, because marking one would
claim the user wrote something they did not.

`buildHighlights` emits a flat list of runs rather than nested markup, so a
span claimed by two facts (the tooth and the procedure frequently overlap)
renders once and is attributed to both.

## The reference-data layer

```
Dataset file (JSON)
    │  validated by DatasetSchema — refuses official descriptor text
    │  in a dataset marked DEMO
    ▼
scripts/import-codes.ts
    ▼
PostgreSQL  ──┐
              ├──▶  CodeRepository  ──▶  the engine
Demo file  ───┘        (interface)
```

Two implementations satisfy `CodeRepository`: `PrismaCodeRepository` and
`MemoryCodeRepository`. The second is not a stub — it is what the engine's test
suite runs against, and what the application falls back to when no database is
configured, which is what lets the whole product be demonstrated before any
infrastructure exists. The engine cannot tell them apart.

### The licensing boundary

| Field | Whose | Present in demo |
| --- | --- | --- |
| `code` | a short factual identifier | yes |
| `officialDescriptor` | licensed distribution | **never** |
| `shortLabel`, `plainLanguage`, `commonUse`, `distinctions` | ours | yes |
| `documentationConsiderations`, `verifyQuestions` | ours | yes |
| attributes, relationships | ours | yes |

Our writing and the licensed descriptor are separate fields, so a dataset swap
replaces one and keeps the other. `DatasetSchema` rejects a `DEMO` dataset
carrying `officialDescriptor`, and a guardrail test asserts the demo file
carries none.

## Adding Claim Scrubber

The architecture anticipates it:

1. `src/lib/tools/registry.ts` already lists it. Change `status` to
   `AVAILABLE`.
2. Add `claimScrub()` to `src/lib/coding/tools.ts`. The comparison logic it
   needs — code versus documented facts — is `compareSelected` in
   `pipeline.ts`, already used by Check a Code and Documentation Check.
3. Replace the placeholder page with a batch input and a per-line report.
4. `CodingTool.CLAIM_SCRUBBER` is already in the schema, so history, usage
   accounting and the admin feature breakdown pick it up with no migration.

Nothing else needs to learn it exists: the registry drives the dashboard, the
sidebar and the mobile nav from one array.

## Enforced boundaries

ESLint fails the build on either being crossed:

1. **Database access stays in the data layer** (`src/lib/db`, `codes`, `auth`,
   `usage`, `billing`, `admin`). Everything else goes through a repository or
   service, so the tenant-scoping extension cannot be bypassed by a stray
   import.
2. **The coding engine stays pure.** `src/lib/coding` may not import Prisma,
   the database client, or Next.js — with one deliberate exception,
   `queries.ts`, which is the persistence seam for engine output. That is what
   lets the entire reasoning layer be tested with no infrastructure.

## Testing

| Suite | Needs | Covers |
| --- | --- | --- |
| `tests/engine/find-code` | nothing | the required behaviours, end to end |
| `tests/engine/safety` | nothing | fabrication, mismatch, the hostile provider |
| `tests/engine/check-code` | nothing | lookup, refusal, comparison |
| `tests/engine/documentation-check` | nothing | note review and scoring |
| `tests/engine/ai-augmentation` | nothing | the rules-win merge policy |
| `tests/guardrails/dataset` | nothing | the licensing boundary |
| `tests/guardrails/logging` | nothing | clinical text never reaches a log |
| `tests/integration/tenant-isolation` | PostgreSQL | RLS, the role requirement |

The integration suite skips itself without `DATABASE_URL`, so the default
`npm test` runs anywhere.
