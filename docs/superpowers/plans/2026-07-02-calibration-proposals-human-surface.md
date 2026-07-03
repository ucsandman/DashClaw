# Calibration Proposals Human Surface — Implementation Plan (v2.6b)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, same-session executor). Steps use checkbox (`- [ ]`) syntax. This plan is executed by its author in the same session, so it pins exact contracts, SQL, and validation rules rather than duplicating full component code.

**Goal:** Calibration-miner proposals render as evidence cards on /policies with Ratify/Dismiss buttons; the human's judgment persists as an auditable record the maintainer session consumes.

**Architecture:** Pure mining lib moves to `app/lib` (shim keeps script imports). A new org-scoped repository ports the miner's event loaders and owns a new `calibration_proposal_decisions` table (drizzle 0040). `GET /api/calibration/proposals` computes proposals on read (same pipeline as the weekly artifact) and joins decisions by the content-stable `cv_` id; `POST` records ratify/dismiss/undo/mark_forged. A third PolicyCockpit section mirrors TuningProposals.

**Tech Stack:** Next.js 16 App Router, Neon Postgres via repository pattern, vitest, policy-smoke harness.

**Spec:** `docs/superpowers/specs/2026-07-02-calibration-proposals-human-surface-design.md`

## Global Constraints

- No SQL in route files (`route-sql:check`); all DB access via `app/lib/repositories/calibration.repository.ts`.
- No hex colors; CSS tokens only (`.impeccable.md`). Reuse `BTN_NEUTRAL`/`BTN_WARNING`/`SECTION_LABEL` vocabulary from TuningProposals.
- `redactAny` on all human-authored text and the representative snapshot before persisting (approvals/tuning precedent).
- Admin-only POST; org-authed GET (mirrors `/api/policies/proposals`).
- Full gates before push: `npm run lint`, `npx vitest run`, `npx next build`, `npm run typecheck`, `scripts/check-doc-counts.mjs --strict`.
- Mining logic itself does NOT change — only its location.

---

### Task 1: Move the mining lib to app/lib (+ shared event mappers)

