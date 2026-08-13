# RFC: Plan Deviation as a First-Class Governance Event

- **Status:** PROPOSED (design only — no production code in this pass)
- **Date:** 2026-08-11
- **Builds on:** `docs/rfcs/2026-07-06-preflight-plan-authorization.md` (shipped: `plan_authorizations`, `plan_authorization_steps`, `applyPlanStepGrant`)
- **Closes:** that RFC's deferred non-goal #1 — *"No plan-vs-actual divergence detection or trajectory scoring (future: Trajectory Anomaly Engine consumes plan data)."* This is that follow-on.
- **Reference implementation (file case only):** `~/.claude/hooks/manifest-gate.cjs`, `~/.claude/docs/manifest-gate.md`
- **Why an RFC and not a spec:** it amends a contract — one guard policy type (surface budget 16 → 17, requiring a THESIS.md amendment), one new table, one new realtime event key, and additive fields on the guard/record wire shape. `docs/superpowers/specs/` is the right home for a design that fits inside existing contracts; this does not.

---

## 1. Summary

DashClaw holds both halves of the comparison and never connects them.

- `dashclaw_plan_submit` records **declared intent** as forward-looking authorization: an ordered list of `{ action_type, step_goal, act? }`, each dry-run through the guard pipeline.
- `dashclaw_record` / `dashclaw_guard` record **what actually happened**.

Deviation is the diff. Today nothing computes it — and more precisely, today the diff is computed and *thrown away*: `consumePlanStepGrant` runs an exact match of the live action against every approved step, and the no-match branch simply falls through to normal governance without leaving a trace. The signal already exists as the else-branch of a query that runs in production.

This RFC makes that else-branch durable, classified, and policy-visible. Deviation is **always recorded** and fed into the existing `allow` / `warn` / `block` / `require_approval` engine as a new input. Policy decides the consequence; the mechanism never decides it. Default consequence is `warn`, and **no policy row is installed by default** — a fresh install changes behavior not at all.

---

## 2. The single most important constraint: not forced-blocking

This is a design *requirement*, inherited from building the file-level prototype, and it outranks every other consideration in this document.

The manifest gate fails closed and blocks a commit. Its bypass is `git commit --no-verify` — **a flag it shares with the secret scanner**. Every time the gate blocks a legitimate, correctly-reasoned deviation, it teaches the operator to reach for the one flag that also disarms secret scanning. A gate whose false positives train a bypass reflex converts a low-severity nuisance into a credential-exposure path. The bypass is more dangerous than the thing being gated.

The same shape appears in any hard-blocking version of this feature inside DashClaw. If deviation blocked by default, the escape hatch operators would reach for is org halt / policy disable / `DASHCLAW_GUARD_UNAVAILABLE_POLICY=allow` — controls that exist for genuine emergencies. Training a reflex to reach for them is strictly worse than an unrecorded deviation.

Therefore, three hard invariants:

- **D1 — Recording is unconditional and never gated by policy.** A deviation row is written whether policy says `allow`, `warn`, `block`, or nothing at all. Detection and consequence are separate subsystems.
- **D2 — The shipped default is `warn`, and no `deviation_response` policy row is created on install or migration.** Blocking on deviation is an operator's explicit, per-kind, opt-in act.
- **D3 — The detector fails soft.** A broken deviation computation must never block, delay, or fail a guard call.

D3 is a deliberate inversion of the reference implementation, and the reason matters. `manifest-gate.cjs` fails **closed** because it is an authorization gate: a verification gate that silently passes when broken is exactly the failure it exists to remove. DashClaw deviation fails **soft** because it is an *observation*, not an authorization. It sits next to `applyPlanStepGrant`'s consumption lookup (fail-soft) rather than its deny lookup (fail-closed). Nothing is being permitted by the deviation detector, so nothing is unsafe when it is silent — it only costs coverage, which we report honestly rather than hide (§9).

---

## 3. Where the event slots in

"Event schema" means three distinct things in this codebase. Deviation needs a slot in each, and only one of them costs surface budget.

