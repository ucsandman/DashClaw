#!/usr/bin/env node
/**
 * bench-guard-hotpath.mjs — repeatable latency benchmark for the governed-action
 * hot path, against a RUNNING DashClaw instance.
 *
 * Measures, per scenario, the caller-observed wall time (what an agent hook
 * actually feels) and the server's stage breakdown from the Server-Timing
 * header the guard route emits (replay / eval / record / total). Reports
 * p50/p90/p95/p99 — tail latency is what users feel — plus mean and max.
 *
 * Scenarios:
 *   health              GET /api/health — HTTP + middleware floor, no auth DB
 *   guard_simple_allow  POST /api/guard — plain allow, no idempotency, no record
 *   guard_record        POST /api/guard?record=true + unique idempotency key
 *                       (the exact single call the pretool hook makes)
 *   guard_replay        POST /api/guard?record=true reusing one idempotency key
 *   guard_approval      POST /api/guard?record=true under a risk_threshold
 *                       require_approval policy (self-created, agent-scoped,
 *                       deleted afterward — mirrors policy-smoke isolation)
 *   record_only         POST /api/actions — the standalone record write
 *
 * Usage (PowerShell):
 *   node scripts/bench-guard-hotpath.mjs http://localhost:3001 --n 50
 *   $env:DASHCLAW_API_KEY = "<operator key of the target instance>"
 *   node scripts/bench-guard-hotpath.mjs http://localhost:3001 --n 100 --json out.json
 *   node scripts/bench-guard-hotpath.mjs http://localhost:3001 --assert guard_record:p95:250
 *
 * --assert scenario:stat:ms may repeat; any violation exits 1, so CI or a
 * pre-ship check catches a hot-path regression instead of a user.
 *
 * Isolation: all traffic uses run-unique bench agents + action types; the one
 * policy created is scoped via agent_ids to this run's agent and deleted at
 * the end. Safe to run against a shared instance, but expect the bench rows
 * in guard_decisions/action_records (they are real governed-action records).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// --- args ---
const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) || 'http://localhost:3000').replace(/\/$/, '');
function argValue(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const N = parseInt(argValue('--n', '50'), 10);
const WARMUP = parseInt(argValue('--warmup', '5'), 10);
const JSON_OUT = argValue('--json', null);
const ONLY = argValue('--scenario', null);
const ASSERTS = args
  .map((a, i) => (a === '--assert' ? args[i + 1] : null))
  .filter(Boolean)
  .map((spec) => {
    const [scenario, stat, ms] = String(spec).split(':');
    return { scenario, stat, ms: Number(ms) };
  });

// --- key resolution: --key > env > .env.local ---
let KEY = argValue('--key', process.env.DASHCLAW_API_KEY || null);
if (!KEY) {
  try {
    const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const m = envFile.match(/^DASHCLAW_API_KEY=["']?([^"'\r\n]+)/m);
    if (m) KEY = m[1];
  } catch { /* no .env.local — fine if --key/env provided */ }
}
if (!KEY) {
  console.error('No API key: pass --key, set DASHCLAW_API_KEY, or run from a repo with .env.local');
  process.exit(1);
}

const RUN = `bench_${Date.now().toString(36)}`;
const AGENT = `bench-agent-${RUN}`;

// --- http ---
async function call(method, path, body) {
  const start = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  const clientMs = performance.now() - start;
  const serverTiming = parseServerTiming(res.headers.get('server-timing'));
  return { status: res.status, json, clientMs, serverTiming };
}

function parseServerTiming(header) {
  if (!header) return null;
  const out = {};
  for (const part of header.split(',')) {
    const m = part.trim().match(/^([\w-]+);dur=([\d.]+)/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return Object.keys(out).length ? out : null;
}

// --- stats ---
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
  return {
    n: sorted.length,
    mean: Math.round(mean * 10) / 10,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
  };
}
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

// --- scenario runner ---
async function runScenario(name, makeRequest, { expect } = {}) {
  for (let i = 0; i < WARMUP; i++) await makeRequest(`warm${i}`);
  const client = [];
  const stages = {}; // stage -> number[]
  let failures = 0;
  let sampleDecision = null;
  for (let i = 0; i < N; i++) {
    const r = await makeRequest(`i${i}`);
    if (r.status >= 400) { failures++; continue; }
    if (expect && r.json?.decision && r.json.decision !== expect) failures++;
    if (typeof r.json?.decision === 'string') sampleDecision = r.json.decision;
    client.push(r.clientMs);
    if (r.serverTiming) {
      for (const [k, v] of Object.entries(r.serverTiming)) (stages[k] ??= []).push(v);
    }
  }
  const summary = {
    scenario: name,
    decision: sampleDecision,
    failures,
    client: summarize(client),
    stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, summarize(v)])),
  };
  // Derived: client-observed minus server total = network + platform overhead.
  if (stages.total) {
    const overhead = client.map((c, i) => c - (stages.total[i] ?? 0)).filter((v) => Number.isFinite(v));
    if (overhead.length === client.length) summary.stages.network_platform = summarize(overhead);
  }
  return summary;
}

function guardBody(i, extra = {}) {
  return {
    action_type: 'test',
    agent_id: AGENT,
    agent_name: 'bench harness',
    declared_goal: `benchmark probe ${RUN} ${i}`,
    ...extra,
  };
}

