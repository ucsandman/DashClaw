# Owner roadmap — build order under MAINTAINER.md

Living document: the maintainer updates status lines as items ship; order
changes only with a written reason in the commit. Each item ships the full
protocol: spec → build → gates → live proof → main.

**Previous eras are archived, not appended.** Roadmaps v1–v3 (items 0–6,
v2.1–v2.7, v3.1–v3.7 — all DONE, shipped v4.22.0 through v4.49.0) live at
[`docs/plans/archive/owner-roadmap-v1-v3.md`](archive/owner-roadmap-v1-v3.md)
with their full status ledgers and rationale.

## Roadmap v4 — no ungoverned lane (drafted 2026-07-04)

v2 made each interruption earn its cost. v3 made the product's testimony
true. v4 makes the **record complete and the noise obey the same bar**:
every action an agent takes is either governed or *visibly* ungoverned,
the fleet's real structure (parent sessions, subagents, workflow fan-outs)
is attributed truthfully, and every judgment queue a human faces is one
spine — including the direction that relaxes.

Drafting evidence (2026-07-04 sweep: live posture query, session-digest
flood signal, memory-index open threads; v3.7 drained the parked queue, so
v4 items come from strategic gaps, not debt):

- Live posture reads **34/100 `at_risk`** with the **approval dimension at
  0** and an approval-flood banner active right now: ~1,800 interrupts in
  the window, all minted by the org's own "[Claude Code Mode] Pause on
  runaway loop / Warn on action bursts" policies (`rate_limit` counts ALL
  actions with no risk filter, 650/60, re-enabled 2026-07-01). The v3.5
  flood guard is working as designed — the *policies feeding it* are wrong
  at volume. Precision failing at volume against our own fleet is the
  June disable-pattern's precondition.