| Layer | Existing members | Deviation's slot | Budget cost |
|---|---|---|---|
| Durable attached facts | `assumptions` (attached to `action_id`, operator lifecycle `validated`/`invalidated`) | **new table `plan_deviations`** | none — tables are not a budgeted surface |
| Guard decision provenance | `_calibration`, `_plan_grant`, `_timings` in the `guard_decisions.breakdown` JSON | **`_plan_deviation`** sibling key | none |
| Realtime SSE bus (`app/lib/events.ts`) | `GUARD_DECISION_CREATED`, `SIGNAL_DETECTED`, … | **`PLAN_DEVIATION_DETECTED: 'plan.deviation.detected'`** | none |

The framing that makes this coherent — deviation completes a triad of attached facts, each answering a different question about one action:

- `assumptions` — *what I believed was true.*
- `plan_deviations` — *how what I did differed from what I said I would do.*
- `guard_decisions` — *what the runtime ruled about it.*

`plan_deviations` is modelled directly on `assumptions`: org-scoped, attached to an `action_id`, with an operator lifecycle (`open` → `acknowledged` / `accepted` / `rejected`) mirroring `validated`/`invalidated`. That is a deliberate reuse of a shape the repo already renders, queries, notifies on, and rolls into the session retro.

The `guard_decisions.breakdown` echo is free and buys `/replay` and `/explain` support with no new code, exactly as `_plan_grant` and `_calibration` already do. Per the score-provenance rule, `_plan_deviation` is a **sibling** key and never enters the hashed score vector.

---

## 4. Event payload

```jsonc
{
  "deviation_id": "dv_9f2c41a7b8e30d15",   // dv_<16hex>, mintId() convention
  "org_id": "org_...",
  "agent_id": "claude-code",
  "session_id": "sess_...",                 // nullable
  "action_id": "act_...",                   // nullable (guard-time, pre-record)
  "guard_decision_id": "gd_...",            // the evaluation that observed it
  "plan_id": "pa_...",                      // the live plan measured against
  "step_id": "ps_...",                      // nearest/matched step; null for unplanned_action

  "kind": "act_substitution",               // taxonomy, §5
  "dimension": "act",                       // action_type | goal | act | path | system | sequence | existence
  "severity": "high",                       // info | low | medium | high  (derived, §5)

  "declared": {                             // what the plan authorized
    "action_type": "deploy",
    "step_goal": "deploy web to staging",
    "act_content_hash": "sha256:1f3a...",
    "act_summary": "shell: npm run deploy:staging"
  },
  "observed": {                             // what actually arrived at the guard
    "action_type": "deploy",
    "declared_goal": "deploy web to staging",
    "act_content_hash": "sha256:c07e...",
    "act_summary": "shell: npm run deploy:prod",
    "target": "infra/prod.tf",
    "systems_touched": ["production"]
  },

  "detector": "server_derived",             // server_derived | agent_reported  (§6)
  "match_confidence": 92,                   // 0-100; how sure we are this is the step it meant
  "agent_note": null,                       // optional, additive-only enrichment
  "policy_outcome": "require_approval",     // what the engine did with it, or "none"

  "status": "open",                         // open | acknowledged | accepted | rejected
  "resolved_by": null,
  "resolved_at": null,
  "created_at": "2026-08-11T14:03:22.118Z"
}
```

`declared` and `observed` are deliberately parallel objects rather than a flat diff. An operator card renders them side by side with no client-side reshaping, and the payload stays readable in the raw ledger. Both pass through the same `redactAny` path `plan_authorization_steps.act` already uses — a deviation must never become the one place a secret-bearing act sits unredacted.

---

## 5. Generalising declared scope past files

The manifest gate declares **paths** and diffs them against the git index. DashClaw's declared unit is an *action*, so the scope envelope has to widen. The good news is that the vocabulary already exists: the guard input schema accepts `target`, `write_paths`, `content`, `tool_name`, `systems_touched`, and a structured `act` (`shell` / `http` / `sql` / `file`). Nothing new needs inventing — deviation reads the fields DashClaw already collects.

