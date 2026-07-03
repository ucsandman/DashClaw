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
| v2.3 | Approvals lifecycle hygiene | DONE 2026-07-02 (v4.30.0; clients declare `approval_wait_seconds`, server stamps `approval_expires_at` = wait + 15-min retry grace; lazy expiry on queue/read/approve, legacy rows expire at 24h; `expired` is first-class and non-approvable — acting on it returns 410 APPROVAL_EXPIRED; x402 purchases reconcile pending→expired/denied and stop reserving budget; /approvals renders an Expired section; also fixed MCP wait_for_approval misreporting real approvals (`status==='completed'` bug); spec docs/plans/2026-07-02-approvals-lifecycle-hygiene.md; smoke = 67) |
| v2.4 | Advocate v2a: assumption-invalidation notifications | DONE 2026-07-02 (v4.31.0; spec-first, Wes-ratified: operator-only invalidation, inbox + guard-advisory transport, "mid-task" = until acknowledged; no new tables — the `assumption_invalidated` inbox message IS the record, its read state IS the ack; `assumption_alerts` rides `POST /api/guard` (family-matched, LIKE-escaped, 30s negative cache, advisory-only) until the pretool hook prints + marks read; /assumptions shows notified-unread/acknowledged chip; also fixed the /assumptions context-menu invalidate 404 (serial id vs asm_* id — the trigger path was dead); spec docs/superpowers/specs/2026-07-02-assumption-invalidation-notifications-design.md; smoke = 72) |
| v2.5 | Advocate v2b: "was I manipulated" session retro | DONE 2026-07-02 (v4.32.0; spec-first, Wes-ratified: both consumers day one, rule-based detectors no LLM, computed on read no new tables, tri-state posture + evidenced findings; `GET /api/sessions/{id}/retro` + Retro card on /sessions/{id} + `dashclaw_session_retro` MCP tool (33rd, hosted /api/mcp inherits); honesty block = coverage vs ungoverned actions; guard?record=true does NOT record blocks — smoke O3 links via explicit guard_decision_id on POST /api/actions; riskOf NULL→excluded fix; spec docs/superpowers/specs/2026-07-02-session-retro-design.md; smoke = 76) |
| v2.6 | Calibration flywheel automation | DONE 2026-07-02 (v4.33.0; synthetic-traffic filter default-on in the miner — smoke/self-test agent families + `smoke.*` types, 725 excluded in live proof; `--propose/--summary/--top` proposal mode with provenance + exact forge ratify commands, capped top-15/rule after 5.8k raw candidates; weekly `.github/workflows/calibration-mine.yml` renders proposals into the run summary + uploads the artifact, human ratifies, nothing auto-applies; corpus at 33 vectors; spec docs/superpowers/specs/2026-07-02-calibration-flywheel-automation.md) |
| v2.6b | Calibration proposals human surface (HUMAN-EXPERIENCE.md debt) | DONE 2026-07-02 (v4.34.0; spec-first: /policies gains a Calibration proposals section — evidence cards with Ratify…/Dismiss… buttons (armed-confirm), computed on read from the org ledger via the same pure mining pipeline as the weekly workflow (synthetic filter always on); decisions persist in calibration_proposal_decisions (0040) keyed by the content-stable cv_ id, so judgments survive recomputation; ratified-not-forged orphans surface from snapshot — the maintainer queue is GET ?status=ratified, closed by mark_forged; weekly workflow unchanged except its summary links the product surface; rendered + clicked proof via headless browser incl. ratify→persist→undo; security review SHIP-SAFE (GET representative now redacted); route count 325; v4.34.1 same day fixed fresh-schema gaps the ship exposed — ::timestamptz casts, stale SDK contract fixture, and the dead fresh-install presence heartbeat (drizzle 0041 + smoke Q1); smoke = 82) |
| v2.6c | x402 budget consumption visibility (HUMAN-EXPERIENCE.md debt) | DONE 2026-07-03 (v4.35.0; GET /api/x402/budget renders the state the gate computes: per budget-bearing x402_spend_limit policy, window spend from the SAME sumWindowSpend predicate (org scope) or the new sumWindowSpendByFamily family rollup (agent scope), honoring agent_ids targeting — a family the policy never gates has no meter; /spend/x402 gains "Window budgets" meter cards (warning ≥ approval threshold or 80% of hard budget, error ≥ budget, approval tick) honoring the agent filter; /policies/rules x402 rows carry a live "$X of $Y used" suffix; demo handler + smoke B7 pins meter == gate accrual (smoke = 83); rendered proof via headless browser on a real $708-of-$800 warning-band scenario; ride-alongs: rate_limit rows rendered "undefinedmin" (now defaults 60 like the guard), X402PolicyRules type gained the budget tier; the /decisions list risk-composition hint was NOT folded in — it needs a guard_decisions join on the hot list path, deferred to the next /decisions touch; routes = 326) |
| v2.6d | Marketing & docs backfill: the era's 10 capabilities (HUMAN-EXPERIENCE.md debt) | DONE 2026-07-03 (v4.35.1; one sweep under .impeccable.md: landing operations cards carry the era's capabilities (risk composition, per-harness identities, session retros, advocate rollup, tuning proposals, x402 budget meters, degradation, assumption invalidation, approval expiry); /self-host grid gains a Spend Governance card + era items across Governance/Observability/Security; /docs gains risk_breakdown, policy tuning proposals, degradation observability, x402 spend-limit tiers + GET /api/x402/budget entry, and composed identities — all sidebar-anchored; /explain gains the session-retro section (advocate successor, clean/review/flagged); /connect approval step documents the expired outcome; the landingData dead-array trap is REMOVED (only the 3 rendered arrays remain; check-doc-counts + ship-skill notes updated); rendered proof headless on all 5 routes, zero console errors; no new API surface, no SDK republish) |
| v2.7 | Desktop distribution closeout | DONE 2026-07-03 (v4.36.0; three parallel audits (truth pass / plugin parity / listing readiness) then one fix sweep. Truth: the broken `.mcpb` path is RETIRED (scripts + test deleted, mcp-server README section replaced with the OAuth-connector pointer), stdio no longer attributed to Desktop chat anywhere (root README coverage table split, mcp-server README header, /docs CodeBlock title), README Streamable-HTTP section now names the connector + `claude-desktop` identity. Parity: Codex installer ships `dashclaw_code_session_reporter.py` (Code Sessions ingest was silently dead — import swallowed by try/except), hosted /api/mcp pins server-level `agentId: 'claude-desktop'` for OAuth Bearer callers (identity-as-governance-primitive; Bearer wins over x-api-key to mirror `_authHeaders`, 3 route tests), plugin manifests locked at 2.15.0 with a SECOND version-sync group in check-version-sync.mjs, desktop builder reads the canonical manifest version, Hermes README env var corrected (`DASHCLAW_HERMES_AGENT_ID`), PLUGIN_PARITY.md rewritten with Desktop as 4th surface + explicit Codex deltas (no SessionStart digest — lifecycle unverified). Listing: NEW public /privacy page (footer-linked; the connector-directory immediate-rejection blocker) + /self-host Claude Desktop tile + docs/DISTRIBUTION-LISTINGS.md runbook — Wes's three clicks: `npm run release:mcp` (registry lags npm at 2.0.0 vs 2.0.1), the claude-community submission form, the connector-directory portal (needs Team/Enterprise org + reviewer account). Rendered proof headless on /privacy, /self-host, /docs — zero console errors; preship sweep GO, its one security finding (dual-header identity skip) fixed + pinned) |
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

## v2.6b Calibration proposals human surface (inserted 2026-07-02)

Order change reason: v2.6 shipped its review surface as a GitHub Actions
summary with copy-paste forge commands, and Wes rejected that flow the same
day ("I do not want to go into github and copy a command and run it in a
terminal"). That verdict became the `HUMAN-EXPERIENCE.md` contract; this
item is its first debt payment and jumps ahead of v2.7 because the weekly
miner is already producing batches nobody can comfortably review.

- In-product proposal review: proposals rendered as evidence cards on a
  DashClaw page (spec decides: /policies review feed vs. a calibration
  section) — shape, evidence tier, counts, risk range, at a glance.
- Ratify / dismiss are **buttons**. A ratified proposal is recorded as the
  human's decision; the maintainer session turns ratified proposals into
  fixture vectors + scorer fixes (the mechanical commit stays with the
  maintainer, mirroring the approvals pattern — judgment is a click,
  constitution §3 intact).
- The weekly workflow feeds the surface instead of (or in addition to) the
  Actions summary — spec decides the transport (ingest endpoint vs.
  computed on read from the ledger).
- Acceptance: Wes reviews a real weekly batch entirely in the product —
  zero terminal commands, zero GitHub visits; rendered proof via
  frontend-verify; smoke pins the ratification record.

## v2.6c x402 budget consumption visibility (inserted 2026-07-02)

From the era retro-audit (docs/plans/2026-07-02-human-experience-retro-audit.md):
the cumulative budget gate enforces window budgets but never renders the
state it computes — an operator can't see "this agent is at $43 of $50"
until a purchase blocks. `sumWindowSpend` (x402.repository.ts) is
guard-only; it needs a read path and a meter on /spend/x402 (and the
policy's card), honoring the budget scope (org vs per-agent family).
Acceptance: a seeded near-budget scenario renders the meter live; the
minor punch-list items adjacent to this UI (decisions-list composition
hint) ride along if cheap.

## v2.6d Marketing & docs backfill (inserted 2026-07-02)

The era audit's systematic clause-4 failure: /self-host's completeness
grid and the rendered landing page carry none of the 10 capabilities
shipped v4.22.0–v4.33.0; /docs is missing tuning proposals, x402 budget
tiers, degradation observability, risk_breakdown, and the per-harness
identity system; /explain lacks the session-retro successor to its
advocate section; landingData.js's five dead unrendered arrays get wired
or removed so the trap dies. One coherent build session under
.impeccable.md (visually stunning, first-glance legible, no
crypto/web3 drift), verified rendered per the contract. Going forward
this item never recurs: clause 4 puts marketing in every ship.

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
