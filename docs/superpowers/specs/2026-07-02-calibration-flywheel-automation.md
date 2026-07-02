# Calibration flywheel automation (roadmap v2.6)

**Date:** 2026-07-02 · **Status:** approved for build · **Roadmap:** v2.6

The calibration corpus (risk-calibration golden vectors) grows only when a
session-holder remembers the MAINTAINER.md protocol. v2.6 automates the
*proposal* half of the flywheel while keeping ratification human
(constitution §3 — the corpus is enforcement):

1. A **synthetic-traffic filter** so the miner stops offering
   policy-smoke/self-test traffic as candidate vectors.
2. **Periodic mining runs** (scheduled GitHub Actions) that PROPOSE vectors
   with provenance; a human ratifies them into the corpus via the existing
   forge (`npm run calibration:add`).

Everything builds on the item-3 miner
(`scripts/mine-calibration-candidates.mjs` + pure logic in
`scripts/lib/calibration-mining.mjs`); no LLM anywhere (item-1/item-3 rule).

## 1. Synthetic-traffic filter

### Why

The owner instance's ledger is polluted by the platform's own verification
traffic: `scripts/policy-smoke.mjs` (76 checks, run per-ship and in CI),
`up-smoke.yml`, `sdk-live.yml`, `scripts/verify-demo-e2e.mjs`, and the
`scripts/test-*.mjs` dev suites. That traffic is *designed* to trip policies
(inflated `risk_score: 95`, deliberate blocks and denials), so it dominates
the R1/R2 candidate lists with shapes no real agent ever produces. A vector
mined from it would calibrate the scorer against a fiction.

### Design

Pure function in `scripts/lib/calibration-mining.mjs` (unit-testable, no
I/O):

```js
isSyntheticEvent(event) -> boolean
```

An event is synthetic when ANY of:

- `agent_id` matches a known synthetic family (explicit, documented list):
  - `smoke-*` — policy-smoke run agents (`smoke-{tag}-{run36}`)
  - `ci-smoke` — up-smoke.yml 3-OS install smoke
  - `sdk-live-test-agent*` — sdk-live.yml live SDK suite
  - `demo-e2e-verifier` — verify-demo-e2e.mjs
  - `test`, `test-*` — scripts/test-full-api.mjs, test-actions.mjs and
    friends (dev-suite agents; on the owner instance no real agent uses
    this family)
- `action_type` starts with `smoke.` (policy-smoke's run-unique types).

The event shape gains `agent_id` (both loaders already have it server-side:
`guard_decisions.agent_id`, `behavior_samples.agent_id`, local JSONL
samples carry it too).

**Applied by default** in the miner, before rule evaluation. Escape hatch:
`--include-synthetic` (for debugging the filter itself). The report and
stdout state how many events were excluded (`inputs.synthetic_excluded`) —
no silent drops.

Non-goal: filtering by declared-goal text. The agent-id families plus the
`smoke.` action-type prefix cover every generator in the repo; goal-text
matching would risk false positives on real traffic.

## 2. Proposal mode (`--propose`)

### Design

`buildProposals(candidates, { windowDays, generatedAt })` — pure, in the
mining lib. For each candidate it emits a ready-to-ratify proposal:

- `candidate` — the mined candidate (id, rule, tier, count, risk range,
  representative, event ids).
- `provenance` — the `--source` string the forge should receive, e.g.
  `mined 2026-07-02 (window 30d): over_scored_benign cv_ab12..., 14 events, tier human_approved`.
- `suggested_name` — kebab-case derived from the representative shape
  (human may rename).
- `ratify_command` — the exact forge invocation:
  - representative is a decision with a linked action →
    `npm run calibration:add -- --action <action_id> --label <label> --name <n> --source "<provenance>"`
  - representative's goal is `Bash: <cmd>` or it has a raw command →
    `--command "<cmd>"` form.
  - otherwise the proposal carries `ratify_command: null` and a
    `needs_manual_context: true` flag (redacted `command_shape` alone can't
    reconstruct a runnable command — the human supplies it).

The miner gains `ar.action_id` in the decision SELECT so decision-origin
representatives can use the `--action` path.

**Top-N cap (added after the first live run):** a real 30-day window
produced 5,828 raw candidates — not a reviewable batch, and a markdown
table that size would exceed the Actions step-summary limit. Proposals cap
at the **top 15 per rule** (candidates already arrive sorted
strongest-count-first); `--top N` overrides, `--top 0` lifts the cap. The
truncation is reported, never silent: the artifact's full `candidates`
arrays stay complete, and the summary header for a truncated rule reads
"top 15 of N candidates".

Proposal *scores/bounds are NOT computed here* — the forge runs both
scorers at ratification time (that's the protocol; propose mode must not
need Python or the app build, so it stays runnable in a bare CI job).

### Outputs

- `--out <path>` (existing flag) — the JSON artifact now includes a
  `proposals` array when `--propose` is set.
- `--summary <path>` — GitHub-flavored markdown rendering (per-rule tables:
  candidate id, count, tier, risk range, shape, ratify command), written
  for `$GITHUB_STEP_SUMMARY`. Includes the input counts and the synthetic
  exclusion line so a reviewer sees coverage honestly.

Duplicate-vs-corpus detection is out of scope: shape→existing-vector
matching is fuzzy; the human reviewing the proposal is the dedupe step.

## 3. Scheduled runs — `.github/workflows/calibration-mine.yml`

- `schedule: '0 6 * * 1'` (weekly, Monday 06:00 UTC) + `workflow_dispatch`
  (with an optional `days` input, default 30).
- Steps: checkout → setup-node → `npm ci` → run
  `npm run calibration:mine -- --days 30 --propose --out calibration-proposals.json --summary calibration-summary.md`
  with `DATABASE_URL: ${{ secrets.DATABASE_URL }}` (same secret CI's build
  job already uses) → append the summary to `$GITHUB_STEP_SUMMARY` → upload
  the JSON as a workflow artifact.
- Fork-safe: when the secret is unset, log and exit 0 (matches
  outcome-sweep.yml's guard pattern).
- The hosted run sees decisions + uploaded samples only (local JSONL lives
  on the owner machine); the artifact's `inputs` block reports
  `local_samples: 0` so that limit is visible, not hidden.

## Human surface (visibility gate — explicit decision)

This is **maintainer tooling, not a product feature**: the human surface is
the GitHub Actions run summary (rendered proposal tables) plus the
downloadable JSON artifact, reached from the repo's Actions tab —
where the maintainer already reviews the other scheduled jobs
(outcome-sweep, jti-sweep, integration-health). No DashClaw UI surface is
built, deliberately: proposals ratify into a **repo fixture** via a local
CLI + commit, so a web surface could only display, never ratify, and would
duplicate the Actions summary. (Same class of decision as item 3's
CLI-only miner.)

## Acceptance

1. `isSyntheticEvent` and `buildProposals` pinned by two-sided unit tests
   (each family fires; realistic non-synthetic events stay).
2. Local live proof: `npm run calibration:mine` run against real local data
   shows a nonzero `synthetic_excluded` and cleaner candidate lists;
   `--propose --summary` produces the artifact + markdown.
3. Scheduled-run live proof: after push, `workflow_dispatch` the workflow
   and verify the run summary renders proposals and the artifact uploads
   (this is the acceptance's "scheduled run produces a proposal artifact
   from live data").
4. Corpus count recorded in the maintainer log at ship.