A plan step's declared scope is therefore the tuple it already stores — `action_type`, `step_goal`, optional `act` + `act_content_hash` — widened by two optional declarations added to the step shape (§7).

| kind | dimension | Fires when | Default severity |
|---|---|---|---|
| `unplanned_action` | existence | A live plan exists for this agent and the action matches **no** step | medium |
| `goal_drift` | goal | `action_type` matches a step, but `step_goal` ≠ `declared_goal` beyond the similarity floor | low |
| `act_substitution` | act | A step matched on type + goal, but the live `act_content_hash` differs from the declared one | **high** |
| `scope_escape` | path / system | `target` / `write_paths` / `systems_touched` fall outside the step's declared scope | high |
| `sequence_break` | sequence | Approved steps consumed materially out of `seq` order | info |
| `step_abandoned` | existence | Plan reached a terminal state with approved steps never consumed | low |
| `budget_overrun` | existence | More actions matched to one step than the plan declared | low |

Three notes on the taxonomy:

**`act_substitution` is the highest-severity kind, and it is the one the file prototype cannot express.** "Same declared intent, different actual payload" — `deploy:staging` approved, `deploy:prod` executed — is precisely the case a path-based gate misses and the case operators most need to see. `act_content_hash` is already computed and stored on every step, so detection is a hash comparison, not new machinery.

**`step_abandoned` is the mirror of manifest-gate's "which declared paths went untouched" panel** — the case pure per-action detection structurally cannot catch, because it is the absence of an action. It cannot be computed at guard time; it needs a sweep when the plan reaches a terminal state (§8).

**`unplanned_action` fires only when a live plan exists** for that agent. This is the single most important backward-compatibility guard in the design: without it, every agent that has never submitted a plan — which is nearly all of them today — would emit a deviation on every action. See §10.

Severity is derived server-side from the kind, crossed with whether the observed side touches a system the step never declared. It is never taken from the agent.

---

## 6. Self-reported vs server-derived — and what each costs in trust

**Recommendation: server-derived is authoritative and mandatory. Agent self-report is optional, additive-only enrichment that can never suppress, downgrade, or resolve a derived deviation.**

The trust analysis:

*Self-report alone fails exactly when it matters.* The agent that deviates is the agent least likely to report deviating. A prompt-injected, misaligned, or simply confused agent omits the call — and the failure mode is perfectly correlated with the condition being detected. It is also unfalsifiable: "no deviation reported" and "deviation concealed" are the same observation. As a control it is worth approximately zero; as an *honesty signal* (does this agent self-report deviations that the server independently derived?) it is genuinely valuable, which is why it is kept rather than dropped.

*Server-derivation cannot be suppressed by the agent*, which is the whole point. It costs two things. It is blind to intent — it cannot tell a justified deviation from a dangerous one, which is exactly why the operator, not the detector, decides consequence. And it is blind to anything never declared to the guard (§9).

This asymmetry is not novel here; it is the established pattern in this codebase, and deviation should match it rather than invent a third convention:

- Guard risk is `max(server, client)` — the agent can raise its own risk, never lower it.
- WRITE identity: the server-configured `agent_id` wins over anything the LLM passes, because identity is a governance primitive.
- The session retro's honesty rule: *"an ungoverned action lowers coverage, it never fabricates a clean."*

Concretely, the enforced rules:

- An agent report **may** attach an `agent_note`, and **may** raise severity.
- An agent report **may never** lower severity, clear a derived deviation, set `status`, or mark one `accepted`. Only an operator resolves a deviation.
- A self-reported deviation with no corresponding derived match is recorded with `detector: "agent_reported"` and severity capped at `low` — it is a claim, not a finding.
- Absence of agent reports lowers a coverage number. It never produces a "clean".

---

## 7. Surface changes and the budget

**This is the sharpest constraint on the design, and it is tighter than the brief assumed.** `npm run surface:check` on `main` today:

```
ok  apiRoutes        131 / 131      ok  mcpResources        3 / 3
ok  appPages          53 / 53       ok  sdkNodeMethods     39 / 39
ok  mcpTools          17 / 17       ok  sdkPythonMethods   59 / 59
ok  cliCommands       15 / 15       ok  guardPolicyTypes   16 / 16
```

Every governed surface is exactly at its ceiling. There is **zero headroom anywhere**. Any addition is not merely "budgeted cost" — it requires amending `THESIS.md` *and* `contracts/surface-budget.json` in the same commit with a written reason. The budget did the design work here: it forced the version of this feature that rides existing plumbing, which is the version that should ship anyway.

### MCP: zero new tools

Verified from source — `countMcpTools()` in `scripts/check-surface-budget.mjs` matches `/^\s*name:\s*['"]dashclaw_/gm`, i.e. **tool names only**. Adding fields to an existing tool's `inputSchema` costs nothing.

- **Derivation needs no tool.** It is server-side, so there is nothing for an agent to call.
- **The agent learns of its deviation through the existing `dashclaw_guard` response**, as a warning line — the identical channel `applyPlanStepGrant` already uses for `Covered by plan pa_… step 2/5`. Zero cost, and existing clients that ignore unknown warnings are unaffected.
- **Optional self-report rides as new fields** on the existing `dashclaw_record`: `plan_step_id`, `deviation_note`. Fields, not tools. Zero cost.
- **Optional widened scope rides as new fields** on `dashclaw_plan_submit`'s step objects: `declared_paths?: string[]`, `declared_systems?: string[]`. Zero cost, and both are optional so every existing plan submission stays valid.

### Routes: zero new routes

Deviations attach to responses that already exist rather than getting a collection endpoint:

- `GET /api/plans/[planId]` → gains `deviations[]`.
- `GET /api/actions/[actionId]` → gains `deviations[]`.
- `GET /api/sessions/[sessionId]/retro` → gains deviation-derived findings (§11).
- Operator resolve verb folds into the existing `POST /api/plans/[planId]` (which already carries `approve` / `deny` / `revoke`) as `{ verdict: 'resolve_deviation', deviation_id, resolution }` — reusing its established separation-of-duties auth rather than standing up a new authenticated write path.

### Pages: zero new pages

Rendered on surfaces the operator already watches (§8).

### The one budgeted line item: `guardPolicyTypes` 16 → 17

A new policy type **`deviation_response`** is the only ceiling this RFC proposes raising, and it is proposed deliberately rather than worked around.

The alternative — folding deviation severity into `effectiveRiskScore` so existing `risk_threshold` policies react — costs zero budget and was seriously considered. It is rejected because it collapses seven qualitatively different kinds into one number, so an operator cannot say *"block `act_substitution`, warn on `goal_drift`, ignore `sequence_break`"*. That per-kind consequence is the entire point of the brief's "policy decides the consequence," and risk-folding quietly reintroduces the single-dial problem the policy engine exists to avoid.

Precedent and procedure are both clear: `role_constraint` raised this exact ceiling 15 → 16 on 2026-08-10, one day before this RFC, with a written reason in `surface-budget.json`. This follows that path.

```jsonc
// policy_type: "deviation_response" — all optional, all tighten-only
{
  "on_kind": {
    "act_substitution": "require_approval",
    "scope_escape":     "require_approval",
    "unplanned_action": "warn",
    "goal_drift":       "warn"
  },
  "min_severity": "medium",          // ignore anything below this
  "escalate_action": "require_approval"   // ceiling: require_approval | block | warn
}
```

Evaluator behaviour, structurally matching `role_constraint`:

- Reads the deviation the detection phase attached to the guard context; returns `null` when there is none — so it is a no-op for every agent without a live plan.
- **Tighten-only.** It can raise to `warn` / `require_approval` / `block`; it can never grant, and never downgrades anything. It joins the decision lattice by max, like every other evaluator.
- Ships with **no default row** (D2). An operator creates one at `/policies` → New policy → Deviation response.

SDK methods stay at 39/59: deviations arrive inside existing response payloads, so no new methods are needed. CLI stays at 15.

---

## 8. Where it is computed

