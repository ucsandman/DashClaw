#!/usr/bin/env node
/**
 * catastrophe-floor-probe.mjs — Automated regression probe for DashClaw catastrophe floor & calibration.
 *
 * Verifies that:
 * 1. Irreversible destructive actions (delete_data, drop_table, rm_rf, delete_branch, force_push)
 *    at risk >= 85 are held for human approval by the catastrophe floor policy, even if calibrated theta is high.
 * 2. Reversible and sub-threshold actions are not blocked by the floor.
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = Verification failed
 */

process.env.DASHCLAW_ENV_FILE_OVERRIDE = '1';
await import('./_load-env.mjs');

const BASE_URL = (process.env.DASHCLAW_URL || 'https://my-dashclaw.vercel.app').replace(/\/$/, '');
const API_KEY = process.env.DASHCLAW_API_KEY;

if (!API_KEY) {
  console.error('ERROR: No DASHCLAW_API_KEY configured in environment or .env.local');
  process.exit(1);
}

const TEST_CASES = [
  // ── Catastrophe Floor (Must be held for approval) ──
  {
    name: 'Hold irreversible delete_data (risk 90)',
    payload: { action_type: 'delete_data', risk_score: 90, reversible: false, declared_goal: 'Automated probe: delete legacy data' },
    expectDecision: 'require_approval',
    expectFloorTripped: true,
  },
  {
    name: 'Hold irreversible drop_table (risk 95)',
    payload: { action_type: 'drop_table', risk_score: 95, reversible: false, declared_goal: 'Automated probe: drop deprecated table' },
    expectDecision: 'require_approval',
    expectFloorTripped: true,
  },
  {
    name: 'Hold irreversible rm_rf (risk 95)',
    payload: { action_type: 'rm_rf', risk_score: 95, reversible: false, declared_goal: 'Automated probe: purge project folder' },
    expectDecision: 'require_approval',
    expectFloorTripped: true,
  },
  {
    name: 'Hold irreversible delete_branch (risk 85)',
    payload: { action_type: 'delete_branch', risk_score: 85, reversible: false, declared_goal: 'Automated probe: delete production branch' },
    expectDecision: 'require_approval',
    expectFloorTripped: true,
  },
  {
    name: 'Hold irreversible force_push (risk 88)',
    payload: { action_type: 'force_push', risk_score: 88, reversible: false, declared_goal: 'Automated probe: force push branch update' },
    expectDecision: 'require_approval',
    expectFloorTripped: true,
  },

  // ── Negative Controls (Floor must NOT trip) ──
  {
    name: 'Allow reversible delete_data (risk 90, reversible: true)',
    payload: { action_type: 'delete_data', risk_score: 90, reversible: true, declared_goal: 'Automated probe: soft-delete records' },
    expectFloorTripped: false,
  },
  {
    name: 'Allow sub-threshold rm_rf (risk 60, reversible: false)',
    payload: { action_type: 'rm_rf', risk_score: 60, reversible: false, declared_goal: 'Automated probe: clear temporary cache' },
    expectFloorTripped: false,
  },
  {
    name: 'Allow benign read_file (risk 10, reversible: true)',
    payload: { action_type: 'read_file', risk_score: 10, reversible: true, declared_goal: 'Automated probe: read documentation' },
    expectFloorTripped: false,
  },
];

console.log(`\nDashClaw Catastrophe Floor Regression Probe`);
console.log(`Target: ${BASE_URL}`);
console.log(`Time:   ${new Date().toISOString()}\n`);

let passed = 0;
let failed = 0;

for (const test of TEST_CASES) {
  try {
    const res = await fetch(`${BASE_URL}/api/guard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      // Self-test marker (2026-09-09): the probe is DESIGNED to trip policies —
      // without it the held cases count toward the approval flood budget and
      // trip a false-positive flood banner. Excluded from flood counting only;
      // decisions and the ledger are unaffected.
      body: JSON.stringify({ ...test.payload, self_test: true }),
    });

    if (!res.ok) {
      console.log(`FAIL  ${test.name} — HTTP ${res.status}: ${res.statusText}`);
      failed++;
      continue;
    }

    const data = await res.json();
    const floorTripped = data.matched_policies?.some(
      (p) => p.policy_type === 'catastrophe_floor' || p.name?.toLowerCase().includes('catastrophe floor')
    ) || data.reason?.toLowerCase().includes('catastrophe floor');

    let ok = true;
    const errors = [];

    if (test.expectDecision && data.decision !== test.expectDecision) {
      ok = false;
      errors.push(`decision '${data.decision}' !== expected '${test.expectDecision}'`);
    }

    if (test.expectFloorTripped !== undefined && Boolean(floorTripped) !== test.expectFloorTripped) {
      ok = false;
      errors.push(`floorTripped ${Boolean(floorTripped)} !== expected ${test.expectFloorTripped}`);
    }

    if (ok) {
      console.log(`PASS  ${test.name} -> decision=${data.decision}, floor=${floorTripped ? 'TRIPPED' : 'no'}`);
      passed++;
    } else {
      console.log(`FAIL  ${test.name} -> ${errors.join(', ')} (reason: ${data.reason || 'none'})`);
      failed++;
    }
  } catch (err) {
    console.log(`FAIL  ${test.name} — Network error: ${err.message}`);
    failed++;
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed (${TEST_CASES.length} total)\n`);
if (failed > 0) {
  process.exit(1);
}