- The governed record is a sliver of reality: the Claude Code PostToolUse
  reporting hook misses **~96% of events** (suspected upstream
  claude-code#6305; breadcrumbs via `DASHCLAW_HOOK_DEBUG=1`). Posture,
  mining, learning, and the ledger all consume this stream; none of them
  can see that it is incomplete. Live `coveredUnits` is 3/81.
- Harness traffic still leaks into testimony: `loadtest.read` (318
  observations) and `liveproof.*` mint not-fully-governed posture
  findings — the v3.1 synthetic exclusion covers the miner's families
  but not these.
- Multi-agent work is attributed flat: leaf calls are governed but the
  parent-session → subagent → workflow lineage is not recorded (the named
  multi-agent governance gap; v2.2's per-harness identity +
  `DASHCLAW_SUBAGENT_IDENTITY=distinct` is the groundwork). A 110-agent
  workflow fan-out reads as 110 unrelated agents.
- Human judgment is three parallel queues: calibration proposals (v2.6b),
  tightening proposals (v3.2), and behavior-learning suggestions
  (Behavior Learning v1 — only 2 of 6 suggestion types enforceable).
  Three surfaces, three decision models, one human.
- The hosted trial has run since June with the funnel unread. v3 declined
  reach-first "until the trial funnel produces evidence"; nothing
  currently renders whether it has.

Alternatives weighed and declined this round (same bar as v3):
**reach-first** (outward acts are Wes's per constitution §4; funnel
evidence first — that is v4.6), **team/RBAC** (still zero external orgs),
and the **repo-wide TypeScript migration** (XL, mechanical, blocks
nothing on this list).

**Status ledger v4** (update in place):

| # | Item | Status |
|---|------|--------|
| v4.1 | Own-fleet interruption noise: calibrate the Claude Code Mode policies | DONE 2026-07-04 (v4.49.1; spec docs/superpowers/specs/2026-07-04-own-fleet-interruption-noise.md — **the item's premise was half-wrong and the diagnosis says so**: the ~1,802-interrupt flood was the guard-load harness (`loadtest-mr6y5eev`, 2,502 evals/hour from the v3.7 SLO calibration run), correctly paused by the runaway valve but not classified synthetic. Fix = widen the shared predicate (`loadtest-%` agents + `loadtest.%`/`liveproof.%` action types, single-pattern → pattern-list across flood counting/posture/tightening/mining); rate_limit evaluator + both policy configs deliberately unchanged (valve worked; per-agent scoping isolates harness ids). Live-ledger proof: leak bucket 2,749→0, flood counts drop to the real 41 protected-path interrupts (no budget trip). Recorded verdicts: 100%-approved protected-path `apply` interrupts = v4.5 loosening evidence (§2 — not self-tuned); approval dimension 0 = stale `ps-qa:review_artifact` capability, operator-remediable, not flood fallout; no scorer vectors owed (neither class is a scoring error). Smoke/tests: agreement suite pins new families both forms) |
| v4.2 | Coverage truth: the record knows what it missed | DONE 2026-07-04 (spec docs/superpowers/specs/2026-07-04-coverage-truth.md — **premise corrected during diagnosis**: the ~96% PostToolUse miss recovered invisibly at some point since April (live 48h: ~3% auto-close) and no surface registered outage or recovery, which is the defect itself. Ship = durable closure provenance (`action_records.close_source`: outcome/stop_autoclose/direct, drizzle/0048), Stop-hook per-turn expected-vs-recorded reports from transcript ground truth → `POST /api/coverage` (`coverage_reports` table), per-agent Coverage on `/agents` with an explicit "no evidence" state, posture finding at <90% with min-sample 20 (`view_coverage` fix → /agents), `?include_synthetic=1` diagnostic view. No upstream filing (corrected verdict — recurrence now drops a number a human sees). Ride-along remediated live: stale pre-v4.29 global hook wiring + stray OS-level `DASHCLAW_AGENT_ID=codex` had ALL Claude Code sessions recording as `codex` (claude-code = 0 rows/7d); rewired with explicit `--agent-id claude-code`, env var removed. session_id stamping explicitly deferred to v4.3; Codex transcript gap recorded in PLUGIN_PARITY.md. Smoke: V1–V4 pin drop-detection math + synthetic exclusion end-to-end) |
| v4.3 | Fleet attribution: parent → subagent → workflow lineage | DONE 2026-07-04 (v4.51.0; spec docs/superpowers/specs/2026-07-04-fleet-attribution.md — family-scoped policies/budgets were ALREADY done (v2.2 seam + x402 family budget, smoke L1–L3; no new mechanism). Ship = lineage as persisted evidence, never client guesses: `harness_session_id` stamped on every record + `subagent_uuid` on subagent leaves (drizzle/0049), spawn rows carry `spawned_agent_uuid` (posttool extracts from tool_response; server selectively persists that ONE outcome_metadata key into outcome_progress — the whitelist had silently dropped ALL outcome_metadata forever), read-time EXISTS join renders a fan-out as one unit with per-leaf lineage. `Workflow` added to hook matchers (fan-outs now guard-evaluated at spawn; per-run leaf ids = recorded upstream gap, no run id on hook stdin). Fan-outs panel on /agents deep-links to /swarm?swarm_id= — and the scoped graph branch actually scopes now (pre-existing bug: it merged the whole org roster back in). session_id (`sess_*`) untouched (documented collision); JWKS stays exact-match (deliberate — keys never inherit). Owner-directed same-day: historical `codex` identity renamed to `claude-code` (~100k rows, 12 tables, collisions merged). Smoke W1–W4 pin the lineage contract) |
| v4.4 | One judgment spine: unify the three proposal queues | DONE 2026-07-04 (spec docs/superpowers/specs/2026-07-04-one-judgment-spine.md — **the roadmap counted three queues; the code had four**: TuningProposals (v1 item 1) is structurally identical and joined the spine, since v4.5's loosening proposals ship into it. Ship = `JudgmentSpine` on /policies replacing the three sibling proposal sections + hosting behavior suggestions (one row grammar, per-queue adapters, decisions dispatch through each engine's EXISTING routes/persistence — no new aggregate route; #tightening anchor kept, /policy-coach stays the workbench). Behavior joins the decision grammar: `action:'undo'` + persisted `status='adopted'` row w/ new `behavior_dismissals.policy_id` (drizzle/0050) — build finding: adopt-enforceable had NEVER written a suppression row, so adopted suggestions re-surfaced as pending forever; undo keeps the draft (`policy_kept`, tightening precedent). Enforceable lift 2/6 → 3/6: `agent_allowlist` evaluator (single-action, keyless, precision-safe — fires only on novel action types) + sim==enforcement parity in decideSample; NO LIFT recorded for the sequence pair (needs a persisted shape key on guard_decisions) and model_task_mismatch (no model on hook stdin) with revival triggers in docs/behavior-learning.md. Corrected during build: behavior dismiss/adopt round-trip is NOT live-smokeable (dismiss re-derives from live analysis; minting samples means flipping the default-OFF upload privacy gate) — pinned by unit tests instead. Smoke X1–X3+Y1; 107/107 live; rendered proof /policies + /policy-coach clean) |
| v4.5 | Loosening direction: proposals that relax | DONE 2026-07-05 (spec docs/superpowers/specs/2026-07-05-loosening-direction.md — sibling engine mirroring tightening, NOT new tuning rules (tuning's accept is a client PATCH with dismiss-only persistence; the mandate needs the ratify/undo grammar). Two rules, two grains: `relax_policy_scope` carves an always-approved action type out of a policy's envelope (exact-match splice, keeps other rule keys), `deactivate_policy` for policies with no surgical fix (protected_path, rate_limit, envelope-emptying) — one direction per policy, carve-outs win the slot. risk_threshold excluded (tuning owns it; double-queueing contradicts v4.4). Ratify rebuilds server-side from the validated lp_ snapshot against CURRENT rules (404/409 on drift), applies via repository with cache invalidation, self-suppresses through the updated_at evidence-window reset; undo keeps the change (`change_kept`, the policy_kept precedent). Fifth spine queue on /policies. **Ride-along fix: the tuning repository had NO synthetic exclusion** — harness traffic counted as tuning evidence since v1 (v4.1's failure pointed at the proposal engine); both evidence queries now exclude in SQL, smoke-only ?include_synthetic=1 added; getDegradationStats deliberately unfiltered (latency health, not policy evidence). Smoke Z1–Z5 pin mine/synthetic-bar/surgical-ratify/self-retire+change_kept/integrity; 113/113 live; rendered proof /policies shows the five-queue spine) |
| v4.6 | Funnel truth: read the trial evidence | DONE 2026-07-05 (v4.54.0; spec docs/superpowers/specs/2026-07-05-funnel-truth-design.md — **the record was being destroyed on schedule**: cleanup hard-deletes expired 30-day trials + every FK child row, so a funnel computed from live tables undercounts mints as history purges (survivorship bias, the exact lie the item exists to prevent; June-era trials already unrecoverable, `truthfulSince` marks the honest window). Ship = `hosted_trial_snapshots` (drizzle/0052, deliberately NO FK so the catalog-driven sweep can't destroy it) frozen FAIL-CLOSED inside deleteHostedWorkspace before the child sweep — a failed snapshot aborts the delete; GET /api/hosted/funnel (route 332, aggregate-only, hosted-gated, 60s memo) + /setup card in hosted mode: mint → first key USED (mint creates the key atomically, so creation is not a step; `api_keys.last_used_at` is) → first governed action (guard_decisions ∪ action_records, shared synthetic exclusion) → retained week 1 with an eligibility denominator (younger than 7d = week1Pending, never churned). A mint = cap>0; markTrialFull capacity placeholders never count. Security review SHIP (0 crit/high/med): public conversion-analytics disclosure is an explicit recorded decision (gating the route alone would be theater while public /setup renders the same aggregates; overturn path = operator-only card when a hosted owner-session exists). Live round-trip proof: deleted trial still counts, frozen retention kept, synthetic excluded. Smoke AA1 (114 checks); rendered proof both modes. Roadmap v4 COMPLETE) |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) |

## v4.1 Own-fleet interruption noise

The live flood: ~1,800 interrupts in the window from Pause-on-runaway-loop
+ Warn-on-action-bursts. `rate_limit` counts every action (including the
hook's own record traffic) with no risk filter, so heavy maintainer
sessions trip it constantly, the flood guard fires on our own noise, and
the approval dimension is pinned at 0.

- Diagnose from the ledger: which action families drive the count, and
  what approve-rate the resulting interrupts carry — an interrupt approved
  ~100% of the time is a wrong interrupt (MAINTAINER thesis).
- Fix at the model/policy layer, never by weakening the flood guard.
  Scorer/model fixes are code and ship directly; policy changes ship as
  proposals Wes ratifies (constitution §3). Every wrong-interruption
  class found becomes a calibration vector per the standing protocol.
- Ride-along: extend the synthetic-exclusion families to `loadtest.*` /
  `liveproof.*` so harness traffic stops minting posture findings (three
  open findings today).
- Acceptance: a normal heavy maintainer session completes without
  tripping the fleet budget; the flood banner clears live and returns
  only on genuine anomaly (the smoke positive control stays); vectors —
  or a written no-vector verdict — for each wrong-interruption class.
  (Corrected during diagnosis: the approval dimension's 0 is a stale
  ungoverned capability, `ps-qa:review_artifact`, not flood fallout —
  operator-remediable via the posture queue, out of this item's code
  scope. See the spec's diagnosis section.)

## v4.2 Coverage truth

The instrument now tells the truth about what it sees (v3); it cannot yet
see what it misses. A ~96% event miss means the ledger records a sliver
and renders it as if whole — v3.3's silent-death lesson, client-side.

- Spec first: client-side sequence evidence (per-session action counters
  or heartbeat deltas from the hook chain / session lifecycle) so the
  server can compute expected-vs-recorded per session.
- Fix or route around the upstream hook loss (e.g. Stop-hook batch
  reconciliation) — the spec decides; the upstream bug gets filed and
  tracked either way.
- Render: per-agent / per-harness coverage on `/agents`, plus a posture
  finding when coverage drops below threshold — silence must be
  distinguishable from health.
- Acceptance: the live instance shows a coverage number derived from
  evidence, not assumption; a deliberately dropped event stream is
  detected and rendered within a session; smoke pins the contract.

## v4.3 Fleet attribution

- Spec first (the named multi-agent governance gap). Record lineage —
  parent session → subagent → workflow run — on record and guard calls,
  extending v2.2's identity model.
- Policies and budgets can target a family (the agent-scoped x402 budget
  already binds an identity family — same seam).
- `/agents` renders the tree; a workflow fan-out reads as one governed
  unit with per-leaf attribution.
- Acceptance: live proof with a real multi-agent session — the tree
  renders, a family-scoped policy fires on a leaf, the ledger shows
  lineage; smoke pins the lineage contract.

## v4.4 One judgment spine

Three human queues become one review surface with one decision model
(propose → ratify/dismiss/undo; constitution §3 intact): calibration
proposals, tightening proposals, behavior-learning suggestions.

- Unify presentation and decision recording; the underlying engines stay
  separate (proposals keep being computed where they live).
- Lift Behavior Learning's enforceable suggestion types beyond 2/6 where
  an enforcement path exists — each newly enforceable type routes through
  the spine, simulate-before-adopt kept.
- Acceptance: one surface, reached by a click path from existing nav,
  where all pending judgments appear with a consistent decision UX; every
  decision lands in its engine's existing persistence; rendered proof +
  smoke per queue.

## v4.5 Loosening direction

v3.2 built tightening; precision requires the mirror or the June
disable-pattern returns — v4.1 is the live proof that over-interrupting
policies get bulk-disabled or bulk-accepted, not tuned.

- Engine proposes relaxations from ledger evidence: patterns with
  sustained ~100% approve rate, policies whose interrupts are always
  overridden.
- Same proposal shape and surface as tightening, through v4.4's spine;
  human-ratified only, same undo.
- Acceptance: live round-trip — an over-interrupting pattern renders as a
  loosening proposal, ratify relaxes the policy, the interrupt-volume
  drop is visible; smoke pins it.

## v4.6 Funnel truth

- Owner-facing activation funnel for the hosted trial — mint → first key
  → first governed action → retained week 1 — rendered on an owner
  surface (mission-control or `/setup`), computed from existing ledgers.
- No outreach, no marketing acts (§4). This is the instrument that
  decides v5's direction: reach vs RBAC vs deepen.
- Acceptance: rendered funnel with truthful zeros; the v5 drafting sweep
  can cite it.

## Gated (needs Wes before any build)

- **FinOps Phase C / CostClaw paid add-on** — RFC 0002 §8 billing
  decision. Money. The prepared analysis exists; nothing builds until the
  explicit go.

## Watch list (kill-list revival triggers from v3.7)

- Guard degradation recurrence → revive load-CI wiring + the LLM
  slow-path scenario.
- A consumer surface ships a hook contract → revisit the enforcing-proxy
  KILL (`docs/architecture/enforcement-boundary.md`).
- Hosted multi-tenant future → per-org JWKS issuer binding.
- More than one human governs an org → team/RBAC.

## v4 order rationale

v4.1 first: it is live noise today, it is the smallest item, and an
approval dimension pinned at 0 poisons every posture read that follows.
v4.2 second: everything downstream — mining, learning, posture, and
v4.5's evidence — consumes the action stream; completeness before new
consumers. v4.3 is spec-gated and independent, and its lineage enriches
what v4.4 and v4.5 review. v4.4 before v4.5 so the loosening direction
ships into the unified surface instead of minting a fourth queue. v4.6 is
small, last, and produces the evidence that shapes v5. Order changes only
with a written reason in the commit (v1 rule, kept).

## Standing chores (no status; every session touches them as needed)

- Registry truth: `npm view` the four packages vs manifests when releasing.
- Dependabot: keep at zero open alerts; per-lockfile fixes.
- Corpus: add vectors per MAINTAINER.md protocol as incidents occur.
- Keep `/explain`, README, and docs truthful when any of the above ships.

(The Dependabot EOVERRIDE chore from v1–v3 is dropped: resolved in v3.7,
commit `fca42a34`.)