**Not inside `applyPlanStepGrant`.** That function is gated on `acc.highestDecision === 'require_approval'` (`evaluate.ts:516`) and returns early on `block` (`:479`). An off-plan action that evaluates to `allow` never queries the plan at all — so the grant path structurally cannot see the majority of deviations. This is the single most common way to get this design wrong.

Instead, a new phase `runDeviationCheck(deps, options, acc)` placed **after** the grant passes and beside `runSignalChecks` (`evaluate.ts:1085`), which already runs on every evaluation regardless of decision.

- Runs on **every** guarded action, for all four decisions.
- **Skipped entirely when `options.simulate` is true.** A plan's own dry-run preview must never record deviations against the plan being previewed — the same discipline that already excludes both grant passes from simulate mode.
- **Fail-soft** (D3): wrapped exactly like `runSignalChecks`' best-effort catch. A failure logs and continues.
- Writes the row, publishes `PLAN_DEVIATION_DETECTED`, and attaches the finding to `acc` so the `deviation_response` evaluator can read it in the same evaluation.

**Hot-path cost is the real risk here**, and it must be bounded before this ships. A naive implementation adds a DB probe to every guarded action. Mitigation: a `hasLivePlan(org, agent)` lookup behind the existing guard hot-path cache (30s TTL, cleared by `__resetGuardCaches()`), so the overwhelmingly common case — no live plan — costs a cache hit and no query. Only agents inside a live plan window pay for the step-matching probe, which rides the existing `idx_plan_authorization_steps_consume` partial index. This must be measured against the guard latency budget during build, not assumed.

`step_abandoned` cannot be computed at guard time. It is a sweep at plan terminalisation (review → `revoked`, or TTL lapse observed on a read path), emitting one deviation per approved-but-unconsumed step. The plans repository already derives `expired` status on read, which is the natural hook.

---

## 9. The honest limitation: claims vs ground truth

This must be stated plainly in the docs, because the gap is fundamental and a reader coming from the file prototype will otherwise assume equivalence.

**`manifest-gate.cjs` observes reality. DashClaw deviation observes claims.**

The manifest gate diffs against `git diff --cached` — ground truth that exists whether or not the agent cooperates, produced by a system the agent does not mediate. DashClaw's detector can only diff against what was declared to the guard. An agent that writes a file without calling guard produces no deviation event, because from the runtime's perspective nothing happened.

Deviation therefore **strengthens governed paths; it does not create coverage.** The mitigations narrow the gap without closing it:

- `act_content_hash` binding makes the *governed* file case as strong as the prototype's — a `file` act carries `{ path, content_excerpt, bytes }`, so a declared-vs-actual file diff is exact, not heuristic.
- The Claude Code hook's `write_paths` enrichment already routes most real file writes through the guard.
- Coverage is **reported, never hidden**: every deviation surface shows `actions_analyzed / actions_total`, inheriting the retro's honesty rule verbatim. Low coverage lowers a number; it never renders a "clean".

Anyone wanting true output-side ground truth on files should keep running the manifest gate. The two compose — the prototype gates the commit, DashClaw governs the run — and neither subsumes the other.

---

## 10. Backward compatibility

The design is inert until an operator opts in. Each guarantee, and the mechanism that provides it:

| Guarantee | Mechanism |
|---|---|
| Agents that never submit plans see **no** change | `unplanned_action` requires a live plan; the detector returns before any query when `hasLivePlan` is false |
| No behaviour change on upgrade | No `deviation_response` row installed by default (D2); with no policy, deviation is recorded and rendered but consequence-free |
| Existing plan submissions stay valid | `declared_paths` / `declared_systems` are optional additive step fields |
| Existing MCP/SDK clients unaffected | No tool added, no field made required; the guard response gains one optional warning line, and unknown fields are already ignored |
| Existing tests keep passing | No existing signature changes; the detector is a new phase, not an edit to an existing one |
| A broken detector cannot break governance | Fail-soft (D3) |
| A plan dry-run cannot deviate against itself | Simulate-mode skip (§8) |