**Files:**
- Create: `app/lib/calibration-mining.js` (moved from `scripts/lib/calibration-mining.mjs`; only change: `import { RISK_MEDIUM_MIN } from './riskThresholds.js'`; ADD exports `decisionRowToEvent`, `sampleRowToEvent` — verbatim ports of the miner's `decisionToEvent`/`sampleToEvent`)
- Modify: `scripts/lib/calibration-mining.mjs` → shim: `export * from '../../app/lib/calibration-mining.js';`
- Modify: `scripts/mine-calibration-candidates.mjs` — delete local `decisionToEvent`/`sampleToEvent`, import the two mappers from the lib (keeping local aliases so call sites don't churn)

**Interfaces (produces):**
- `decisionRowToEvent(row) -> Event`, `sampleRowToEvent(row) -> Event` (Event = the normalized shape documented in the lib header)
- All existing exports re-exported through the shim unchanged.

- [ ] Steps: move file; add mappers; shim; update miner imports.
- [ ] Verify: `npx vitest run __tests__/unit/calibration-mining.test.js` PASS (imports via the shim); `node scripts/mine-calibration-candidates.mjs --days 7` runs against local DB and prints a summary.
- [ ] Commit: `refactor(calibration): mining lib to app/lib for route reuse (shim keeps script imports)`

### Task 2: Schema + migration 0040

**Files:**
- Modify: `schema/schema.js` — add `calibrationProposalDecisions` pgTable
- Create: `drizzle/0040_calibration_proposal_decisions.sql`

Migration SQL (idempotent, header comment ties to v2.6b):

```sql
CREATE TABLE IF NOT EXISTS "calibration_proposal_decisions" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  "rule" text NOT NULL,
  "decision" text NOT NULL,
  "suggested_label" text,
  "suggested_name" text,
  "provenance" text,
  "ratify_command" text,
  "representative" jsonb,
  "reason" text,
  "decided_by" text,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "forged_at" timestamptz,
  "vector_name" text,
  CONSTRAINT "calibration_proposal_decisions_org_proposal_unique" UNIQUE ("org_id", "proposal_id")
);
CREATE INDEX IF NOT EXISTS "idx_calibration_decisions_org_decision"
  ON "calibration_proposal_decisions" ("org_id", "decision");
```

- [ ] Add matching drizzle table to `schema/schema.js` (unique via `unique(...).on(t.orgId, t.proposalId)` — column-list form so upserts can use `ON CONFLICT (org_id, proposal_id)`; memory gotcha: ON CONFLICT ON CONSTRAINT can't target a bare unique index).
- [ ] Run `npm run db:migrate`; verify table exists.
- [ ] Commit: `feat(calibration): calibration_proposal_decisions table (drizzle 0040)`

### Task 3: Repository

**Files:**
- Create: `app/lib/repositories/calibration.repository.ts`
- Test: `__tests__/unit/calibration-repository.test.js` (mocked sql per repo conventions; note the sql-fragment gotcha — main query = last vi.fn() call)

**Interfaces (produces):**
- `loadDecisionEventsForOrg(sql, orgId, days, limit=20000) -> Promise<{events: Event[], truncated: boolean}>` — the miner's decision SELECT + `AND gd.org_id = $org`, mapped via `decisionRowToEvent`.
- `loadUploadedSampleEventsForOrg(sql, orgId, days, limit=20000) -> Promise<Event[]>` — behavior_samples SELECT + org filter + LIMIT, mapped via `sampleRowToEvent`.
- `getProposalDecisions(sql, orgId) -> Promise<CalibrationDecisionRow[]>` (all rows for org, newest first).
- `upsertProposalDecision(sql, orgId, input) -> Promise<CalibrationDecisionRow>` — INSERT ... ON CONFLICT (org_id, proposal_id) DO UPDATE SET decision/reason/snapshot fields/decided_by/decided_at=now(), forged_at=NULL, vector_name=NULL (re-deciding clears forge state).
- `deleteProposalDecision(sql, orgId, proposalId) -> Promise<boolean>`.
- `markProposalForged(sql, orgId, proposalId, vectorName) -> Promise<'ok'|'not_found'|'not_ratified'>` — UPDATE ... WHERE decision='ratified'; distinguish miss reasons.

- [ ] Tests first (upsert clears forge state; markProposalForged state machine; org scoping present in SQL strings).
- [ ] Implement; `npx vitest run __tests__/unit/calibration-repository.test.js` PASS.
- [ ] Commit: `feat(calibration): org-scoped event loaders + decision CRUD repository`

### Task 4: Route `app/api/calibration/proposals/route.ts`

**Files:**
- Create: `app/api/calibration/proposals/route.ts`
- Test: `__tests__/unit/calibration-proposals-route.test.js`

**GET (org-authed):** `?days=` clamped 7–90 default 30 (reuse `clampInt` from `app/lib/policy-tuning/engine`), `?status=` optional ∈ {pending, ratified, dismissed, forged}.
Pipeline: load events (both loaders) → filter `isSyntheticEvent` (always on) → `mineOverScoredBenign`/`mineUnderScoredDanger`/`mineRepeatedApprovals` → `buildProposals({windowDays, generatedAt: new Date().toISOString(), topPerRule: 15})` → join `getProposalDecisions` by `candidate_id`:
- status: no row → `pending`; row dismissed → `dismissed`; ratified + `forged_at` → `forged`; else `ratified`.
- Orphan merge: ratified-not-forged decision rows whose id is NOT among computed proposals are synthesized into proposal objects from their snapshot columns with `from_snapshot: true` (the maintainer's queue must survive shapes aging out of the window). Dismissed/forged orphans are not surfaced.
- Response: `{ window_days, inputs: {decisions, decisions_truncated_at_limit, uploaded_samples, synthetic_excluded}, proposals: [...{...proposal, status, from_snapshot?, decision: {decision, reason, decided_by, decided_at, forged_at, vector_name} | null}], counts: {pending, ratified, dismissed, forged} }` (counts computed before the status filter).

**POST (admin-only, 403 otherwise):** body `{ action, proposal_id, proposal?, reason?, vector_name? }`; `proposal_id` must match `^cv_[a-f0-9]{16}$` (400).
- `ratify`: requires `proposal` snapshot: `rule` ∈ 3 rules, `suggested_label` ∈ benign|risky, `suggested_name` kebab ≤64, `provenance` string 1–500, `ratify_command` string ≤1000 | null, `representative` object (redactAny'd), numeric `count`/`risk_min`/`risk_max` passed into snapshot jsonb. Upsert with decision='ratified'.
- `dismiss`: `reason` required 1–500 (redactAny'd); `proposal` snapshot optional (same validation when present). Upsert decision='dismissed'.
- `undo`: delete row (any state — forged undo is admin-only and audit-logged; UI doesn't offer it, smoke needs cleanup). 404 if absent.
- `mark_forged`: `vector_name` kebab required; `markProposalForged` → 404 not_found / 409 not_ratified.
- Every action: `logActivity` with `action: 'calibration_proposal.<verb>'`, `resourceType: 'calibration_proposal'`.

- [ ] Tests first: GET status derivation + orphan merge + synthetic filter applied + org scoping; POST validation matrix, admin gate, redaction called, mark_forged 409, undo 404.
- [ ] Implement; targeted vitest PASS.
- [ ] Commit: `feat(calibration): /api/calibration/proposals — computed-on-read GET + decision POST`

### Task 5: UI — client, section component, cockpit wiring

**Files:**
- Create: `app/policies/lib/calibrationClient.ts` (fetch/ratify/dismiss/undo, typed payloads mirroring the GET response; errorFrom pattern copied from proposalsClient.ts)
- Create: `app/policies/components/CalibrationProposals.tsx`
- Modify: `app/policies/components/PolicyCockpit.tsx:101` — add `<CalibrationProposals />` after `<TuningProposals ... />` (no onPolicyChange — ratification doesn't alter policies)
- Test: `__tests__/unit/calibration-proposals-component.test.jsx`

Component structure mirrors TuningProposals exactly (SECTION_LABEL "Calibration proposals", subtitle, skeleton/error+Retry/empty states, `divide-y` rows, rowState map, no full reload). Per-row card content per spec §5: rule chip + label chip, `count`, `evidence_tier`, risk range, representative shape line (command_shape || declared_goal || action_type), provenance in text-tertiary. Buttons: **Ratify…** (BTN_WARNING; armed consequence line: "Records your ratification — the maintainer forges it into the corpus and commits; nothing changes until then.") / **Dismiss…** (BTN_NEUTRAL; reason input flow). Strips: ratified ("Ratified — queued for the maintainer forge." + Undo), dismissed (Undo), forged ("In corpus as `<vector_name>`.", no Undo). `needs_manual_context` note; `from_snapshot` rows render directly in their decided strip. Section returns `null` only while proposals AND decisions are both empty? No — render the empty state text ("No calibration proposals in the last N days.") so the surface is discoverable.

- [ ] Component tests: renders rows from mocked fetch; ratify arms then posts; dismiss requires reason; error state Retry; forged strip no Undo (vitest conventions: `__tests__/`, no jest-dom, mock fetch).
- [ ] Implement; targeted vitest PASS.
- [ ] Commit: `feat(policies): calibration proposals section — ratify/dismiss are buttons (v2.6b)`

### Task 6: Policy smoke — pin the ratification record

**Files:**
- Modify: `scripts/policy-smoke.mjs` (follow its existing check patterns/counting)

- [ ] Checks: (1) POST ratify synthetic `cv_` id + minimal snapshot → ok; (2) GET `?status=ratified` includes it with decision.decided_by; (3) POST mark_forged → ok, GET shows `forged` + vector_name; (4) POST undo → ok (cleanup); (5) GET no longer lists it. Update the smoke count everywhere it's cited (memory: 2 test files pin MCP count — analogous smoke-count cites: README/docs grep for "smoke = 76").
- [ ] Run `node scripts/policy-smoke.mjs` against local dev → all green.
- [ ] Commit: `test(smoke): calibration ratification record end-to-end`

### Task 7: Docs, workflow pointer, maintainer protocol, marketing line

**Files:**
- Modify: `.github/workflows/calibration-mine.yml` — one summary line pointing reviewers at `/policies` ("Review these in the product: <instance>/policies → Calibration proposals").
- Modify: `MAINTAINER.md` — calibration protocol: review/ratify via /policies buttons; maintainer session consumes `GET /api/calibration/proposals?status=ratified`, forges, commits, `POST mark_forged`.
- Modify: `app/docs/page.tsx` — calibration proposals review entry in the relevant section.
- Modify: landing (`app/page.tsx`/`landingData.js`) — one accurate line where the calibration flywheel/policy tuning is described (full backfill remains v2.6d).
- Modify: spec/roadmap ledger + any cited route counts flagged by `scripts/check-doc-counts.mjs --strict` (api-inventory regenerates via pre-commit).

- [ ] Apply, run `node scripts/check-doc-counts.mjs --strict`, fix flags.
- [ ] Commit: `docs(v2.6b): maintainer protocol + docs/marketing for calibration proposals surface`

### Task 8: Gates + rendered verification + live spot-check

- [ ] `npm run lint` && `npm run typecheck` && `npx vitest run` (FULL suite) && `npx next build` — read output.
- [ ] frontend-verify: /policies renders the new section; seed one ratified decision via POST, confirm ratified strip renders; screenshot proof.
- [ ] Live spot-check (acceptance §3): GET /api/calibration/proposals on the local instance vs `node scripts/mine-calibration-candidates.mjs --propose` — same candidate ids for the same window.
- [ ] Fix anything red; commit fixes.

### Task 9: Ship

- [ ] Invoke `dashclaw-ship`: version bump (platform+SDKs stay in sync), CHANGELOG + maintainer-log append, roadmap ledger v2.6b → DONE with ship summary, drift sweep, push to main (no PR — repo rule), assume deploy green.

## Self-Review

- Spec coverage: Decision 1/2 (Tasks 5/4), schema (2), repository (3), route contract incl. orphan merge + forged state (4), UI states incl. needs_manual_context + empty (5), smoke acceptance (6), maintainer loop + workflow line + clause-4 marketing (7), rendered proof + live parity (8). Out-of-scope items absent. ✔
- Placeholders: none — every validation bound, SQL statement, and response field is pinned. ✔
- Type consistency: `candidate_id` (proposal payload) vs `proposal_id` (decision row/POST body) is deliberate and used consistently; Event mappers named `decisionRowToEvent`/`sampleRowToEvent` in Tasks 1/3. ✔
- One deviation from spec §4: undo on forged rows is ALLOWED at the API (admin-only, audit-logged) for smoke cleanup; the UI still hides Undo on forged. Spec updated? — noted here; ship summary will state it.
