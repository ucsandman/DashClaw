# v4.4 — One judgment spine: unify the proposal queues (spec)

Roadmap: `docs/plans/owner-roadmap.md` v4.4. Drafted 2026-07-04 from code
recon of all four proposal-queue implementations + the guard evaluator
inventory. Constitution §3 (propose → human ratifies → undo) is the
invariant this item strengthens, never touches.

## What the evidence says

- **The roadmap counted three queues; the code has four.** `/policies`
  (`PolicyCockpit.tsx:98-108`) already stacks `ReviewFeed`,
  `TuningProposals` (v1 item 1, `/api/policies/proposals`),
  `TighteningProposals` (v3.2, `/api/policies/tightening`), and
  `CalibrationProposals` (v2.6b, `/api/calibration/proposals`) as four
  independently-fetched sibling sections; behavior-learning suggestions
  render on a fifth surface, `/policy-coach`. Tuning is structurally
  identical to the named three (evidence-carrying proposals, human
  accept/dismiss with reason, admin-gated POST) — a spine that excluded
  it would recreate the exact problem this item exists to fix, and v4.5's
  loosening proposals are mandated to ship *into* this spine. Tuning is
  in scope; `ReviewFeed` is not (it is the live interruption/approval
  flow, operational not judgmental — an approve there resolves a blocked
  action, it does not change policy or corpus).
- **Three of the four queues already share one decision grammar.**
  Calibration and tightening are twins: content-stable proposal ids
  (`cv_`/`tp_` = sha256 of content), decisions-only persistence
  (`calibration_proposal_decisions` / `tightening_proposal_decisions`,
  pending = no row), admin-only POST `ratify | dismiss(reason required) |
  undo(delete row)`, proposals recomputed live on GET. Tuning follows the
  same shape (accept = PATCH through the existing policies route, dismiss
  recorded with reason). The spine is therefore a **presentation and
  UX-grammar unification** — the engines and their persistence are
  correct and stay exactly where they live (roadmap constraint,
  honored literally: no decision row moves, no table merges).
- **Behavior learning is the outlier on three axes.** (1) It renders on
  `/policy-coach`, not the cockpit. (2) Its decision model has **no
  undo**: dismiss/accept-advisory write a `behavior_dismissals` row
  (delete-able, but no route action exposes it); adopt-enforceable
  writes an inactive `guard_policies` draft and **no suppression record
  at all** — `isSuppressed` (`app/lib/behavior/analyzer.ts:393-397`)
  checks only dismissal signatures, so an adopted suggestion re-surfaces
  as pending on the next GET (latent defect; verify in build, fix here).
  (3) `behavior_dismissals` has no `policy_id` column, so an adoption
  cannot point at the draft it created.
- **The 2/6 enforceable split is mechanical, and exactly one of the four
  advisory types has an honest enforcement path today.**
  `ENFORCEABLE_KINDS` (`app/lib/behavior/policy-model.ts:29-32`) holds
  the two kinds decidable from a single action at PreToolUse
  (`destructive_command_approval` → `risk_threshold`,
  `protected_path_approval` → `protected_path` — an evaluator v1 itself
  added to the guard for this purpose; the precedent for lifting is
  in-repo). Of the rest:
  - **`agent_allowlist` — liftable.** "Warn when this agent uses an
    action type outside its observed envelope" is single-action
    decidable, deterministic, and keyless. The guard has list-matchers
    (`warn_action_type`) but no inverse matcher; a small new
    `agent_allowlist` evaluator (same complexity class as
    `protected_path`, `guard.ts:1819-1828`) closes it.
  - **`repeated_reload_warn`, `failed_loop_warn` — no path yet.** Both
    key on a *command/target shape* repeating across an ordered window.
    `guard_decisions` persists only `action_type` + free-text `context`
    (`schema/schema.js:630-638`); the only windowed primitive is
    `rate_limit`'s per-agent count of *all* evaluations
    (`guard.ts:1829-1854`). Compiling the loop rules to that would
    enforce a coarser rule than the one simulated — violating the
    feature's core invariant (simulation and enforcement share
    `decideSample`; what you simulate is what fires). A truthful path
    needs a persisted shape key on decisions (schema + hook change) —
    the "sequence-aware guard context (v2)" the v1 doc named
    (`docs/behavior-learning.md:183`). Deferred with that as the named
    revival trigger, not lifted wrong.
  - **`model_task_mismatch_warn` — no path.** PreToolUse hook stdin
    carries no model identity; the guard context cannot see what model
    is acting. Upstream/context gap, recorded.
  - `behavioral_anomaly` / `semantic_check` are not alternative paths:
    both are key-gated (OpenAI/LLM), and DashClaw setup never requires
    an LLM key (standing rule) — enforceable defaults cannot depend on
    one.

## Verdicts

1. **BUILD — `JudgmentSpine`, one section on `/policies`, replacing the
   three proposal sections and hosting behavior suggestions.** A single
   client component with per-queue **adapters** (tuning, tightening,
   calibration, behavior) that fetch the four existing GETs in parallel
   (exactly what the four components do today) and normalize to one row
   contract: queue badge, title, evidence line(s), status, and a
   capability set (`primary` = ratify/accept/adopt, `dismiss` with
   required-reason where the engine requires it, `undo` where the engine
   supports it, `simulate` for behavior). Decisions dispatch through the
   **existing client libs to the existing per-engine POST routes** — no
   new aggregate API route, no new decision persistence, engines
   untouched. `TuningProposals.tsx`, `TighteningProposals.tsx`,
   `CalibrationProposals.tsx` are retired from the cockpit (the spine
   subsumes them); `ReviewFeed` and `ContractPanel` stay. The spine
   preserves the `#tightening` anchor (posture deep-links to
   `/policies#tightening`) and adds per-queue anchors.
