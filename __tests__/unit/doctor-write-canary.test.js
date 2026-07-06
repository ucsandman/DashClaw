// __tests__/unit/doctor-write-canary.test.js
//
// The write-path canary exists because two subsystems died silently behind
// best-effort catches this era (the fresh-install presence heartbeat being
// the canonical case). A staleness check cannot tell "no traffic yet" from
// "write path broken" on a fresh install — only an actual write can. These
// tests pin the contract: a write path that errors is a FAIL (with the
// migrate fix attached), never a benign warn.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSetupStatus,
  mockGetSql,
  mockUpsertAgentPresence,
  mockCreateActionRecord,
  mockPersistGuardDecision,
  mockEvaluateGuard,
  mockInvalidateGuardPolicyCache,
} = vi.hoisted(() => ({
  mockGetSetupStatus: vi.fn(),
  mockGetSql: vi.fn(),
  mockUpsertAgentPresence: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockPersistGuardDecision: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockInvalidateGuardPolicyCache: vi.fn(),
}));

vi.mock('@/lib/setupStatus.mjs', () => ({ getSetupStatus: mockGetSetupStatus }));
vi.mock('@/lib/db', () => ({ getSql: mockGetSql }));
vi.mock('@/lib/repositories/agents.repository', () => ({
  upsertAgentPresence: mockUpsertAgentPresence,
}));
vi.mock('@/lib/repositories/actions.repository', () => ({
  createActionRecord: mockCreateActionRecord,
}));
vi.mock('@/lib/guard', () => ({
  persistGuardDecision: mockPersistGuardDecision,
  evaluateGuard: mockEvaluateGuard,
  invalidateGuardPolicyCache: mockInvalidateGuardPolicyCache,
}));

import { runChecks, CANARY_ORG_ID } from '@/lib/doctor/checks/write-canary.mjs';

/**
 * Tagged-template sql mock. Routes each query by its joined text through
 * `handler(text, values)`; default behavior returns [] except the
 * guard_decisions verify SELECT, which returns the inserted row.
 */
function makeSqlMock(handler = null) {
  const calls = [];
  const sql = (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join('$?') : String(strings);
    calls.push({ text, values });
    if (handler) {
      const result = handler(text, values);
      if (result !== undefined) return Promise.resolve(result);
    }
    if (/SELECT id FROM guard_decisions/i.test(text)) {
      return Promise.resolve([{ id: values[0] }]);
    }
    return Promise.resolve([]);
  };
  sql.calls = calls;
  return sql;
}

function healthyMocks(sql) {
  mockGetSetupStatus.mockResolvedValue({ configured: true });
  mockGetSql.mockReturnValue(sql);
  mockUpsertAgentPresence.mockResolvedValue([{ org_id: CANARY_ORG_ID, agent_id: 'doctor_write_canary' }]);
  mockCreateActionRecord.mockResolvedValue({ action_id: 'act_doctor_canary_x' });
  mockPersistGuardDecision.mockResolvedValue(undefined);
  mockEvaluateGuard.mockResolvedValue({ decision: 'block', decision_id: 'act_gd_canary' });
}

beforeEach(() => vi.clearAllMocks());

