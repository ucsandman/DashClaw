#!/usr/bin/env node
/**
 * guard-load.mjs — load & stress harness for the DashClaw guard hot path.
 *
 * `/api/guard` sits in the hot path of every governed action, and this repo has
 * a history of guard latency regressions (apply-base LLM amplifier, the
 * `degraded` deadline, the LLM budget race). Functional + policy-smoke coverage
 * proves correctness; this proves the endpoint holds its latency and degrades
 * gracefully under concurrency — the one defect class those suites can't catch.
 *
 * Scope: docs/plans/2026-07-02-guard-load-harness-scope.md
 *
 * Usage:
 *   node scripts/guard-load.mjs [--url http://localhost:3000]
 *                               [--scenario fast|record|ramp|all]   (default all)
 *                               [--connections 10] [--duration 10]
 *                               [--p99 2000]        (SLO gate, ms)
 *                               [--out results.json]
 *
 * Auth: operator key (x-api-key = DASHCLAW_API_KEY from .env.local) → org_default,
 * admin — the same auth path policy-smoke.mjs uses.
 *
 * IMPORTANT — run against a LOCAL / throwaway DB only. Every guard call writes a
 * guard_decisions audit row and --scenario record also inserts an action_records
 * row, so a load run adds many rows. They're all scoped to a per-run smoke
 * agent id (printed below) so you can identify and delete them. Never point this
 * at the hosted/prod DB (connection limits + cost).
 *
 * NOT covered in v1: LLM slow-path saturation. Reliably firing the predictive
 * LLM amplifier needs an amplifier-enabled policy plus accumulated agent history
 * (guard.ts getPredictiveRisk / min_history); until that setup is pinned, a
 * "slow" scenario here would be theatre. Add it to SCENARIOS once the trigger is
 * confirmed — the harness is shaped for it.
 */

import autocannon from 'autocannon';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- env (mirrors policy-smoke.mjs: .env.local wins so machine-level DASHCLAW_*
// vars that may point at prod never leak into a local load run) ---
const inheritedKey = process.env.DASHCLAW_API_KEY;
for (const k of Object.keys(process.env)) {
  if (k.startsWith('DASHCLAW_')) delete process.env[k];
}
let envFileKey;
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  envFileKey = process.env.DASHCLAW_API_KEY;
} catch {
  console.log('note: no .env.local — using DASHCLAW_API_KEY from the environment (CI mode)');
}
const KEY = envFileKey || inheritedKey;

