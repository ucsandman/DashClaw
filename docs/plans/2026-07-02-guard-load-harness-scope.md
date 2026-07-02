# Guard hot-path load & stress harness — scope

**Status:** BUILT (v1) — `scripts/guard-load.mjs`, `npm run guard:load`. Driver
decision (§6) resolved to **autocannon**. v1 ships the `fast`, `record`, and
`ramp` scenarios; the LLM slow-path scenario is the deferred follow-up (see §1
note). SLO gate (`--p99`) defaults to 2000ms and must be **calibrated against a
real warmed local run** before it's trusted or wired anywhere.
**Date:** 2026-07-02
**Why now:** `/api/guard` sits in the hot path of every governed action, and this
repo has a documented history of guard latency regressions (apply-base-60
recruiting a 1.2–3s LLM per edit; the `degraded` column; `_timings`; the
LLM budget race). We have functional and smoke coverage but **zero** load or
stress coverage — the one class of defect (tail latency / graceful degradation
under concurrency) our current suite cannot catch.

Load test ≠ stress test (they're different, per the QA note that prompted this):
- **Load** = expected concurrency, sustained → assert p95/p99 stay within SLO.
- **Stress** = ramp past expected until something breaks → confirm it degrades
  *gracefully* (429 / `degraded` fallback), never with 500s, dropped
  connections, or DB-pool exhaustion.

## 1. What we measure

Target: `POST /api/guard`, the single-call pretool path (`?record=true`), which
is what governed agents actually hit. Two regimes, because they fail differently:

| Regime | Path | What matters |
|--------|------|--------------|
| **Fast** | cached policy + rate-limit, no LLM | p95/p99 latency — this is paid on *every* governed action |
| **Slow** | LLM-in-loop (apply-base, risk escalation) | does `degraded` fallback engage under load, or do requests pile up past the deadline? |

## 2. Scenarios

1. **Baseline load** — N concurrent agents guarding at a steady rate for ~60s.
   Assert p95 < SLO, error rate 0, no `degraded` on the fast path.
2. **Fleet burst** — the runaway/fleet shape (mirrors the rate_limit policy:
   650 actions/60s → `require_approval`). Assert the pause trips *correctly*
   under concurrency, not with 500s.
3. **Slow-path saturation** — force the LLM-in-loop path concurrently. Assert the
   LLM budget race resolves deterministically and `degraded` engages instead of
   requests hanging past the declared deadline.
4. **Stress ramp** — increase concurrency until the knee. Record where it breaks
   and *how* (429/degraded = pass; 500/reset/pool-exhaustion = fail).

## 3. Failure modes to assert against (grounded in known repo behavior)

- **Neon/Postgres connection-pool exhaustion** under concurrency — the serverless
  driver has a hard connection ceiling; the harness must surface pool starvation
  as a distinct failure, not a generic 500.
- **Guard hot-path cache stampede** — the 30s-TTL caches (`__resetGuardCaches`,
  policy cache invalidated on write): confirm a cold cache under concurrent load
  doesn't stampede the DB.
- **LLM budget race** — concurrent requests racing the per-window LLM budget
  (the exact bug fixed in the guard-deadline-noise ship). Assert no double-spend
  of the budget and no unbounded LLM fan-out.
- **x402 spend TOCTOU** — concurrent spend requests against one budget; the
  post-insert re-verify must hold under races.
- **`degraded` correctness** — under slow-path saturation, `degraded` must trip;
  requests must not queue past the declared wait + grace.

## 4. Deliverable shape

- `scripts/guard-load.mjs` — mirrors `scripts/policy-smoke.mjs` conventions:
  operator-key auth, natural JSON request shapes, `process.exitCode` (never
  `process.exit`), runs against the local dev server (`npm run dev`, :3000).
- Config via flags/env: concurrency levels, duration, regime (fast|slow),
  scenario. Sensible defaults so `node scripts/guard-load.mjs` just runs the
  baseline.
- Output: per-scenario table — p50/p95/p99/max latency, throughput,
  error rate, `degraded` rate. **Write full run output to a file; print only the
  summary table** (token/cache discipline — bulky output stays out of context).
- Pass/fail thresholds (SLOs) encoded as constants so the script exits non-zero
  when breached — ready to gate later, but see §5.

## 5. Explicitly NOT in scope (keep it minimal)

- **Not wired into the push/CI gate in v1.** Load tests need a running DB and are
  slow/variable — they'd make the gate flaky. Ship as an on-demand script first;
  decide on a nightly/manual CI job as a separate follow-up once SLOs are stable.
- No Grafana/observability infra, no distributed load generation, no new
  long-running service.
- Governance hot path only — do **not** load-test archived/`_archive` platform
  routes.
- Run against a **local** DB (or a dedicated throwaway Neon branch), never the
  hosted/free-tier prod DB — connection limits and cost make that a foot-gun.

## 6. Load driver — DECIDED: autocannon

Resolved to **A (autocannon)** and built on it. Original options for the record:

- **A. `autocannon`** (recommended) — single Node dev-dependency, purpose-built
  HTTP load tool, gives p50/p95/p99/throughput out of the box, scriptable in the
  existing Node toolchain. Cost: one new devDependency.
- **B. Zero-dep** — hand-rolled concurrency driver reusing the `policy-smoke.mjs`
  fetch+auth harness. No new dependency, but we re-implement latency percentiles
  and ramp logic ourselves (~more code, more room for measurement bugs).

Recommendation: **A**. The one dev-dependency buys correct percentile math and
ramp control that we'd otherwise hand-roll and have to trust. It aligns with
"respect the repo's Node toolchain" and stays free/local. If you'd rather add no
dependency at all, B is viable at the cost of ~80–120 extra lines and DIY stats.

## 7. Effort estimate

~1 script (150–250 lines) + this doc. Roughly half a day once §6 is decided,
including validating the SLO thresholds against a real local run so they reflect
actual current latency rather than guessed numbers.
