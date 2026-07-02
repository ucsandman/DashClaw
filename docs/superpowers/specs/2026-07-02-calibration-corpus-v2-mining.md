# Calibration corpus v2: mining — spec (owner roadmap item 3)

Date: 2026-07-02 · Target: v4.24.0 · Charter protocol: spec → build → gates →
live proof → main.

## Problem

The golden-vector corpus (22 vectors as of v4.23.0) only grows when a wrong
interruption happens to be noticed by a human. Meanwhile the system already
holds the evidence of miscalibration at scale: ~24.5k recorded behavior
samples, the guard-decision ledger with per-decision `_risk_breakdown`
provenance, and the approvals ledger (item 1's `guard_decision_id` join).
Nobody is mining it. Item 3 turns the corpus from incident-driven into
evidence-driven.

Also inherited open case (v1, overlaps item 5): why did the `git show`
incident persist `risk_score: 100` when the server heuristic term was 30?

## Deliverables

### D1 — `scripts/mine-calibration-candidates.mjs` (read-only miner)

Runs via `node --import tsx` (npm script `calibration:mine`). Read-only:
issues only SELECTs; never writes to the DB or the fixture.

Sources (all already have readers — reuse, don't reimplement):

- Local behavior samples: `app/lib/behavior/sample-store.ts` `readSamples`
  (richer; real shapes). Cap is `MAX_SAMPLES = 20000` — when the cap
  truncates, the report says so (no silent truncation).
- Uploaded samples: `behavior_samples` table via
  `app/lib/repositories/behavior.repository.ts`.
- Decisions + approvals: `guard_decisions` joined to `action_records` on
  `guard_decision_id` (predicates documented in
  `app/lib/repositories/policy-tuning.repository.ts:68-73` — approved =
  `approved_by IS NOT NULL`, denied = reasoning marker, pending = status).

Candidate rules (pure functions, unit-tested, in
`scripts/lib/calibration-mining.mjs`):

- **R1 over-scored benign**: benign evidence AND final `risk_score >=
  RISK_MEDIUM_MIN` (40, imported from `app/lib/riskThresholds.ts`, never
  hardcoded). Benign evidence tiers, strongest first: human approved the
  interruption; completed with success outcome and no violation; classifier
  intent `readonly`.
- **R2 under-scored danger**: dangerous evidence AND `risk_score <
  RISK_MEDIUM_MIN`. Dangerous evidence: denied approval; blocked decision;
  classifier intent `destructive`.
- **R3 repeated identical approvals**: approvals grouped by shape key
  (`command_shape` when present, else `action_type` + normalized
  `declared_goal`), `count >= 3` → benign candidates ("the human keeps
  saying yes to this exact shape").

Every candidate carries: the evidence rows (ids, capped at 10 per candidate),
the decision's `_risk_breakdown` when available (so the fix targets the right
layer — server heuristic vs template vs client vs predictive), a
deterministic id `cv_<sha256-16>` over the shape key (idempotent across
runs; pattern from `app/lib/policy-tuning/engine.ts` fingerprints), and a
ready-to-review suggested vector entry.

Output: human summary to stdout + full JSON report via `--out <file>`
(default `docs/plans/calibration-mining-report.json` is NOT written unless
`--out` is passed; stdout only by default).

### D2 — `scripts/add-calibration-vector.mjs` (vector forge)

npm script `calibration:add`. Two input modes:

- `--command "<raw shell>"`: runs BOTH scorers — client `classify_bash`
  (spawn Python, interpreter discovery + `PYTHONPATH=hooks` reused from
  `scripts/run-python-unittest.mjs`) and server `computeRiskScore`
  (tsx import from `app/lib/guard.js`) on a server context built the same
  way the pretool hook builds it (intent → action_type mapping mirrored
  from the hook, cited in-code).
- `--action <action_id>`: loads the action record + its guard decision,
  rebuilds the server context from what was actually declared, runs the
  scorers, and stamps provenance (`action_id`, date, decision id).

Required: `--label benign|risky`, `--name`, `--source "<provenance>"`.

Bound suggestion policy (the honest part):

- Score consistent with the label (benign < 40 / risky >= 40): suggest the
  observed score rounded up (benign) or down (risky) to the nearest 5 with
  5 points of headroom — same margins the existing 22 vectors use.
- Score CONTRADICTS the label (benign >= 40, or risky < 40): suggest the
  band-edge bound (benign `max_risk: 39`, risky `min_risk: 40`) and print
  `REQUIRES MODEL FIX` — appending this vector makes the golden suite red
  until the scorer is fixed in the same commit. That is the charter's
  workflow, mechanized.

Default prints the entry; `--write` appends to
`__tests__/fixtures/risk-calibration-golden-vectors.json` (stable key order,
2-space indent, trailing newline — byte-format matches the existing file).
Duplicate `name` → refuse.

### D3 — Vectors from a real mining run + scorer fixes

Run D1 against the live local data. Triage the report: pick the clear
candidates (target: enough to meaningfully grow the corpus, quality over
quantity), add them via D2 with provenance, and fix what they prove wrong —
per charter, model fix and pinning vector land in the same commit. If the
miner surfaces nothing actionable, that finding is reported honestly (the
corpus stays at 22 and the tooling still ships).

### D4 — Close the `git show` 30→100 case

Query the ledger for the incident decision and decompose its persisted
`context._risk_breakdown` (`base / modifiers / server_total / template /
client_reported / effective / predictive / final`). Composition code:
`computeRiskAssessment` (`app/lib/guard.ts` — `effective =
max(server_total, template.score, client_reported)`, then predictive
adjustment → final). Expected culprit: an org risk-template or the
client-reported score folded in by `max()`, then predictive on top.
Document the actual decomposition in the maintainer log. Whatever `_risk_breakdown`
cannot explain from the outside is written up as the concrete gap list for
item 5 (observability), not silently absorbed here.

## Non-goals

- No new API routes, no UI. (Surfacing mined candidates in /policies is
  item-1-adjacent future work; item 5 owns the observability surface.)
- No auto-append of mined vectors: the miner proposes, the maintainer
  reviews each vector into the fixture (constitution §3 spirit).
- No LLM anywhere in the pipeline (matches item 1's rule-based precedent).

## Acceptance

1. Unit tests for the R1/R2/R3 rules and bound-suggestion logic (synthetic
   rows; two-sided: each rule has a fires-case and a stays-quiet-case).
2. `npm run calibration:mine` completes read-only against live local data;
   live proof = the real run's counts in the maintainer log.
3. `npm run calibration:add -- --command "git show --stat HEAD"` (dry run)
   emits a valid two-layer vector; `--write` output keeps both golden
   runners' fixture parsing green.
4. Mined vectors + any scorer fixes land together; both golden runners
   (JS `risk-calibration-golden.test.js`, Python
   `test_risk_calibration_golden.py`) green.
5. `git show` case: decomposition documented in the maintainer log; item-5
   gap list updated in the roadmap if the breakdown is insufficient.
6. Gates: lint, FULL vitest, `npm run typecheck` if any `.ts` touched,
   `next build` if `app/**` touched, contract checks. Docs contract: new
   scripts documented (spec + `package.json`), no drifting counts
   introduced (fixture vector count is cited nowhere outside the fixture —
   keep it that way).
