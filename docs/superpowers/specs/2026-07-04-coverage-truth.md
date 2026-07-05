# v4.2 — Coverage truth (spec)

Roadmap: `docs/plans/owner-roadmap.md` v4.2. Drafted 2026-07-04 from live
diagnosis (hook breadcrumb log, ledger queries, live session state; queries
preserved in the session scratchpad, results summarized here).

## Premise

The roadmap drafted this item on the ~96% PostToolUse miss rate: "the
ledger records a sliver and renders it as if whole." The item's core
thesis — the instrument cannot see what it misses — is confirmed. The
specific number is stale, and the way it went stale is itself the
strongest evidence for the item.

## What the live evidence actually says (2026-07-04 diagnosis)

- **The hook chain is healthy today.** PreToolUse records normally (the
  diagnosing session itself recorded 34 actions mid-diagnosis); PostToolUse
  outcomes arrive for ~97% of hook-recorded rows. Over 48h of real
  traffic: 43 rows auto-closed by the Stop hook vs ~1,400 closed with real
  outcomes. Over 7d: 130 auto-closed of 6,344 total (~2%).
- **The ~96% miss was real and recovered invisibly.** The April
  instrumentation (`506cf75d`, memory, `docs/ANALYTICS-ROLLOUT.md`) pinned
  a genuine 96% PostToolUse miss. At some point between April and July it
  recovered — upstream fix, harness update, unknown. No DashClaw surface
  registered the outage or the recovery; we know both states only from
  ad-hoc queries months apart. Silence was indistinguishable from health
  in *both directions*. That is the defect this item fixes.
- **Closure provenance is not recorded.** The only way to tell a real
  PostToolUse outcome from a Stop-hook placeholder is string-matching
  `output_summary = 'Auto-closed by Stop hook'` — brittle, and blind to
  the third path (actions created already-terminal via MCP
  `dashclaw_record` / direct POST). The server cannot compute outcome
  coverage from durable data.