// --- args ---
function arg(name, fallback) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}
const BASE = arg('url', process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:3000');
const SCENARIO = arg('scenario', 'all');
const CONNECTIONS = Number(arg('connections', '10'));
const DURATION = Number(arg('duration', '10'));
// SLO gate. Calibrated 2026-07-04 (v3.7) against a warmed local production
// build (next start, remote Neon DB, rate limiter lifted): fast p99=444ms,
// record p99=735ms @10 conns; ramp to 50 conns held p99<=501ms with no knee.
// Gate = worst warmed baseline p99 (735ms) x2 headroom, rounded -> 1500ms.
const P99_GATE_MS = Number(arg('p99', '1500'));
const OUT = arg('out', null);
const RAMP_LEVELS = [5, 10, 25, 50];

if (!KEY) {
  console.error('FATAL: DASHCLAW_API_KEY not found in .env.local or the environment');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const AGENT = `loadtest-${RUN}`;
const HEADERS = { 'content-type': 'application/json', 'x-api-key': KEY };

// A benign action that resolves to `allow` — we're measuring the path, not
// tripping a policy. No idempotency_key, so every call fully evaluates (the
// replay short-circuit is deliberately not exercised).
function guardBody() {
  return JSON.stringify({
    action_type: 'loadtest.read',
    declared_goal: `guard load probe ${RUN}`,
    agent_id: AGENT,
  });
}

const SCENARIOS = {
  fast: {
    title: 'Fast path — POST /api/guard (decision + guard_decisions audit write)',
    path: '/api/guard',
  },
  record: {
    title: 'Write path — POST /api/guard?record=true (also inserts action_records + side effects)',
    path: '/api/guard?record=true',
  },
};

// Normalize an autocannon result to the few numbers we gate and print on.
// autocannon's histogram exposes p50/p90/p97_5/p99 — there is no p95, so we
// report p97_5 as the nearest tail percentile rather than invent one.
function summarize(r) {
  const s5xx = r['5xx'] || 0;
  const s4xx = r['4xx'] || 0;
  const s2xx = r['2xx'] || 0;
  const unreachable = (r.requests?.total || 0) === 0 || s2xx === 0;
  const ok = !unreachable && r.errors === 0 && r.timeouts === 0 && s5xx === 0 && (r.latency?.p99 ?? Infinity) <= P99_GATE_MS;
  return {
    ok,
    unreachable,
    rps: Math.round(r.requests?.average || 0),
    total: r.requests?.total || 0,
    p50: r.latency?.p50 ?? null,
    p97_5: r.latency?.p97_5 ?? null,
    p99: r.latency?.p99 ?? null,
    max: r.latency?.max ?? null,
    errors: r.errors || 0,
    timeouts: r.timeouts || 0,
    s2xx, s4xx, s5xx,
  };
}

async function runOnce(scenario, connections, duration) {
  const result = await autocannon({
    url: BASE,
    connections,
    duration,
    headers: HEADERS,
    requests: [{ method: 'POST', path: scenario.path, body: guardBody() }],
  });
  return { raw: result, summary: summarize(result) };
}

function row(label, s) {
  if (s.unreachable) return `  ${label.padEnd(14)} UNREACHABLE (0 successful responses — is the dev server up on ${BASE}?)`;
  const flag = s.ok ? 'PASS' : 'FAIL';
  return `  ${label.padEnd(14)} ${flag}  rps=${String(s.rps).padStart(5)}  p50=${String(s.p50).padStart(5)}ms  p97.5=${String(s.p97_5).padStart(5)}ms  p99=${String(s.p99).padStart(5)}ms  max=${String(s.max).padStart(6)}ms  2xx=${s.s2xx} 4xx=${s.s4xx} 5xx=${s.s5xx} err=${s.errors} to=${s.timeouts}`;
}

async function preflight() {
  // One real call: confirms the server is up and the key authenticates before
  // we hammer it, so a down server / bad key fails clearly instead of as a wall
  // of connection errors.
  let res;
  try {
    res = await fetch(`${BASE}/api/guard`, { method: 'POST', headers: HEADERS, body: guardBody() });
  } catch (err) {
    console.error(`FATAL: cannot reach ${BASE} — is the dev server running? (${err.code || err.message})`);
    process.exit(1);
  }
  if (res.status === 401) {
    console.error('FATAL: 401 — operator key rejected. Is DASHCLAW_API_KEY set in the server env too?');
    process.exit(1);
  }
  if (res.status >= 500) {
    console.error(`FATAL: guard returned ${res.status} on a single call — fix that before load testing.`);
    process.exit(1);
  }
}

async function main() {
  console.log(`guard-load run ${RUN} against ${BASE}`);
  console.log(`agent=${AGENT}  connections=${CONNECTIONS}  duration=${DURATION}s  p99 gate=${P99_GATE_MS}ms`);
  console.log('(guard_decisions rows written this run are scoped to that agent id — clean up the local DB after.)\n');

  await preflight();

  const collected = {};
  let anyFail = false;

  const runScenario = async (key) => {
    const sc = SCENARIOS[key];
    console.log(sc.title);
    const { raw, summary } = await runOnce(sc, CONNECTIONS, DURATION);
    console.log(row('conns=' + CONNECTIONS, summary) + '\n');
    collected[key] = { summary, raw: OUT ? raw : undefined };
    if (!summary.ok) anyFail = true;
  };

  if (SCENARIO === 'fast' || SCENARIO === 'all') await runScenario('fast');
  if (SCENARIO === 'record' || SCENARIO === 'all') await runScenario('record');

  if (SCENARIO === 'ramp' || SCENARIO === 'all') {
    console.log('Stress ramp — fast path at rising concurrency (find the knee: graceful = 4xx/degraded, not 5xx/errors)');
    collected.ramp = [];
    let kneeAt = null;
    for (const c of RAMP_LEVELS) {
      const { raw, summary } = await runOnce(SCENARIOS.fast, c, Math.max(5, Math.round(DURATION / 2)));
      console.log(row('conns=' + c, summary));
      collected.ramp.push({ connections: c, summary, raw: OUT ? raw : undefined });
      // The knee = first level that stops being healthy (5xx/errors/timeouts or
      // p99 past the gate). A 4xx-only breach (e.g. 429) is graceful, not a knee.
      if (kneeAt === null && (summary.s5xx > 0 || summary.errors > 0 || summary.timeouts > 0 || (summary.p99 ?? 0) > P99_GATE_MS)) {
        kneeAt = c;
      }
    }
    console.log(kneeAt ? `\n  knee at ~${kneeAt} connections (first unhealthy level)` : `\n  no knee within ${RAMP_LEVELS[RAMP_LEVELS.length - 1]} connections`);
    // The ramp characterizes; it doesn't gate the exit code — that's the
    // baseline scenarios' job.
    console.log('');
  }

  if (OUT) {
    writeFileSync(resolve(process.cwd(), OUT), JSON.stringify({ run: RUN, base: BASE, gate_p99_ms: P99_GATE_MS, collected }, null, 2));
    console.log(`full results → ${OUT}`);
  }

  if (SCENARIO === 'fast' || SCENARIO === 'record' || SCENARIO === 'all') {
    console.log(anyFail ? 'RESULT: FAIL (a baseline scenario breached the SLO gate or errored)' : 'RESULT: PASS');
    process.exitCode = anyFail ? 1 : 0;
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