2. **BUILD — behavior decisions join the grammar: undo + persisted
   adoption.** (a) `POST /api/behavior/suggestions` gains
   `action:'undo'` — deletes the `behavior_dismissals` row by signature
   (DB mode) / removes the entry from `.dismissals.json` (local mode);
   404 when nothing is recorded. (b) Adopt-enforceable additionally
   writes a suppression row `status:'adopted'` with the new nullable
   `behavior_dismissals.policy_id` column (drizzle/0050) pointing at the
   created draft — fixing the re-surface defect and making the adoption
   undoable. (c) Undo of an adoption deletes the judgment row and
   **keeps the draft policy** (tightening's `policy_kept` precedent —
   the policy is a first-class row managed at `/policies`); the response
   echoes `policy_kept`. Simulate-before-adopt is untouched (both the
   server 400-gate and the client disabled-until-simulated gate stay).
3. **BUILD — lift `agent_allowlist` to enforceable (2/6 → 3/6).** New
   guard evaluator `agent_allowlist`: rules
   `{ allowed_action_types: string[], action: 'warn' (default) }`,
   fires when `context.action_type` is not in the list; scoped per-agent
   via the existing `agent_ids` seam (family fallback included). Compile
   path in `behaviorRuleToGuardPolicy` (kind moves into
   `ENFORCEABLE_KINDS`); `decideSample` updated in the same commit so
   simulation and enforcement stay one function. Adoption still creates
   an **inactive draft** a human activates at `/policies`. Volume
   safety: the policy fires only on *novel* action types by
   construction — precision-at-volume (v4.1 lesson) is structural.
   Policy-type doc counts update in the same ship.
4. **NO LIFT — `repeated_reload_warn`, `failed_loop_warn`,
   `model_task_mismatch_warn` (recorded).** Reasons above; each keeps
   its advisory route through the spine (adopt = accepted observation).
   Revival triggers recorded in `docs/behavior-learning.md`: a persisted
   command-shape key on `guard_decisions` (the sequence pair) or model
   identity on hook stdin (the mismatch rule).
5. **SCOPE — engines, schedulers, and the forge stay put.** Calibration
   mining (on-read + weekly CI), tightening derivation (on-read), tuning
   stats, the behavior analyzer, `mark_forged`, and the maintainer-only
   `calibration:add` CLI are all untouched. `/policy-coach` remains the
   behavior *workbench* (recorder, samples, insights, edit-rule modal,
   per-agent filtering); the spine is the *review* surface. The spine's
   behavior rows link "Refine in Policy Coach" for the edit flow rather
   than duplicating the modal.
6. **SCOPE — tuning joins for presentation with its existing actions.**
   Accept keeps PATCHing the policy through the existing route; if the
   tuning route lacks undo, its rows simply don't offer one (capability
   sets are per-queue; the grammar is uniform, the verbs available are
   the engine's own). No retroactive undo-of-a-PATCH is invented.

## Human surface (HUMAN-EXPERIENCE gate)

- **See it:** `/policies` — one "Judgment queue" section where every
  pending judgment across the four queues appears with a queue badge,
  its evidence, and its decision buttons. Pending count per queue in the
  section header.
- **Discoverable:** `/policies` is already in the sidebar nav; posture
  findings already deep-link here; `/policy-coach` keeps its suggestion
  workbench and the spine is one nav click away.
- **Clicks only:** ratify/adopt, dismiss-with-reason, undo, and simulate
  are all buttons in the spine. Zero terminal steps in the human role
  (the maintainer-only corpus forge stays a maintainer CLI by design —
  recorded decision, unchanged from v2.6b).
- **Verified rendered:** rendered proof drives `/policies`, confirms the
  spine renders rows from every queue with working decision controls
  (headless browser against `next start`, per the standing dev-server
  workaround).

## Acceptance (from the roadmap, made concrete)

- One surface on `/policies` where pending tuning + tightening +
  calibration + behavior judgments all appear with one decision grammar;
  the three old sections are gone; `#tightening` anchor still lands.
- Every decision writes through the engine's existing route/persistence
  (verified by the existing route tests staying green + smoke).
- Behavior: undo round-trips (dismiss → undo → re-surfaces; adopt →
  undo → judgment gone, `policy_kept` echoed); adopted suggestions no
  longer re-surface as pending.
- `agent_allowlist`: adopt through the spine creates an inactive
  `agent_allowlist` draft; activating it makes a guard call with an
  unlisted action type return `warn` (smoke-pinned); simulation counts
  match the evaluator's decisions on the same samples.
- Smoke per queue: existing calibration P1–P5 and tightening S1–S5 stay
  green; new smoke covers the allowlist enforcement path (X1–X3) and the
  behavior undo contract (Y1). (Corrected during build: the behavior
  dismiss/adopt round-trip cannot be live-smoked — dismiss re-derives the
  suggestion from live analysis with no client-trusted-snapshot path, and
  minting samples requires flipping the org's default-OFF
  `BEHAVIOR_UPLOAD_ENABLED` privacy gate, which a smoke script must not
  do. The round-trip is pinned by
  `__tests__/unit/behavior-suggestions.route.test.js` instead.)
- Gates: lint, full vitest, `next build`, typecheck; doc counts
  (`check-doc-counts --strict`) updated for the new policy type and
  enforceable count (2/6 → 3/6 wherever cited).
