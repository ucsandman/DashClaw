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

## Roadmap v2 — to be built (Wes-led, next session)

Items 0–6 are done. The next roadmap is Wes's call; these are the candidates
that accumulated during v1, with their origin, so the drafting session starts
from evidence instead of memory:

- **x402 audit follow-ups** (item-2 security review, non-blocking): deadline
  degradation noise on budget queries, agent-id attribution on purchases,
  stale-approval cleanup.
- **Agent's-advocate bigger candidates** (item-4 spec, "spec first"):
  assumption-invalidation notifications to the agent mid-task; a "was I
  manipulated" retro view over a session.
- **Multi-agent governance gap** (memory: leaf calls governed but
  mis-attributed) — needs a spec before any build.
- **FinOps Phase C / CostClaw paid add-on** — money-gated: RFC §8, ask Wes
  first (constitution §4 adjacent).
- **Claude Desktop plugin** (4th plugin target) — consumer connector needs
  OAuth on /api/mcp.
- **Calibration corpus growth** — standing chore, but a v2 item could target
  the miner's synthetic-traffic filter (item-3 note) and periodic mining runs.

## Standing chores (no status; every session touches them as needed)

- Registry truth: `npm view` the four packages vs manifests when releasing.
- Dependabot: keep at zero open alerts; per-lockfile fixes.
- Corpus: add vectors per MAINTAINER.md protocol as incidents occur.
- Keep `/explain`, README, and docs truthful when any of the above ships.
