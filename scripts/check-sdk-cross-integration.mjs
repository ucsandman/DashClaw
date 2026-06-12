#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashClaw } from '../sdk/dashclaw.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const fixturePath = path.join(rootDir, 'docs', 'sdk-critical-contract-harness.json');

function deepOmitUndefined(value) {
  if (Array.isArray(value)) return value.map(deepOmitUndefined);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (k === '_signature' && v === null) continue;
    out[k] = deepOmitUndefined(v);
  }
  return out;
}

function normalizeVolatileFields(body) {
  if (!body || typeof body !== 'object') return body;
  const out = { ...body };
  // Mask values that legitimately vary run-to-run so the contract pins the
  // shape, not the volatile value: timestamps and the auto-derived
  // idempotency key (its hash rotates with createAction's hour bucket).
  if (typeof out.timestamp_end === 'string') out.timestamp_end = '<timestamp>';
  if (typeof out.idempotency_key === 'string') out.idempotency_key = '<idempotency_key>';
  return out;
}

function normalizeCall(call) {
  const parsed = new URL(call.path, 'https://example.test');
  const query = Array.from(parsed.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
  const body = normalizeVolatileFields(deepOmitUndefined(call.body));
  return {
    method: String(call.method || '').toUpperCase(),
    pathname: parsed.pathname,
    query,
    body: body ?? null,
  };
}

async function captureNodeCalls() {
  const client = new DashClaw({
    baseUrl: 'https://example.test',
    apiKey: ['test', 'key'].join('-'),
    agentId: 'agent-1',
  });

  // SSE uses fetch() directly — stub it out so waitForApproval falls through
  // to polling immediately rather than waiting for a real network connection.
  client._connectSSE = async function* () { /* no-op in test context */ };

  const calls = [];
  client._request = async (pathName, method, body, params) => {
    let finalPath = pathName;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) finalPath += `?${qs}`;
    }
    calls.push({ path: finalPath, method, body });
    // Mock response for waitForApproval
    if (pathName.startsWith('/api/actions/')) {
        return { action: { status: 'running', approved_by: 'operator' } };
    }
    return { ok: true };
  };

  const results = [];
  const capture = async (id, fn) => {
    const before = calls.length;
    await fn();
    if (calls.length <= before) {
      throw new Error(`No call captured for case: ${id}`);
    }
    results.push({ id, call: normalizeCall(calls.at(-1)) });
  };

  await capture('guard', () => client.guard({
    action_type: 'deploy',
    risk_score: 55,
  }));
  await capture('create_action', () => client.createAction({
    action_type: 'deploy',
    declared_goal: 'Ship release',
  }));
  await capture('update_outcome', () => client.updateOutcome('act_1', {
    status: 'completed',
    output_summary: 'done',
  }));
  await capture('record_assumption', () => client.recordAssumption({
    action_id: 'act_1',
    assumption: 'Database is reachable',
  }));
  await capture('wait_for_approval', () => client.waitForApproval('act_1', { timeout: 100, interval: 10 }));

  return results;
}

async function main() {
  const expectedRaw = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const expected = new Map(expectedRaw.map((entry) => [entry.id, entry.call]));
  const actual = await captureNodeCalls();

  const seen = new Set();
  for (const entry of actual) {
    seen.add(entry.id);
    const fixture = expected.get(entry.id);
    if (!fixture) {
      throw new Error(`Unexpected integration case from Node harness: ${entry.id}`);
    }
    if (JSON.stringify(fixture) !== JSON.stringify(entry.call)) {
      throw new Error(`Node contract mismatch for case "${entry.id}"\nExpected: ${JSON.stringify(fixture)}\nActual:   ${JSON.stringify(entry.call)}`);
    }
  }

  for (const id of expected.keys()) {
    if (!seen.has(id)) {
      throw new Error(`Missing Node integration case: ${id}`);
    }
  }

  console.log(`Node SDK critical contract harness passed (${actual.length} cases).`);
}

main().catch((err) => {
  console.error(`Node SDK integration harness failed: ${err.message}`);
  process.exit(1);
});