describe('doctor/checks/write-canary', () => {
  it('returns no checks when the DB is not configured', async () => {
    mockGetSetupStatus.mockResolvedValue({ configured: false });

    const checks = await runChecks({ env: {} });

    expect(checks).toEqual([]);
    expect(mockUpsertAgentPresence).not.toHaveBeenCalled();
  });

  it('passes all four canaries when every write path lands', async () => {
    const sql = makeSqlMock();
    healthyMocks(sql);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    expect(checks.map((c) => c.id)).toEqual([
      'canary_organizations',
      'canary_agent_presence',
      'canary_action_records',
      'canary_guard_decisions',
      'canary_guard_enforcement',
    ]);
    expect(checks.every((c) => c.category === 'write-canary')).toBe(true);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);

    // The canaries exercised the REAL repository writers, scoped to the canary org.
    expect(mockUpsertAgentPresence).toHaveBeenCalledWith(
      sql,
      CANARY_ORG_ID,
      expect.objectContaining({ agent_id: 'doctor_write_canary', status: 'online' }),
    );
    expect(mockCreateActionRecord).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ orgId: CANARY_ORG_ID, actionStatus: 'completed' }),
    );
    expect(mockPersistGuardDecision).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ orgId: CANARY_ORG_ID, decision: 'allow', degraded: false }),
    );

    // Canary rows are cleaned up by exact id after the verify.
    const deletes = sql.calls.filter((c) => /DELETE FROM/i.test(c.text));
    expect(deletes.some((c) => /agent_presence/i.test(c.text))).toBe(true);
    expect(deletes.some((c) => /action_records/i.test(c.text))).toBe(true);
    expect(deletes.some((c) => /guard_decisions/i.test(c.text))).toBe(true);
  });

  it('FAILS (not warns) the presence canary when the heartbeat write path is dead — the replayed fresh-install bug', async () => {
    const sql = makeSqlMock();
    healthyMocks(sql);
    mockUpsertAgentPresence.mockRejectedValue(
      new Error('column "updated_at" of relation "agent_presence" does not exist'),
    );

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    const presence = checks.find((c) => c.id === 'canary_agent_presence');
    expect(presence.status).toBe('fail');
    expect(presence.message).toContain('does not exist');
    expect(presence.fix).toMatchObject({ type: 'auto', action: 'migrate' });

    // One dead path does not hide the others' verdicts.
    expect(checks.find((c) => c.id === 'canary_action_records').status).toBe('pass');
    expect(checks.find((c) => c.id === 'canary_guard_decisions').status).toBe('pass');
  });

  it('fails the action-ledger canary when the write returns no row', async () => {
    const sql = makeSqlMock();
    healthyMocks(sql);
    mockCreateActionRecord.mockResolvedValue(null);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    const actions = checks.find((c) => c.id === 'canary_action_records');
    expect(actions.status).toBe('fail');
    expect(actions.fix).toMatchObject({ action: 'migrate' });
  });

  it('fails the guard-audit canary when the inserted row is not readable back', async () => {
    const sql = makeSqlMock((text) => {
      if (/SELECT id FROM guard_decisions/i.test(text)) return [];
    });
    healthyMocks(sql);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    const guard = checks.find((c) => c.id === 'canary_guard_decisions');
    expect(guard.status).toBe('fail');
    expect(guard.message).toMatch(/not readable/i);
  });

  it('stops after the org bootstrap fails instead of cascading FK noise', async () => {
    const sql = makeSqlMock((text) => {
      if (/INSERT INTO organizations/i.test(text)) throw new Error('relation "organizations" does not exist');
    });
    healthyMocks(sql);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    expect(checks).toHaveLength(1);
    expect(checks[0].id).toBe('canary_organizations');
    expect(checks[0].status).toBe('fail');
    expect(mockUpsertAgentPresence).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('fails the enforcement canary when the live block policy does not produce a block', async () => {
    const sql = makeSqlMock();
    healthyMocks(sql);
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', decision_id: 'act_gd_canary' });

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    const enforcement = checks.find((c) => c.id === 'canary_guard_enforcement');
    expect(enforcement.status).toBe('fail');
    expect(enforcement.message).toMatch(/expected decision "block"/i);
    // The canary policy is cleaned up and the policy cache invalidated even on failure.
    expect(sql.calls.some((c) => /DELETE FROM guard_policies/i.test(c.text))).toBe(true);
    expect(mockInvalidateGuardPolicyCache).toHaveBeenCalledWith(CANARY_ORG_ID);
  });

  it('passes the enforcement canary when the block decision lands and its audit row reads back', async () => {
    const sql = makeSqlMock();
    healthyMocks(sql);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    const enforcement = checks.find((c) => c.id === 'canary_guard_enforcement');
    expect(enforcement.status).toBe('pass');
    expect(mockEvaluateGuard).toHaveBeenCalledWith(
      CANARY_ORG_ID,
      expect.objectContaining({ action_type: 'doctor_canary_probe' }),
      sql,
    );
  });

  it('still passes when only the post-verify cleanup DELETE fails (write was proven)', async () => {
    const sql = makeSqlMock((text) => {
      if (/DELETE FROM agent_presence/i.test(text)) throw new Error('permission denied');
    });
    healthyMocks(sql);

    const checks = await runChecks({ env: { DATABASE_URL: 'postgres://test' } });

    expect(checks.find((c) => c.id === 'canary_agent_presence').status).toBe('pass');
  });
});
