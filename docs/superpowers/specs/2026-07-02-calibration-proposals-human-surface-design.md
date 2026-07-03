# Calibration proposals human surface (roadmap v2.6b)

**Date:** 2026-07-02 · **Status:** SHIPPED v4.34.0 (2026-07-02) · **Roadmap:** v2.6b

Ship deviation from §4: `undo` is allowed on forged rows at the API level
(admin-only, audit-logged) so the smoke harness can clean up after itself;
the UI still offers no Undo on a forged strip.

v2.6 shipped the calibration flywheel's proposal half as a GitHub Actions
step summary with copy-paste forge commands. Wes rejected that flow the
same day ("I do not want to go into github and copy a command and run it
in a terminal"), which became the `HUMAN-EXPERIENCE.md` contract. This
item pays that debt: proposals become evidence cards in the product,
ratify/dismiss become buttons, and the human's judgment is recorded as a
first-class decision. The mechanical work — running the forge, committing
the fixture vector, fixing the scorer when `requires_model_fix` fires —
stays with the maintainer session (constitution §3: judgment is a click,
the corpus commit is the maintainer's).

Decision provenance: the roadmap entry's shaping (evidence cards, buttons,
maintainer keeps the mechanical commit, weekly feed) was ratified by Wes
2026-07-02. The two decisions the roadmap delegated to this spec —
surface location and transport — were decided in-session (Wes directive:
"continue with the roadmap", autonomous mode) with rationale below.

## Decision 1 — Surface: a third section on the /policies cockpit

`PolicyCockpit` (`app/policies/components/PolicyCockpit.tsx`) composes
`<ReviewFeed/>` then `<TuningProposals/>`. Calibration proposals become a
third section, `<CalibrationProposals/>`, appended the same way.

Why not a new page: calibration proposals are siblings of tuning
proposals — the same "mined evidence → human ratifies or dismisses"
shape — and policy owners already look at /policies (v2.1 put the
degradation strip there for exactly that reason). A new page would need
new nav, new discoverability, and would separate two review feeds a human
wants to triage in one sitting.

**Human-experience answers (HUMAN-EXPERIENCE.md):**

1. **Where does a human SEE it?** `/policies`, "Calibration proposals"
   section below Tuning proposals. Click path: sidebar nav → Policies →
   scroll.
2. **Is it discoverable?** Yes — it renders on a page operators already
   visit weekly for tuning proposals; no deep URL.
3. **Is every human step a CLICK?** Ratify and Dismiss are buttons with
   the cockpit's armed-confirm pattern. Zero terminal commands, zero
   GitHub visits for the human. The forge run + fixture commit are the
   maintainer *agent's* role, not the human's.
4. **Verified rendered?** frontend-verify drives /policies against a
   seeded near-real proposal and confirms the section, a card, and the
   ratify flow render and work.

## Decision 2 — Transport: computed on read (no ingest endpoint)

The weekly workflow (`.github/workflows/calibration-mine.yml`) and the
hosted app read the **same Postgres** (`secrets.DATABASE_URL` is the
app's DB), and local JSONL samples are absent in both contexts. So a GET
route that runs the same pure mining logic server-side produces the same
proposals the weekly artifact contains — with no new secrets, no
week-stale snapshots, and it works on every self-hosted instance with
zero CI setup (HUMAN-EXPERIENCE spirit: the product works by itself).

This is also the established pattern: tuning proposals are computed on
read (`GET /api/policies/proposals` → `deriveProposals`), with only the
human's decisions persisted.

Persistence of decisions works because candidate ids are content-derived
(`cv_<sha256:16>` of the shape key): the same recurring shape gets the
same id across recomputations, so a ratify/dismiss recorded this week
still binds next week.

The weekly workflow is **unchanged** except its step summary gains one
line pointing reviewers at `/policies` — it remains the artifact/history
record; the product surface is the review path.

## Components

### 1. Mining lib shared with the app

`scripts/lib/calibration-mining.mjs` is pure (no I/O). It moves to
`app/lib/calibration-mining.mjs`; `scripts/lib/calibration-mining.mjs`
becomes a re-export shim so the miner CLI, its tests, and the forge keep
their import paths. (Scripts already import from `app/lib` — the forge
imports `app/lib/guard.js` — but app code must not import from
`scripts/`, so the lib lives on the app side.) No logic changes.

### 2. Repository: `app/lib/repositories/calibration.repository.js`

Two responsibilities, no SQL in routes (`route-sql:check`):

- **Event loaders**, org-scoped ports of the miner's loaders:
  `loadDecisionEventsForOrg(orgId, { days, limit })` (guard_decisions ⋈
  action_records, includes `agent_id` + `action_id`) and
  `loadUploadedSampleEventsForOrg(orgId, { days, limit })`
  (behavior_samples). Same row caps as the script; truncation reported.
  The script stays instance-wide; the route is org-scoped — that is the
  correct multi-tenant behavior, and on the owner instance (one org) the
  outputs match.
- **Decision CRUD**: `getProposalDecisions(orgId)`,
  `recordProposalDecision(orgId, decision)` (upsert on org+proposal id),
  `deleteProposalDecision(orgId, proposalId)` (undo),
  `markProposalForged(orgId, proposalId, vectorName)`.

### 3. Schema: `calibration_proposal_decisions` (drizzle `0040`)

The human's ratification is an auditable record, not a settings blob
(acceptance: "smoke pins the ratification record"). New table:

| column | type | notes |
|---|---|---|
| id | serial PK | |
| org_id | text NOT NULL | |
| proposal_id | text NOT NULL | `cv_[a-f0-9]{16}`, unique with org_id |
| rule | text NOT NULL | over_scored_benign \| under_scored_danger \| repeated_approvals |
| decision | text NOT NULL | `ratified` \| `dismissed` |
| suggested_label | text | benign \| risky |
| suggested_name | text | kebab-case, human may have edited |
| provenance | text | the forge `--source` string |
| ratify_command | text | nullable (needs_manual_context proposals) |
| representative | jsonb | redacted snapshot (shape, risk, goal) |
| reason | text | dismissal reason, redacted |
| decided_by | text | user id |
| decided_at | timestamptz NOT NULL default now | |
| forged_at | timestamptz | stamped when the maintainer commits the vector |
| vector_name | text | final corpus name at forge time |

Unique index `(org_id, proposal_id)`. Migration is idempotent
(`IF NOT EXISTS`), numbered `drizzle/0040_calibration_proposal_decisions.sql`.

### 4. Route: `app/api/calibration/proposals/route.ts`

- **GET** (org-authed): loads events via the repository, runs the pure
  pipeline (`isSyntheticEvent` filter → `mine*` rules → `buildProposals`
  with the top-15 cap), joins decisions by proposal id, returns
  `{ window_days, inputs, proposals: [{ ...proposal, status:
  'pending'|'ratified'|'dismissed', decision? }], counts }`.
  `?days=` (default 30, clamped 1–90) and `?status=` filter (the
  maintainer session lists `?status=ratified`). Synthetic filter always
  on (no escape hatch over HTTP).
- **POST** (admin-only, mirroring `/api/policies/proposals` POST):
  `{ action: 'ratify'|'dismiss'|'undo'|'mark_forged', proposal_id,
  proposal?, reason?, vector_name? }`. `proposal_id` validated
  `^cv_[a-f0-9]{16}$`. Ratify/dismiss store the client-sent proposal
  snapshot (id-format validation only — the tuning-dismissals precedent;
  recomputing the whole mine to verify existence on every click is not
  worth the cost for an admin-only judgment ledger). `reason` and the
  `representative` snapshot pass through `redactAny`. `logActivity` on
  every action. `mark_forged` requires an existing ratified row.

### 5. UI: `app/policies/components/CalibrationProposals.tsx`

Follows `TuningProposals.tsx` structurally (SECTION_LABEL heading,
subtitle, `divide-y` row list, `BTN_NEUTRAL`/`BTN_WARNING`, armed-confirm
with a consequence line, dismissal reason input, post-action collapse
strip with Undo, no full reload). Per row (evidence card):

- Rule chip + suggested label chip (benign/risky), count, evidence tier,
  risk range (`risk_min`–`risk_max`), the representative's
  `command_shape`/`declared_goal`/`action_type`, provenance line.
- **Ratify…** (warning-tinted; consequence line: "Records your
  ratification — the maintainer forges it into the corpus and commits;
  nothing changes until then") and **Dismiss…** (neutral; reason input).
- Ratified strip: "Ratified — queued for the maintainer forge" + Undo.
  Dismissed strip: reason + Undo. Forged strip: "In corpus as
  `<vector_name>`" (no Undo — the commit exists).
- `needs_manual_context` proposals show a muted note that the forge will
  need the human-supplied command; still ratifiable (the decision is the
  judgment, the maintainer resolves context).
- Empty state: "No calibration proposals in the last N days." Client
  fetch via a small `calibrationClient.ts` next to `proposalsClient.ts`.

All colors via CSS tokens (`.impeccable.md`); no hex.

### 6. Maintainer loop closure

The maintainer session's protocol (MAINTAINER.md flywheel step) becomes:
`GET /api/calibration/proposals?status=ratified` → for each, run the
recorded `ratify_command` (or build one for `needs_manual_context`) →
commit vector (+ scorer fix if `requires_model_fix`) → POST
`mark_forged` with the final vector name. The UI then shows the closed
loop. MAINTAINER.md's calibration section is updated to this protocol in
the same ship.

## Error handling

- GET degrades honestly: loader failure → 500 with structured error (no
  empty-array masking); truncation reported in `inputs` like the script.
- POST validation errors → 400 with field detail; non-admin → 403;
  `mark_forged` on a non-ratified id → 404/409.
- UI follows the repo error pattern: load failure → error + Retry;
  mutation failure → toast; no silent catches.

## Testing

- **Unit**: repository CRUD + upsert semantics (mocked sql per
  conventions); route GET (join/status/filters, synthetic filter applied,
  org scoping) and POST (validation, admin gate, redaction, mark_forged
  transitions); component test for `CalibrationProposals` states
  (pending/armed/ratified/dismissed/forged/empty/error).
- **Existing miner tests untouched** — the lib move keeps a shim, and the
  lib itself does not change.
- **Policy smoke** (`scripts/policy-smoke.mjs`): new checks — POST ratify
  for a synthetic `cv_` id → GET `?status=ratified` includes it with the
  decision record → POST undo cleans up. Pins the ratification record
  end-to-end against a live instance.
- **frontend-verify**: /policies renders the new section; with a seeded
  decision the ratified strip renders.

## Docs / marketing (clause 4 — same ship)

- MAINTAINER.md calibration protocol updated (buttons + mark_forged).
- `docs/` page section for calibration proposals review; route count
  surfaces updated via the standard drift sweep (`check-doc-counts`,
  api-inventory, livingcode regenerate).
- Landing/marketing: one accurate line where the calibration flywheel is
  described. The full 10-capability backfill remains v2.6d.

## Out of scope

- Editing a proposal's suggested name/label in the UI (the maintainer may
  rename at forge time; add editing only if real use demands it).
- Duplicate-vs-corpus detection (unchanged from v2.6: the human is the
  dedupe step).
- Auto-running the forge from the web app (constitution §3: the corpus
  commit stays with the maintainer session).
- Multi-org rollups; the surface is per-org like every cockpit section.

## Acceptance

1. Wes can review a real weekly batch entirely on /policies — zero
   terminal, zero GitHub. Rendered proof via frontend-verify.
2. Smoke pins the ratification record (POST ratify → GET reflects it →
   undo cleans up) against a live instance.
3. `GET /api/calibration/proposals` on the owner instance returns the
   same candidate population as the weekly artifact for the same window
   (spot-checked live).
4. Unit suites green; full gates (lint, vitest, build, contract checks)
   green; docs/counts drift-swept.
