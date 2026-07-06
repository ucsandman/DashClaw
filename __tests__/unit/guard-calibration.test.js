/**
 * Calibrated interruption controller — guard wiring (evaluate.ts).
 *
 * Pins the charter-critical invariants at the integration seam:
 *  - default off: zero extra queries, no calibration output;
 *  - shadow: assessment recorded, decision NEVER changed;
 *  - active: raises allow → require_approval (calibrated threshold or agent
 *    alarm), never downgrades, and a policy block stays absolute;
 *  - operator-approval grants still cover a controller-raised interruption;
 *  - state is cached (30s TTL) and __resetGuardCaches clears it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDeliverGuardWebhook } = vi.hoisted(() => ({ mockDeliverGuardWebhook: vi.fn() }));
vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';

let orgCounter = 0;
const freshOrg = () => `org_cal_${++orgCounter}`;

// Content-routed sql mock: order-independent, returns rows by query text.
function makeSql(routes = {}) {
  const calls = [];
  const respond = (text) => {
    for (const [needle, rows] of Object.entries(routes)) {
      if (text.includes(needle)) return typeof rows === 'function' ? rows() : rows;
    }
    return [];
  };
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    calls.push(text);
    const p = Promise.resolve(respond(text));
    p.catch = (fn) => p.then(undefined, fn);
    return p;
  };
  sql.query = async (text) => {
    calls.push(text);
    return respond(text);
  };
  sql.calls = calls;
  return sql;
}

const calibrationSettings = (mode, rate = '0.1') => [
  { key: 'CALIBRATION_CONTROLLER_MODE', value: mode, category: 'general' },
  { key: 'CALIBRATION_TARGET_RATE', value: rate, category: 'general' },
];

const stateRow = (theta, agents = {}) => [
  { state: { theta, labeledTotal: 10, labeledBenign: 5, labeledDenied: 5, lossSum: 1, agents } },
];

// deploy base score 75 — above a calibrated θ of 30, below the policy default 80.
const CTX = () => ({ action_type: 'deploy', agent_id: 'agent_1', agent_name: 'Bot', declared_goal: 'roll out the widget' });

beforeEach(() => {
  vi.clearAllMocks();
  __resetGuardCaches();
});

describe('calibration controller — guard wiring', () => {
  it('default off: no state query, no calibration in result or context', async () => {
    const sql = makeSql({});
    const result = await evaluateGuard(freshOrg(), CTX(), sql);
    expect(result.decision).toBe('allow');
    expect(result.calibration).toBeUndefined();
    expect(sql.calls.some((t) => t.includes('guard_calibration_state'))).toBe(false);
  });

  it('shadow: records the assessment without changing the decision', async () => {
    const sql = makeSql({
      'FROM settings': calibrationSettings('shadow'),
      'FROM guard_calibration_state': stateRow(30),
    });
    const result = await evaluateGuard(freshOrg(), CTX(), sql);
    expect(result.decision).toBe('allow');
    expect(result.calibration).toMatchObject({
      mode: 'shadow', theta: 30, would_interrupt: true, applied: false,
    });
    expect(result.matched_policies).not.toContain('builtin:calibration_controller');
  });

  it('active: raises allow → require_approval at score ≥ θ, with reason + marker', async () => {
    const sql = makeSql({
      'FROM settings': calibrationSettings('active'),
      'FROM guard_calibration_state': stateRow(30),
    });
    const result = await evaluateGuard(freshOrg(), CTX(), sql);
    expect(result.decision).toBe('require_approval');
    expect(result.calibration).toMatchObject({ mode: 'active', applied: true, would_interrupt: true });
    expect(result.matched_policies).toContain('builtin:calibration_controller');
    expect(result.reason).toMatch(/calibrated threshold/i);
  });

  it('active: below θ and unalarmed, the controller adds nothing', async () => {
    const sql = makeSql({
      'FROM settings': calibrationSettings('active'),
      'FROM guard_calibration_state': stateRow(95),
    });
    const result = await evaluateGuard(freshOrg(), CTX(), sql);
    expect(result.decision).toBe('allow');
    expect(result.calibration).toMatchObject({ applied: false, would_interrupt: false });
  });

  it('active: a standing agent alarm raises even below θ', async () => {
    const sql = makeSql({
      'FROM settings': calibrationSettings('active'),
      'FROM guard_calibration_state': stateRow(95, {
        agent_1: { e: 25, n: 10, denied: 8, alarmed_at: '2026-07-06T00:00:00.000Z' },
      }),
    });
    const result = await evaluateGuard(freshOrg(), CTX(), sql);
    expect(result.decision).toBe('require_approval');
    expect(result.calibration).toMatchObject({ agent_alarmed: true, applied: true });
    expect(result.reason).toMatch(/calibration alarm/i);
  });

  it('active: a policy block is absolute — the controller never overrides or duplicates it', async () => {
    const sql = makeSql({
      'FROM settings': calibrationSettings('active'),
      'FROM guard_calibration_state': stateRow(30),
      'FROM guard_policies': [{
        id: 'gp_block', name: 'Block deploys', policy_type: 'block_action_type',
        rules: JSON.stringify({ action_types: ['deploy'] }),
      }],
    });
    const result = await evaluateGuard(freshOrg(), CTX(), sql);
    expect(result.decision).toBe('block');
    expect(result.matched_policies).not.toContain('builtin:calibration_controller');
    expect(result.calibration).toMatchObject({ applied: false });
  });

  it('a fresh operator approval still covers a controller-raised interruption (grant post-pass)', async () => {
    const sql = makeSql({
      'FROM settings': calibrationSettings('active'),
      'FROM guard_calibration_state': stateRow(30),
      'approval_grant_used_at': [{ action_id: 'ar_1', approved_by: 'wes', act_content_hash: null }],
    });
    const result = await evaluateGuard(freshOrg(), CTX(), sql);
    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toContain('builtin:operator_approval');
  });

  it('shadow assessment rides the persisted decision context as _calibration', async () => {
    // The context JSON is a bound parameter — wrap the mock to capture the
    // audit INSERT's values and assert the sibling is in there.
    const inner = makeSql({
      'FROM settings': calibrationSettings('shadow'),
      'FROM guard_calibration_state': stateRow(30),
    });
    const values = [];
    const wrapped = (strings, ...vals) => {
      const text = String.raw({ raw: strings }, ...Array(vals.length).fill('?'));
      if (text.includes('INSERT INTO guard_decisions')) values.push(...vals);
      return inner(strings, ...vals);
    };
    Object.assign(wrapped, inner);
    wrapped.query = inner.query;
    await evaluateGuard(freshOrg(), CTX(), wrapped);
    const persisted = values.map(String).find((v) => v.includes('_calibration'));
    expect(persisted).toBeTruthy();
    expect(JSON.parse(persisted)._calibration).toMatchObject({ mode: 'shadow', would_interrupt: true, applied: false });
  });

  it('state is cached across evaluations and cleared by __resetGuardCaches', async () => {
    const org = freshOrg();
    const mk = () => makeSql({
      'FROM settings': calibrationSettings('shadow'),
      'FROM guard_calibration_state': stateRow(30),
    });
    const sql1 = mk();
    await evaluateGuard(org, CTX(), sql1);
    expect(sql1.calls.filter((t) => t.includes('guard_calibration_state')).length).toBe(1);
    const sql2 = mk();
    await evaluateGuard(org, CTX(), sql2);
    expect(sql2.calls.filter((t) => t.includes('guard_calibration_state')).length).toBe(0);
    __resetGuardCaches();
    const sql3 = mk();
    await evaluateGuard(org, CTX(), sql3);
    expect(sql3.calls.filter((t) => t.includes('guard_calibration_state')).length).toBe(1);
  });
});