const createdPolicyIds = [];
async function createPolicy(name, policy_type, rules, agentIds) {
  const { status, json } = await call('POST', '/api/policies', {
    name: `bench:${name}:${RUN}`, policy_type, rules, active: true, agent_ids: agentIds,
  });
  if (status !== 200 && status !== 201) throw new Error(`policy create failed: ${status} ${JSON.stringify(json)}`);
  const id = json?.policy?.id || json?.id;
  createdPolicyIds.push(id);
  return id;
}

async function main() {
  console.log(`bench-guard-hotpath ${RUN} against ${BASE} — n=${N}, warmup=${WARMUP}\n`);

  // Sanity — a degraded instance (e.g. no realtime backend) answers 503 on
  // /api/health but still serves the governance hot path; only an unreachable
  // host is fatal.
  const ping = await call('GET', '/api/health').catch((err) => {
    console.error(`FATAL: cannot reach ${BASE}/api/health — ${err.message}`);
    process.exit(1);
  });
  if (ping.status >= 500 && ping.status !== 503) { console.error(`FATAL: /api/health → ${ping.status}`); process.exit(1); }
  const auth = await call('POST', '/api/guard', guardBody('auth-probe'));
  if (auth.status === 401 || auth.status === 403) { console.error(`FATAL: guard auth ${auth.status} — wrong key for this instance?`); process.exit(1); }
  if (auth.status >= 500) { console.error(`FATAL: guard ${auth.status}: ${JSON.stringify(auth.json)}`); process.exit(1); }

  const results = [];
  const want = (name) => !ONLY || ONLY === name;

  if (want('health')) {
    // Floor scenario: middleware + routing + handler cost. A degraded 503
    // exercises the identical path, so don't count it as a failure.
    results.push(await runScenario('health', async () => {
      const r = await call('GET', '/api/health');
      return { ...r, status: r.status === 503 ? 200 : r.status };
    }));
  }

  if (want('guard_simple_allow')) {
    results.push(await runScenario('guard_simple_allow', (i) =>
      call('POST', '/api/guard', guardBody(i)), { expect: 'allow' }));
  }

  if (want('guard_record')) {
    results.push(await runScenario('guard_record', (i) =>
      call('POST', '/api/guard?record=true', guardBody(i, { idempotency_key: `${RUN}_rec_${i}` })), { expect: 'allow' }));
  }

  if (want('guard_replay')) {
    const key = `${RUN}_replay_once`;
    await call('POST', '/api/guard?record=true', guardBody('prime', { idempotency_key: key }));
    results.push(await runScenario('guard_replay', () =>
      call('POST', '/api/guard?record=true', guardBody('prime', { idempotency_key: key }))));
  }

  if (want('guard_approval')) {
    const approvalAgent = `${AGENT}-approval`;
    await createPolicy('risk-approval', 'risk_threshold', { threshold: 60, action: 'require_approval' }, [approvalAgent]);
    results.push(await runScenario('guard_approval', (i) =>
      call('POST', '/api/guard?record=true', {
        ...guardBody(i, { idempotency_key: `${RUN}_appr_${i}`, risk_score: 75 }),
        agent_id: approvalAgent,
      }), { expect: 'require_approval' }));
  }

  if (want('record_only')) {
    results.push(await runScenario('record_only', (i) =>
      call('POST', '/api/actions', {
        agent_id: AGENT,
        agent_name: 'bench harness',
        action_type: 'test',
        declared_goal: `benchmark record ${RUN} ${i}`,
        idempotency_key: `${RUN}_act_${i}`,
      })));
  }

  // Teardown: deactivate + delete bench policies (guard may serve them from
  // its 30s cache briefly after — harmless, they are scoped to bench agents).
  for (const pid of createdPolicyIds) {
    await call('PATCH', '/api/policies', { id: pid, active: false }).catch(() => {});
    await call('DELETE', `/api/policies?id=${encodeURIComponent(pid)}`).catch(() => {});
  }

  // --- report ---
  for (const r of results) {
    console.log(`\n=== ${r.scenario} ${r.decision ? `(decision: ${r.decision})` : ''} ${r.failures ? `FAILURES: ${r.failures}` : ''}`);
    const row = (label, s) => {
      if (!s || s.n === 0) return;
      console.log(
        `  ${label.padEnd(18)} p50=${String(round1(s.p50)).padStart(7)}  p90=${String(round1(s.p90)).padStart(7)}  p95=${String(round1(s.p95)).padStart(7)}  p99=${String(round1(s.p99)).padStart(7)}  mean=${String(s.mean).padStart(7)}  max=${String(round1(s.max)).padStart(7)}  (ms, n=${s.n})`
      );
    };
    row('client total', r.client);
    for (const [stage, s] of Object.entries(r.stages)) row(`  ${stage}`, s);
  }

  if (JSON_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(JSON_OUT, JSON.stringify({ run: RUN, base: BASE, n: N, results }, null, 2));
    console.log(`\nJSON written to ${JSON_OUT}`);
  }

  // --- assertions (regression gate) ---
  let failed = 0;
  for (const { scenario, stat, ms } of ASSERTS) {
    const r = results.find((x) => x.scenario === scenario);
    const actual = r?.client?.[stat];
    const ok = actual != null && actual <= ms;
    console.log(`${ok ? 'PASS' : 'FAIL'} assert ${scenario} client ${stat} ${round1(actual)}ms <= ${ms}ms`);
    if (!ok) failed++;
  }
  const anyScenarioFailures = results.some((r) => r.failures > 0);
  if (anyScenarioFailures) console.error('\nWARNING: some scenario requests failed or returned unexpected decisions.');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