Migration is one additive table plus indexes. No backfill: deviation is undefined for actions that predate the detector, and inventing historical deviations would fabricate findings — the opposite of the honesty rule.

---

## 11. Reconciling with what already exists (contradictions flagged)

The brief asked for anything contradicting it. Five items, in descending importance.

**1. "Nothing computes it" is not quite true — and the overlap will double-report if ignored.** `app/lib/session-retro.ts:156-172` already emits a `goal_drift` finding, comparing each action's `declared_goal` against the session's *first* declared goal by normalized string equality, gated at `risk >= 40`. It is session-scoped, post-hoc, read-only, and never reaches the policy engine, so the *plan-vs-actual* diff this RFC describes is genuinely absent. But a goal-drift detector exists and ships today.

Recommendation: the retro **consumes** derived deviations rather than keeping its own parallel string check. Its `RetroFinding.kind` union already contains `'goal_drift'`, so deviations map onto the existing finding shape with no schema change to the retro contract, and the session-first-goal heuristic is retired in favour of the plan-anchored comparison, which is strictly better evidence. If both are kept, every plan-anchored goal deviation is reported twice with different thresholds.

**2. "plan_submit … never sees files" is imprecise, in a way that helps.** A step may carry a literal `act`, and `act.kind === 'file'` carries `{ path, content_excerpt, bytes }`. `computeActContentHash` already hashes it and `createPlanWithSteps` already stores the hash. So plan submission *can* see files today whenever the agent attaches a file act — which is why the file case (`act_substitution`) needs no new declaration machinery, only a comparison.

**3. The surface budget is tighter than "a budgeted cost."** Every ceiling is exactly full (§7). The constraint is not "spend budget," it is "amend THESIS.md or design around it." Most of this RFC's shape is a direct consequence.

**4. The predecessor RFC explicitly deferred this work**, naming a future "Trajectory Anomaly Engine" as the consumer of plan data. Not a contradiction — confirmation this is the planned sequel. `plan_deviations` is the substrate that engine would read; this RFC deliberately stops at recording + per-action policy and does **not** attempt trajectory scoring across actions.

**5. `dashclaw_plan_status` returns per-step `grant_status` but has no deviation notion.** Once deviations exist, a step that was approved, never consumed, and superseded by an off-plan action is materially different from one simply not yet reached — and today they are indistinguishable to a polling agent. Adding `deviations[]` to the plan payload (§7) resolves this without a new tool.

---

## 12. Human surface (HUMAN-EXPERIENCE.md, answered in writing)

1. **Where does a human SEE it?** Three existing surfaces, no new pages. `/approvals` — the plan review card gains a deviation strip ("3 deviations · 1 high"), and a `require_approval` raised *by* a deviation renders the declared-vs-observed pair side by side, which is the whole story on one card. `/decisions` — rows carry a deviation badge beside the existing `plan pa_… step k/n` badge, opening the same drawer. `/sessions/[id]` retro — deviations appear as findings via §11.1.
2. **Is it discoverable?** It arrives in the Approvals inbox the operator already watches, through the notification bridges approvals already use. No new place to look, no new habit required.
3. **Is every human step a CLICK?** Yes. Acknowledge / Accept / Reject are buttons on the deviation row. Setting consequences is the existing `/policies` → New policy → Deviation response form. Zero terminal commands, zero GitHub visits.
4. **Was it verified rendered?** At build time, `frontend-verify` drives `/approvals`, `/decisions`, and `/policies` against a seeded plan with one deviation of each kind, asserting the card renders, the declared-vs-observed pair displays, and the resolve buttons mutate state. Not yet done — this is a design pass, and the gate is stated here so it is designed in rather than bolted on.

One borrowed detail worth keeping: the manifest gate's block message prints the exact command that would declare the off-plan files, so recording the deviation is one deliberate act. The DashClaw equivalent — **"Accept & amend plan"**, which resolves the deviation *and* adds the observed action as an approved step — turns acceptance into a recorded amendment rather than a silent dismissal. It is the difference between an operator waving something through and an operator saying "yes, that was in scope, and now the plan says so."

