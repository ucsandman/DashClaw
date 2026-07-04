// Tightening proposals (roadmap v3.2: findings become proposals) — repository tests.
// Spec: docs/superpowers/specs/2026-07-03-findings-become-proposals-design.md
import { describe, it, expect, vi } from 'vitest';
import {
  getUngovernedAllowDecisions,
  getTighteningDecisions,
  upsertTighteningDecision,
  deleteTighteningDecision,
} from '../../app/lib/repositories/tightening.repository';
import { SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS, SYNTHETIC_AGENT_LIKE_PATTERNS } from '../../app/lib/calibration-mining.js';

function mockSql(rows: unknown[]) {
  const fn = vi.fn(async () => rows) as unknown as { query: ReturnType<typeof vi.fn> };
  fn.query = vi.fn(async () => rows);
  return fn;
}

describe('getUngovernedAllowDecisions', () => {
  it('org-scopes, casts created_at, and defaults includeSynthetic/limit', async () => {
    const sql = mockSql([{ id: 'act_gd_1', risk_score: 60, action_type: 'deploy' }]);
    const out = await getUngovernedAllowDecisions(sql as any, 'org1', 7);
    expect(out).toHaveLength(1);
    const text = sql.query.mock.calls[0]![0];
    expect(text).toContain('guard_decisions');
    expect(text).toContain("decision = 'allow'");
    expect(text).toContain('risk_score >= 50');
    // created_at is TEXT on fresh drizzle schemas — the cast keeps this query
    // alive on CI/self-host Postgres (the v3.1 lesson).
    expect(text).toContain('created_at::timestamptz >');
    expect(sql.query.mock.calls[0]![1]).toEqual([
      'org1',
      7,
      false, // includeSynthetic defaults to false
      SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
      SYNTHETIC_AGENT_LIKE_PATTERNS,
      2000, // DEFAULT_ROW_LIMIT
    ]);
  });

  it('passes includeSynthetic=true and a custom limit through to the query params', async () => {
    const sql = mockSql([]);
    await getUngovernedAllowDecisions(sql as any, 'org1', 30, { includeSynthetic: true, limit: 50 });
    expect(sql.query.mock.calls[0]![1]).toEqual([
      'org1',
      30,
      true,
      SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
      SYNTHETIC_AGENT_LIKE_PATTERNS,
      50,
    ]);
  });
});

describe('getTighteningDecisions', () => {
  it('returns all rows for the org, newest judgment first', async () => {
    const sql = mockSql([{ proposal_id: 'tp_a' }, { proposal_id: 'tp_b' }]);
    const rows = await getTighteningDecisions(sql as any, 'org1');
    expect(rows).toHaveLength(2);
    const text = sql.query.mock.calls[0]![0];
    expect(text).toContain('tightening_proposal_decisions');
    expect(text).toContain('org_id = $1');
    expect(text).toContain('ORDER BY decided_at DESC');
    expect(sql.query.mock.calls[0]![1]).toEqual(['org1']);
  });
});

describe('upsertTighteningDecision', () => {
  const baseInput = {
    proposalId: 'tp_0123456789abcdef',
    rule: 'govern_ungoverned_allow',
    decision: 'ratified' as const,
    actionType: 'deploy',
    riskLevel: 'high',
    findingKey: 'abcd1234',
    snapshot: { rule: 'govern_ungoverned_allow', action_type: 'deploy', risk_level: 'high' },
    policyId: 'gp_1',
    reason: null,
    decidedBy: 'user_1',
  };

  it('inserts on first write with all fields, including the JSON-stringified snapshot', async () => {
    const row = { id: 1, proposal_id: baseInput.proposalId, decision: 'ratified' };
    const sql = mockSql([row]);
    const out = await upsertTighteningDecision(sql as any, 'org1', baseInput);
    expect(out).toEqual(row);
    const [text, params] = sql.query.mock.calls[0]!;
    expect(text).toContain('INSERT INTO tightening_proposal_decisions');
    expect(text).toContain('ON CONFLICT (org_id, proposal_id) DO UPDATE');
    expect(params[0]).toBe('org1');
    expect(params[1]).toBe(baseInput.proposalId);
    expect(params[7]).toBe(JSON.stringify(baseInput.snapshot));
    expect(params[8]).toBe('gp_1');
  });

  it('conflict-overwrite refreshes decided_at and replaces policy_id/reason on re-decision', async () => {
    const sql = mockSql([{ id: 1 }]);
    await upsertTighteningDecision(sql as any, 'org1', {
      ...baseInput,
      decision: 'dismissed',
      policyId: null,
      reason: 'noise',
    });
    const text = sql.query.mock.calls[0]![0];
    expect(text).toContain('decision = EXCLUDED.decision');
    expect(text).toContain('policy_id = EXCLUDED.policy_id');
    expect(text).toContain('reason = EXCLUDED.reason');
    expect(text).toContain('decided_at = now()');
    const params = sql.query.mock.calls[0]![1];
    expect(params[3]).toBe('dismissed');
    expect(params[8]).toBeNull(); // policy_id
    expect(params[9]).toBe('noise'); // reason
  });

  it('stores a null snapshot as null (not the string "null")', async () => {
    const sql = mockSql([{ id: 1 }]);
    await upsertTighteningDecision(sql as any, 'org1', { ...baseInput, snapshot: null });
    const params = sql.query.mock.calls[0]![1];
    expect(params[7]).toBeNull();
  });
});

describe('deleteTighteningDecision', () => {
  it('returns the deleted row when a decision existed', async () => {
    const row = { id: 1, proposal_id: 'tp_0123456789abcdef', policy_id: 'gp_1' };
    const sql = mockSql([row]);
    const out = await deleteTighteningDecision(sql as any, 'org1', 'tp_0123456789abcdef');
    expect(out).toEqual(row);
    const text = sql.query.mock.calls[0]![0];
    expect(text).toContain('DELETE FROM tightening_proposal_decisions');
    expect(text).toContain('RETURNING *');
    expect(sql.query.mock.calls[0]![1]).toEqual(['org1', 'tp_0123456789abcdef']);
  });

  it('returns null when nothing matched', async () => {
    const sql = mockSql([]);
    const out = await deleteTighteningDecision(sql as any, 'org1', 'tp_0123456789abcdef');
    expect(out).toBeNull();
  });
});
