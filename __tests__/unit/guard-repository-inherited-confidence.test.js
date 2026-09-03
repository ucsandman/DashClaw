/**
 * guard.repository findInheritedConfidence — the server-side carry that lets a
 * confidence stated on a bare POST /api/guard reach the record created by a
 * later POST /api/actions on stateless transports (hosted HTTP MCP connector,
 * SDK guard-then-createAction).
 */
import { describe, expect, it, vi } from 'vitest';
import { findInheritedConfidence } from '@/lib/repositories/guard.repository.js';

const match = { agentId: 'agent_1', actionType: 'build', declaredGoal: 'Build the project' };
const sqlReturning = (rows) => ({ query: vi.fn(async () => rows) });

describe('guard.repository findInheritedConfidence', () => {
  it('returns the stated confidence of the newest same-goal decision, skipping other goals', async () => {
    const sql = sqlReturning([
      { context: JSON.stringify({ declared_goal: 'Something else', confidence: 10 }) },
      { context: JSON.stringify({ declared_goal: 'Build the project', confidence: 80 }) },
      { context: JSON.stringify({ declared_goal: 'Build the project', confidence: 20 }) },
    ]);
    await expect(findInheritedConfidence(sql, 'org_1', match)).resolves.toBe(80);

    const [text, params] = sql.query.mock.calls[0];
    // Narrowed on the indexed (org_id, agent_id, created_at) prefix plus action_type, in-window, newest first.
    expect(text).toMatch(/org_id = \$1/);
    expect(text).toMatch(/agent_id = \$2/);
    expect(text).toMatch(/action_type = \$3/);
    expect(text).toMatch(/INTERVAL '24 hours'/);
    expect(text).toMatch(/ORDER BY created_at::timestamptz DESC/);
    expect(params).toEqual(['org_1', 'agent_1', 'build']);
  });

  it('accepts a context already parsed to an object', async () => {
    const sql = sqlReturning([{ context: { declared_goal: 'Build the project', confidence: 65 } }]);
    await expect(findInheritedConfidence(sql, 'org_1', match)).resolves.toBe(65);
  });

  it('returns null when the matching decision stated no usable confidence', async () => {
    const sql = sqlReturning([
      { context: JSON.stringify({ declared_goal: 'Build the project' }) },
      { context: JSON.stringify({ declared_goal: 'Build the project', confidence: 250 }) },
      { context: JSON.stringify({ declared_goal: 'Build the project', confidence: '80' }) },
      { context: 'not json' },
    ]);
    await expect(findInheritedConfidence(sql, 'org_1', match)).resolves.toBeNull();
  });

  it('skips the query entirely when the match key is incomplete', async () => {
    const sql = sqlReturning([{ context: JSON.stringify({ declared_goal: 'Build the project', confidence: 80 }) }]);
    await expect(findInheritedConfidence(sql, 'org_1', { ...match, declaredGoal: null })).resolves.toBeNull();
    await expect(findInheritedConfidence(sql, 'org_1', { ...match, agentId: undefined })).resolves.toBeNull();
    expect(sql.query).not.toHaveBeenCalled();
  });

  it('fails open: a query error is a miss, never a thrown record', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sql = { query: vi.fn(async () => { throw new Error('relation "guard_decisions" does not exist'); }) };
    await expect(findInheritedConfidence(sql, 'org_1', match)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