Design per `.impeccable.md`: CSS tokens only; orange reserved for the "needs you" cue and never for `info`/`low` deviations; severity chips use the existing `status-*` tokens; `tabular-nums` on the declared-vs-observed table.

---

## 13. What this deliberately does not do

- **No verify commands.** The prototype's `--verify` (run `npm run typecheck` before the commit lands) is a different axis: acceptance-criteria execution, not intent-vs-outcome comparison. DashClaw governs actions, not the agent's build pipeline, and adding command execution to the guard path would be both a governance-boundary violation (`CLAUDE.md`: DashClaw is a governance runtime, not an agent platform) and a remote-code-execution surface. Explicitly not carried over.
- **No trajectory scoring or cross-action anomaly detection.** Left to the Trajectory Anomaly Engine, which reads this table.
- **No auto-generated plans.** Deviation is only defined against an explicitly submitted plan.
- **No new enforcement mechanism.** Every consequence flows through the existing policy engine and the existing decision lattice. This RFC adds a signal, not a gate.

---

## 14. Open questions (resolve at build time — do not guess)

1. **Goal similarity threshold.** `consumePlanStepGrant` requires exact `step_goal = declared_goal` equality. `goal_drift` needs a *similarity* measure, or every benign rewording becomes a deviation. Options: normalized equality (the retro's current approach — cheap, noisy), token-set ratio, or embedding similarity (new dependency, likely disproportionate). Recommend starting with normalized equality plus a `match_confidence` field, and tuning from real data via the calibration corpus rather than picking a number now. Do not let a fuzzy match ever *widen* a grant — matching for grant consumption stays exact; similarity is used only to classify a deviation that already happened.
2. **Does `sequence_break` earn its place in v1?** `plan_authorization_steps.seq` exists but the shipped RFC states consumption is explicitly not order-enforced. Emitting `info` findings for a property the system never promised may be noise. Recommend measuring before shipping the kind.
3. **Guard-latency budget.** §8's cache design needs a real measurement against the hot-path budget before merge, including the cold-cache case for an agent inside a live plan window.
4. **Retro reconciliation timing.** Retire the retro's session-first-goal heuristic in the same ship as §11.1, or keep both behind a flag for one release to compare hit rates? Recommend same ship — two detectors disagreeing in the same UI is worse than either alone.
5. **Does an operator "accept" of a deviation imply a grant?** If an operator accepts an `act_substitution` while the action still sits at `require_approval`, is that also an approval of the action? Recommend **no** — keep resolution and approval strictly separate verbs, matching the existing separation between a plan verdict and an action approval. "Accept & amend plan" adds a step for *future* matches; it must not retroactively release the pending action.

---

## 15. Build-time gates (for whoever implements this)

- Unit: kind-classification matrix across all seven kinds; severity derivation; simulate-mode never records; agent report cannot lower severity or resolve; redaction of `declared`/`observed`; `unplanned_action` silent with no live plan. Use `__resetGuardCaches()` in guard tests.
- Route tests for every extended payload, including the operator resolve verb's separation-of-duties auth.
- `scripts/policy-smoke.mjs`: live section — submit plan → approve → execute a substituted act → deviation recorded, policy raises to `require_approval`, operator resolves.
- Full gates before push: `npm run lint`, `npx vitest run` (full suite), `npx next build`, `npm run typecheck`, `npm run db:migrate` idempotency on a scratch DB, `npm run surface:check`, `scripts/check-doc-counts.mjs --strict`.
- `frontend-verify` on `/approvals`, `/decisions`, `/policies` (§12.4).
- GitNexus mandate: `impact({target: "evaluateGuard", direction: "upstream"})` and on `applyPlanStepGrant` before editing; report blast radius. `app/api/guard/route.ts` is the repo's worst-health file (1.0/10) — treat any edit there as high risk.
- Same-ship documentation contract: `THESIS.md` anti-regrowth amendment (16 → 17) with written reason, `contracts/surface-budget.json`, `docs/architecture/runtime-api.md` deviation subsection, and every cited policy-type count.