- **The expected side of expected-vs-recorded never leaves the client.**
  The Stop hook already walks the turn's transcript slice and sees every
  `tool_use` block the model actually emitted
  (`dashclaw_code_session_reporter._collect_tool_use_action_map`), and
  pretool keeps a durable per-session `tool_use_id → action_id` map
  (`dashclaw_session_tool_map_<session_id>`). Nothing reports the counts;
  `_count_session_actions` feeds only a stderr recap line. A PreToolUse
  outage (the #6305 failure mode) would today produce zero server-side
  signal — the ledger would just quietly thin out.
- **`session_id` is stamped on 0 of 6,344 rows (7d).** Hook-recorded
  actions never carry a session identity, so any per-session
  expected-vs-recorded join server-side is currently impossible;
  `sessionActionMatchSql` falls back to agent+time-window overlap with a
  documented overcount.
- **Ride-along finding — the local fleet is mis-attributed.** OS-level
  `DASHCLAW_AGENT_ID=codex` (set in the user environment, presumably
  during a Codex install) makes every Claude Code session record as agent
  `codex`: 4,842 of 6,344 rows in 7d, including this session. The live
  `~/.claude/settings.json` hook wiring predated v4.29.0 and passed no
  `--agent-id`, so the ambient env won. `agent_id = claude-code` recorded
  **zero** rows in 7d despite daily use. This poisons per-harness
  coverage, posture, and the v4.3 lineage groundwork.
- **Distinct metric, do not conflate:** posture's `coveredUnits 3/81` is
  *policy* coverage (units with a firing guard policy), orthogonal to
  event coverage. This item builds event coverage; it does not touch the
  policy-coverage metric.
- **`orphan_tokens` breadcrumbs are benign** — text-only turns with no
  actions to attach spend to (default log-and-drop path,
  `DASHCLAW_TRACK_TEXT_TURNS` opt-in exists). Not a miss signal; out of
  scope.

## Verdicts

1. **BUILD — durable closure provenance (`close_source`).** New nullable
   text column on `action_records` (migration + `schema/schema.js`),
   stamped server-side only:
   - `outcome` — a normal PATCH/outcome write closed the row (PostToolUse
     or SDK);
   - `stop_autoclose` — a `close_if_running: true` PATCH won the close;
   - `direct` — the row was created already terminal (MCP
     `dashclaw_record`, POST with terminal status).
   Null means pre-v4.2; no backfill. Outcome coverage becomes computable
   from durable data instead of a magic string.
2. **BUILD — Stop-hook coverage report (the client-side sequence
   evidence).** Per turn, the Stop hook computes from data it already
   holds: `expected` = `tool_use` blocks in the turn's transcript slice
   whose tool matches the governed matcher
   (`Agent|Task|Bash|Edit|Write|MultiEdit|Skill|mcp__.*`), `recorded` =
   those with an action_id in the session tool map. It POSTs one
   fail-silent report to the new `POST /api/coverage` with
   `{agent_id, harness: 'claude-code', harness_session_id, expected,
   recorded}`. New table `coverage_reports` (org-scoped, append-only).
   One extra HTTP call per Stop, nowhere near the guard hot path.
   Transcript ground truth is independent of whether Pre/PostToolUse
   fired — a PreToolUse outage now *lowers a number the server can see*
   instead of thinning the ledger silently.
3. **BUILD — coverage computation + `/agents` render.** New
   `coverage.repository.ts`: per-agent record coverage
   (`sum(recorded)/sum(expected)` over a 24h window, from
   `coverage_reports`) and outcome coverage (share of hook-recorded rows
   with `close_source = 'outcome'` vs `stop_autoclose`, from
   `action_records`). `GET /api/agents` merges a `coverage` object per
   agent; `/agents` renders it as a Coverage badge/column with an explicit
   **"no evidence"** state when an agent has no reports — absence of
   evidence must render differently from 100%. Synthetic families
   (`isSyntheticEvent` patterns) are excluded from aggregates.
4. **BUILD — posture finding on coverage drop.** `deriveCoverageFinding`
   in `app/lib/posture/findings.ts` (shape copied from
   `deriveLiveCanaryFinding`): fires when a real agent's record coverage
   over the window drops below **90%** with a minimum sample of **20
   expected** calls, or when outcome coverage drops below the same bar.
   New `PostureFix` variant `{type: 'view_coverage', deepLink: '/agents'}`.
   Spliced into `computePosturePayload` before `applyFindingStates` so
   snooze/accept-risk work.
5. **NO UPSTREAM FILING (corrected verdict).** The roadmap said "the
   upstream bug gets filed and tracked either way." The live evidence
   shows the miss is not currently reproducible (~97% arrival), so filing
   claude-code#6305-redux now would report a ghost. The tracking mechanism
   *is* this item: a recurrence drops the coverage number and mints a
   posture finding within a session. Recorded as the explicit verdict the
   roadmap line requires.
6. **RIDE-ALONG — NO CODE CHANGE (corrected during build).** The
   installer already wires `--agent-id claude-code` on every hook command
   (shipped in v4.29.0, commit `88e23cbf`, 2026-07-02), and
   `__tests__/unit/install-hooks.test.js` already pins it; Codex likewise
   passes `--agent-id codex` explicitly. The defect was purely
   operational: this machine's `~/.claude/settings.json` was wired by a
   pre-v4.29.0 installer run, and a stray User-level
   `DASHCLAW_AGENT_ID=codex` filled the gap. Remediated 2026-07-04 during
   this ship: re-ran `install-hooks.mjs --global --governance` (commands
   now carry the flag) and removed the User env var (verified nothing
   else references it; Codex/MCP set their own identity). Historical
   mis-attribution is not rewritten.
7. **SCOPE — no action-row `session_id` stamping this ship.** Stamping
   harness session ids onto `action_records.session_id` collides with the
   `sess_` agent-session namespace and belongs to v4.3's lineage model
   (parent session → subagent → workflow). Coverage reports carry
   `harness_session_id` themselves, which is enough for per-session
   expected-vs-recorded. Explicitly deferred, not forgotten.
8. **PARITY (explicit decision).** The Stop-hook reporter is Claude
   Code-first: Codex's stop-equivalent has no transcript parser, so it has
   no independent ground truth to report (`PLUGIN_PARITY.md` already
   records this structural delta). Codex/Hermes still benefit from
   `close_source` outcome coverage (server-side, harness-agnostic). The
   coverage UI's "no evidence" state is exactly how a harness without
   reports renders. Parity gap recorded in `PLUGIN_PARITY.md` in this
   ship.

## Human surface (HUMAN-EXPERIENCE gate)

- **See it:** `/agents` (existing nav) — Coverage badge per agent plus
  the fleet stat rail; posture queue shows the coverage-drop finding with
  a one-click deep link to `/agents`.
- **Discoverable:** both surfaces are existing daily surfaces; no deep
  URLs.
- **Clicks only:** the human's role is reading the number and acting on
  the posture finding (existing snooze/accept/fix controls). Zero
  terminal steps.
- **Rendered proof:** frontend-verify drives `/agents` and the posture
  queue after build; the deliberately-dropped-stream smoke renders a
  sub-90% coverage state.

## Acceptance

- Unit: `close_source` stamping covered for all three paths (outcome
  PATCH, `close_if_running` win, terminal-at-create); coverage math
  (record + outcome) pinned including the no-evidence and
  divide-by-zero edges; posture finding threshold + min-sample pinned;
  synthetic exclusion pinned.
- Hooks pytest: Stop posts one coverage report per turn with correct
  expected/recorded counts from a fixture transcript; fail-silent on
  server-down; no report when the turn has no governed tool_use blocks.
- Smoke (`scripts/policy-smoke.mjs`, new `V` section): POST a coverage
  report with `expected > recorded` for a smoke agent → coverage math
  renders sub-threshold; positive control that a healthy report does not
  mint a finding; `?include_synthetic=1`-style diagnostic visibility
  preserved.
- Live proof after deploy: `/agents` shows real coverage numbers derived
  from evidence on the live instance; a deliberately dropped stream
  (coverage report with expected≫recorded) is detected and rendered
  within a session; the ledger's `close_source` populates on new rows.
- Gates: lint, full vitest, `npx next build` (app/** touched),
  `npm run typecheck` (ts touched), doc counts (`route` count changes:
  +1 route), `openapi:check`/`api:inventory:check` regenerated.
