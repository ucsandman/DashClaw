import { describe, it, expect } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  upsertBehaviorSamples,
  listBehaviorSamples,
  pruneBehaviorSamples,
  upsertBehaviorDismissal,
  deleteBehaviorDismissal,
} from '@/lib/repositories/behavior.repository.js';

const sample = (over = {}) => ({
  event_id: 'bse_0001',
  ts: '2026-06-09T10:00:00.000Z',
  agent_id: 'claude-code',
  session_hash: null,
  source: 'claude-code',
  tool: 'Bash',
  tool_category: null,
  action_type: 'execute',
  command_shape: 'git push --force',
  bash_intent: 'destructive',
  risk_score: 85,
  guard_decision: 'allow',
  reversible: 0,
  model: null,
  read_path_hashes: ['ph_aaa'],
  write_path_hashes: ['ph_bbb'],
  write_path_groups: ['auth'],
  sensitive_path: 0,
  outcome_status: 'completed',
  error_type: null,
  duration_ms: 1200,
  matched_policy_count: 0,
  finalized: 1,
  ...over,
});

describe('upsertBehaviorSamples', () => {
  it('upserts on (org_id, event_id) and only lets a FINALIZED incoming row overwrite', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 1 }]] });
    const written = await upsertBehaviorSamples(sql, 'org_1', [sample()]);
    expect(written).toBe(1);
    expect(sql.queryCalls).toHaveLength(1);
    const { text, params } = sql.queryCalls[0];
    expect(text).toContain('ON CONFLICT (org_id, event_id) DO UPDATE');
    // pickFinalSample semantics: a non-finalized incoming record can NEVER
    // overwrite a stored row; among finalized records the latest ts wins.
    expect(text).toContain('WHERE EXCLUDED.finalized = 1');
    expect(text).toContain('behavior_samples.finalized = 0 OR EXCLUDED.ts >= behavior_samples.ts');
    expect(params[0]).toBe('org_1'); // org-scoped insert
    expect(params).toContain('bse_0001');
  });

  it('writes nothing for an empty batch', async () => {
    const sql = createSqlMock();
    expect(await upsertBehaviorSamples(sql, 'org_1', [])).toBe(0);
    expect(sql.queryCalls).toHaveLength(0);
  });

  it('chunks large batches', async () => {
    const sql = createSqlMock({ queryResponses: [Array(100).fill({ id: 1 }), Array(50).fill({ id: 1 })] });
    const samples = Array.from({ length: 150 }, (_, i) => sample({ event_id: `bse_${i}` }));
    const written = await upsertBehaviorSamples(sql, 'org_1', samples);
    expect(written).toBe(150);
    expect(sql.queryCalls).toHaveLength(2);
  });
});

describe('listBehaviorSamples', () => {
  it('is org-scoped and maps rows back into the BehaviorSample shape', async () => {
    const sql = createSqlMock({
      taggedResponses: [[{
        event_id: 'bse_0001', ts: '2026-06-09 10:00:00+00', agent_id: 'claude-code',
        session_hash: null, source: 'claude-code', tool: 'Write', tool_category: 'file',
        action_type: 'modify', command_shape: null, bash_intent: null, risk_score: '40',
        guard_decision: 'allow', reversible: 1, model: 'claude-fable-5',
        read_path_hashes: ['ph_aaa'], write_path_hashes: ['ph_bbb', 42],
        write_path_groups: ['auth'], sensitive_path: 1, outcome_status: 'completed',
        error_type: null, duration_ms: '900', matched_policy_count: 2, finalized: 1,
      }]],
    });
    const rows = await listBehaviorSamples(sql, 'org_1', { limit: 10 });
    expect(sql.taggedCalls[0].text).toContain('WHERE org_id = ?');
    expect(sql.taggedCalls[0].values[0]).toBe('org_1');
    expect(rows).toHaveLength(1);
    const s = rows[0];
    // Path hashes flow into the read_paths/write_paths the analyzer consumes.
    expect(s.read_paths).toEqual(['ph_aaa']);
    expect(s.write_paths).toEqual(['ph_bbb']); // non-strings dropped
    expect(s.write_path_groups).toEqual(['auth']);
    expect(s.risk_score).toBe(40);
    expect(s.reversible).toBe(true);
    expect(s.ts).toBe('2026-06-09T10:00:00.000Z');
  });

  it('caps the limit at 20000', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    await listBehaviorSamples(sql, 'org_1', { limit: 999999 });
    expect(sql.taggedCalls[0].values).toContain(20000);
  });
});

describe('pruneBehaviorSamples', () => {
  it('deletes aged rows and overflow beyond the newest 20000, org-scoped', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 1 }, { id: 2 }], [{ id: 3 }]] });
    const pruned = await pruneBehaviorSamples(sql, 'org_1');
    expect(pruned).toBe(3);
    expect(sql.taggedCalls).toHaveLength(2);
    expect(sql.taggedCalls[0].text).toContain('DELETE FROM behavior_samples');
    expect(sql.taggedCalls[0].values[0]).toBe('org_1');
    expect(sql.taggedCalls[1].text).toContain('OFFSET');
    expect(sql.taggedCalls[1].values[0]).toBe('org_1');
  });
});

describe('upsertBehaviorDismissal', () => {
  it('replaces by (org_id, signature)', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    await upsertBehaviorDismissal(sql, 'org_1', { signature: 'bsg_abc', status: 'dismissed', suppress_similar: true });
    expect(sql.taggedCalls[0].text).toContain('ON CONFLICT (org_id, signature) DO UPDATE');
    expect(sql.taggedCalls[0].values[0]).toBe('org_1');
  });

  it('requires a signature', async () => {
    const sql = createSqlMock();
    await expect(upsertBehaviorDismissal(sql, 'org_1', {})).rejects.toThrow(/signature/);
  });

  it('persists policy_id on an adopted row', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    await upsertBehaviorDismissal(sql, 'org_1', { signature: 'bsg_abc', status: 'adopted', policy_id: 'gp_1' });
    expect(sql.taggedCalls[0].text).toContain('policy_id');
    expect(sql.taggedCalls[0].values).toContain('gp_1');
  });
});

describe('deleteBehaviorDismissal', () => {
  it('deletes by (org_id, signature) and returns the removed row', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ signature: 'bsg_abc', status: 'adopted', policy_id: 'gp_1' }]] });
    const removed = await deleteBehaviorDismissal(sql, 'org_1', 'bsg_abc');
    expect(removed).toEqual({ signature: 'bsg_abc', status: 'adopted', policy_id: 'gp_1' });
    expect(sql.taggedCalls[0].text).toContain('DELETE FROM behavior_dismissals');
    expect(sql.taggedCalls[0].text).toContain('RETURNING signature, status, policy_id');
    expect(sql.taggedCalls[0].values[0]).toBe('org_1');
  });

  it('returns null when nothing was recorded for the signature', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    expect(await deleteBehaviorDismissal(sql, 'org_1', 'bsg_missing')).toBe(null);
  });

  it('returns null for a missing signature without querying', async () => {
    const sql = createSqlMock();
    expect(await deleteBehaviorDismissal(sql, 'org_1', '')).toBe(null);
    expect(sql.taggedCalls).toHaveLength(0);
  });
});
