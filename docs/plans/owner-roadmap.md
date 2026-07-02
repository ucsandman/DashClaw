# Owner roadmap — build order under MAINTAINER.md

Living document: the maintainer updates status lines as items ship; order
changes only with a written reason in the commit. Each item ships the full
protocol: spec → build → gates → live proof → main.

**Status ledger** (update in place):

| # | Item | Status |
|---|------|--------|
| 0 | Foundation: claims audit, policy smoke in CI, risk-calibration suite, self-host key auth, SSRF fix, vulns, policies API DX | DONE 2026-07-01 (`0ac3e557..ae8e13b4`) |
| 1 | Policy-tuning proposal loop | DONE 2026-07-01 (`2cd1071a..478c7231`, v4.22.0; CI green incl. smoke T1) |
| 2 | Cumulative x402 budget gate | DONE 2026-07-02 (`583bf595..dfeac026`, v4.23.0; smoke B6 live 44/44; security review PASS, MEDIUM TOCTOU fixed in-ship) |
| 3 | Calibration corpus v2: mining | DONE 2026-07-02 (v4.24.0; miner + forge shipped, corpus 22→26, cd-chain/npx classifier fixes, git-show 30→100 case closed) |
| 4 | Agent's-advocate surface | DONE 2026-07-02 (v4.25.0; agent_defense rollup on GET /api/actions/:id via guard_decision_id FK, _shields persistence, UI card + replay badges + /explain advocate section; smoke 49/49 incl. H1–H4; security review PASS; bonus: PowerShell cmdlet classification fixes two wrong hook blocks, corpus 26→31) |
| 5 | Effective-risk escalation observability | DONE 2026-07-02 (v4.26.0; velocity +5 now amplifier-only (needs failure_rate>0.25), LLM ±20 trigger = server evidence only (client score can't recruit it), breakdown decomposes statistical vs LLM, FK-path lift bug fixed + legacy list 42883 500 fixed, /replay composition strip; smoke 53/53 incl. I1–I3) |
| 6 | June-deferral triage | DONE 2026-07-02 (v4.27.0; verdicts in spec 2026-07-02-june-deferral-triage.md — BUILT: /api/guard days param (+/activity true weekly denied), docs evaluations walkthrough + empty-state links, agent-picker ?agent= URL persistence (context-level, no useSearchParams); KILLED: /workflows Runs tab (ledger IS the org-wide runs view — discoverability link added), LiveStream cadence port (30s poll has no flood to pause); smoke +J1/J2) |

## 1. Policy-tuning proposal loop (the "living codebase" centerpiece)

Close the loop from outcomes back to policy configuration — with a human
ratifying every change (constitution §3).

- Per-policy interruption stats: for each guard policy, count interruptions
  (warn / require_approval / block), approval outcomes of those
  interruptions (approved / denied / timed out), and the override rate, over
  a rolling window. Data already exists in guard decisions + the approvals
  ledger; this aggregates it.
- Proposal engine: rule-based first, no LLM — e.g. "risk_threshold X
  interrupted 40 times in 30 days, 39 approved → propose raising threshold
  70→80" / "rate_limit never fired in 60 days → propose no change" /
  "block_action_type Y denied 12/12 → propose keeping (evidence it works)".
  Each proposal carries its evidence.
- Surface: the /policies review feed (the interruption-contract page already
  frames policies as a contract under review). Accept = one click that
  PATCHes the policy (existing route, cache-invalidated); dismiss records why.
- Acceptance: stats endpoint + UI verified live; a seeded scenario produces
  the expected proposal in the policy smoke harness; NOTHING auto-applies.

## 2. Cumulative x402 budget gate

Today `x402_spend_limit` caps only the single purchase. Real cost harm is
cumulative. Add per-window budget rules — design decisions in-build: rolling
window vs calendar month, org-level and/or per-agent scope, interaction with
the per-purchase cap (both must be able to coexist in one policy).

- Guard-time enforcement in the `x402_spend_limit` evaluator (sum of the
  window's `x402_purchases` + the incoming amount vs `rules.budget_usd`).
- Fail-closed question to settle in the spec: what happens when the sum
  query fails (constitution favors block/require_approval, and the deadline
  degradation path exists).
- Acceptance: golden vectors for the evaluator, policy smoke checks (under /
  at / over budget across multiple purchases), docs + /explain playground
  stay truthful (update the caption if semantics grow).

## 3. Calibration corpus v2: mining

- Mine the ~24.5k recorded behavior samples and the approvals ledger for
  candidate vectors: benign commands that scored ≥40, dangerous ones that
  scored <40, approvals repeatedly granted for identical shapes.
- `scripts/add-calibration-vector.mjs`: turn an action_id or a raw command
  into a fixture entry with provenance, running both scorers to suggest
  bounds.
- Also close the open case: why did the `git show` incident reach 100 when
  the server term was 30? (Overlaps item 5.)

## 4. Agent's-advocate surface

Reframe and extend the protective direction: the assumption ledger as the
agent's alibi (evidence of reasonable action on known information),
prompt-injection + non-fabrication as protection FROM weaponization, spend
gates as protection from bankrupting mistakes.

- Concrete first step: a section on /explain + docs positioning, and an
  `agent_defense` rollup in the action detail / replay view (what protected
  this agent, what it declared, what it assumed).
- Bigger candidates (spec first): assumption-invalidation notifications to
  the agent mid-task; a "was I manipulated" retro view over a session.

## 5. Effective-risk escalation observability

The persisted risk score composes server terms, org risk-templates, the
client score, and predictive adjustment — but incident forensics (the
"risk 100" case) couldn't decompose it from the outside. Verify what the
`context` jsonb breakdown already records (score-provenance work exists),
close the gaps, and surface the full composition in /decisions and /replay
so every interruption is explainable in one glance. Feeds items 1 and 3.

Concrete gap list from item 3's ledger forensics (2026-07-02): the
`_risk_breakdown` decomposes historical scores fully — the remaining gaps
are calibration, not observability plumbing. (a) The predictive "velocity"
prior adds +5 whenever `recent_count > 5` even at `failure_rate: 0` over
thousands of actions — a flat tax on active agents with clean histories.
(b) The LLM adjustment (±20) is only consulted when the already-composed
score crosses the threshold, so a false-high client score drags in an
amplifier — the June "risk 100" specimens were client-70 fallback + 5
velocity + 15 LLM. Decide both under this item; the breakdown data to
evaluate them is already persisted.

## 6. June-deferral triage

Evaluate each parked item and either kill it with a reason or build it:
/workflows Runs tab, docs evaluations page, LiveStream cadence port,
/api/guard `days` param, picker URL persistence.

## Roadmap v2 — earn the interruption (drafted 2026-07-02)

v1 built the governance loop: proposals from evidence (1), the budget gate
(2), the calibration miner (3), the advocate surface (4), risk decomposition
(5), deferral triage (6). v2 exists because of what the item-2 governance
audit proved live: the loop interrupts, but not precisely enough — at least
2 of ~10 real interruptions that day were deadline-degradation noise on
mundane edits, every local agent answers to the same name, and stale
approvals looked actionable an hour after their tool calls had already
died. June's 18-day policy-disable is what that friction costs. v2's
thesis: **make every interruption cheap when right and rare when wrong.**

Drafting evidence: the candidates parked during v1, the item-2 audit
follow-ups, and a repo fact-check (2026-07-02) that retired two stale
candidates — the Claude Desktop connector's "needs OAuth" blocker actually
shipped in June (`app/api/oauth/*`, connector confirmed end-to-end
2026-06-02), and the multi-agent governance gap is largely shipped behind
`DASHCLAW_SUBAGENT_IDENTITY` (its remainder folds into item v2.2). Shaping
ratified by Wes 2026-07-02: precision-first, over advocate-first and
reach/revenue-first.

**Status ledger v2** (update in place):

| # | Item | Status |
|---|------|--------|
| v2.1 | Guard-deadline noise: instrument, diagnose, fix | DONE 2026-07-02 (v4.28.0; degraded column + _timings, LLM skip/budget fix — root cause was apply-base-60 recruiting a 1.2–3s LLM on every edit; cockpit strip + evidence exclusion; smoke = 57) |
| v2.2 | Agent identity & attribution v2 | DONE 2026-07-02 (per-harness identity via installer-written `--agent-id` argv — argv > env > harness default; Codex/Hermes wiring fixed; `DASHCLAW_SUBAGENT_IDENTITY` default flipped to `distinct` with /agents parent grouping; targeted policies + `agentExistsInOrg` gained the base fallback; agent-scoped x402 budgets bind the identity family + 0038 index; spec docs/plans/2026-07-02-agent-identity-attribution.md; smoke = 62) |
| v2.3 | Approvals lifecycle hygiene | — |
| v2.4 | Advocate v2a: assumption-invalidation notifications | — |
| v2.5 | Advocate v2b: "was I manipulated" session retro | — |
| v2.6 | Calibration flywheel automation | — |
| v2.7 | Desktop distribution closeout | — |
| — | FinOps Phase C / CostClaw paid add-on | GATED on Wes (RFC 0002 §8) |

## v2.1 Guard-deadline noise: instrument, diagnose, fix

At least 2 of ~10 interruptions in the item-2 live audit were fail-closed
degradations on mundane file edits — guard evaluations exceeding
`DEFAULT_GUARD_DEADLINE_MS` (3500ms, `app/lib/guard.ts`) on the hosted
instance. Every one is a false interruption teaching a human to disable
policies, and it corrupts item-1's tuning evidence (a degraded
require_approval is latency's fault, not the policy's — proposals must
not learn from it).

- Instrument first: degradations are already stamped on persisted
  decisions; aggregate them (per policy / per day) and surface the rate
  where policy owners already look — the /policies cockpit, next to the
  tuning proposals. Degraded decisions get excluded from (or labeled in)
  proposal evidence.
- Diagnose on the hosted instance, not from memory: which sub-evaluations
  eat the 3500ms budget (history lookups, velocity, budget sums, LLM
  trigger)? Cold start vs steady state?
- Fix per evidence — candidates: batch/parallelize sub-queries, widen the
  hot-path caches, tune the deadline, per-evaluator budgets. Decided in
  the spec.
- Acceptance: degradation rate visible on a live surface; a
  previously-degrading path proven within budget live; policy smoke
  extended; proposal evidence excludes or labels degraded decisions.

## v2.2 Agent identity & attribution v2 ("who is asking")

The audit's second finding: Wes couldn't tell who was asking for approval
— every agent on the machine reports the machine-wide `DASHCLAW_AGENT_ID`
("codex"). And the June subagent-identity work (RFC
2026-06-01-subagent-fleet-identities) still sits behind a default-off flag.

- Per-harness identity: derive the reporting identity from the harness
  (Claude Code vs Codex vs Hermes) instead of one machine-wide env var;
  the installer writes it, the hooks read it. The spec decides the
  derivation and the migration path for existing installs.
- Finish subagent fleet identities: run the RFC live checklist with
  `DASHCLAW_SUBAGENT_IDENTITY=distinct`, flip the default in a minor
  release, group sub-agents under their parent in /agents.
- x402 purchases carry agent attribution (item-2 audit follow-up), so
  per-agent budgets bind to the right ledger rows.
- Acceptance: two different local harnesses appear as two identities in
  /approvals live; the composed-identity permission fallback stays pinned
  by smoke.

## v2.3 Approvals lifecycle hygiene

The audit's third finding: approvals whose tool calls had already
hard-blocked (hook timeout) still sat pending; approving them executed
nothing and reported nothing.

- Expire pending approvals once their hook wait is provably dead (the
  hook's poll window is known at request time); expired is a first-class
  state, rendered distinctly, not approvable.
- Acting on an expired record returns a truthful "this can no longer
  release anything" instead of success.
- x402 stale-approval cleanup (item-2 audit follow-up) rides the same
  lifecycle.
- Acceptance: seeded smoke scenario — an approval past the hook window
  shows expired and cannot release anything; /approvals verified live.

## v2.4 Advocate v2a: assumption-invalidation notifications (spec first)

The assumption ledger is the agent's alibi; today it's write-only during a
task. When an assumption is invalidated mid-task — an operator marks it
false, or a later decision contradicts it — the agent should hear about it
before acting on it further. The spec must settle: who can invalidate,
what transport (inbox vs hook-surfaced), and what "mid-task" means for
agents that aren't resident.

## v2.5 Advocate v2b: "was I manipulated" session retro (spec first)

A per-session retrospective for the protective direction: injected-content
flags, actions outside the declared goal, spend anomalies, shield hits —
composed into a defensibility report an operator (or the agent itself) can
read after the fact. Builds on the agent_defense rollup and the session
grouping that already exist.

## v2.6 Calibration flywheel automation

The corpus grows only when a session-holder remembers the protocol.

- Synthetic-traffic filter in the miner (item-3 note): stop offering
  policy-smoke/self-test traffic as candidate vectors.
- Periodic mining runs (scheduled or CI) that PROPOSE vectors with
  provenance; a human ratifies them into the corpus (constitution §3
  spirit — the corpus is enforcement).
- Acceptance: a scheduled run produces a proposal artifact from live
  data; the filter is pinned by unit tests; corpus counts tracked in the
  maintainer log.

## v2.7 Desktop distribution closeout

The v1 candidate was stale: OAuth shipped in June and the consumer
connector works end-to-end. What remains is a truth pass — docs/README
claims about the connector, plugin parity across the Code/Codex/Hermes/
Desktop surfaces, and preparing the public listing. The outward-facing
listing click itself is Wes's (constitution §4 spirit).

## Gated (needs Wes before any build)

- **FinOps Phase C / CostClaw paid add-on** — RFC 0002 §8 billing
  decision. Money. The prepared analysis exists; nothing builds until the
  explicit go.

## v2 order rationale

Items v2.1–v2.3 attack the measured friction from the live audit, in
ascending build size, each independently shippable. v2.4–v2.5 deepen the
product's differentiating direction once interruptions are trustworthy.
v2.6 automates the flywheel that keeps them trustworthy. v2.7 is small and
partly blocked on outward-facing acts. Order changes only with a written
reason in the commit (v1 rule, kept).

## Standing chores (no status; every session touches them as needed)

- Registry truth: `npm view` the four packages vs manifests when releasing.
- Dependabot: keep at zero open alerts; per-lockfile fixes.
- Corpus: add vectors per MAINTAINER.md protocol as incidents occur.
- Keep `/explain`, README, and docs truthful when any of the above ships.
- Dependabot npm_and_yarn updater fails EOVERRIDE (postcss override vs
  direct dep) — untangle the overrides deliberately in a quiet session,
  never mid-ship.
