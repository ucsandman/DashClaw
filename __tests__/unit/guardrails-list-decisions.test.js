import { describe, it, expect, vi } from 'vitest';
import { listGuardrailDecisions } from '../../app/lib/repositories/guardrails.repository';

function mockSql() {
  const fn = vi.fn(async () => []);
  fn.query = vi.fn(async (text) => (text.startsWith('SELECT COUNT') ? [{ total: 0 }] : []));
  return fn;
}

describe('listGuardrailDecisions filters', () => {
  it('applies no optional conditions when no filters are given', async () => {
    const sql = mockSql();
    await listGuardrailDecisions(sql, 'org1');
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain('gd.org_id = $1');
    expect(text).not.toContain('gd.action_type = ');
    expect(text).not.toContain('gd.created_at::timestamptz >=');
    expect(sql.query.mock.calls[0][1]).toEqual(['org1', 50, 0]);
  });

  it('filters by action_type and since with correctly numbered params', async () => {
    const sql = mockSql();
    await listGuardrailDecisions(sql, 'org1', {
      actionType: 'deploy',
      since: '2026-08-21T00:00:00.000Z',
      limit: 10,
      offset: 5,
    });
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain('gd.action_type = $2');
    expect(text).toContain('gd.created_at::timestamptz >= $3::timestamptz');
    expect(sql.query.mock.calls[0][1]).toEqual([
      'org1', 'deploy', '2026-08-21T00:00:00.000Z', 10, 5,
    ]);
  });

  it('count query shares the WHERE clause so total reflects the same window', async () => {
    const sql = mockSql();
    await listGuardrailDecisions(sql, 'org1', { since: '2026-08-21T00:00:00.000Z' });
    const countCall = sql.query.mock.calls.find(([text]) => text.startsWith('SELECT COUNT'));
    expect(countCall[0]).toContain('gd.created_at::timestamptz >= $2::timestamptz');
    expect(countCall[1]).toEqual(['org1', '2026-08-21T00:00:00.000Z']);
  });

  it('stacks all five filters in declaration order', async () => {
    const sql = mockSql();
    await listGuardrailDecisions(sql, 'org1', {
      decision: 'require_approval',
      agentId: 'a1',
      actionType: 'deploy',
      since: '2026-08-21T00:00:00.000Z',
    });
    expect(sql.query.mock.calls[0][1]).toEqual([
      'org1', 'require_approval', 'a1', 'deploy', '2026-08-21T00:00:00.000Z', 50, 0,
    ]);
  });
});
