import { describe, it, expect, vi } from 'vitest';
import { listActionIdsByFilter } from '../../app/lib/repositories/actions.repository';

function fakeSql() {
  const calls = [];
  const fn = () => Promise.resolve([]);
  fn.query = vi.fn((text, params) => { calls.push({ text, params }); return Promise.resolve([]); });
  return { sql: fn, calls };
}

describe('action delete filter — synthetic + agentIds modes', () => {
  it('agentIds uses agent_id = ANY', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { agentIds: ['a', 'b'] });
    expect(calls[0].text).toMatch(/agent_id = ANY\(\$2\)/);
    expect(calls[0].params).toEqual(['org_default', ['a', 'b']]);
  });
  it('synthetic uses LIKE ANY over agent + action_type patterns', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { synthetic: true });
    expect(calls[0].text).toMatch(/agent_id LIKE ANY\(\$2\) OR action_type LIKE ANY\(\$3\)/);
  });
  it('synthetic composes with before (retention sweep shape)', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { before: '2026-08-01', synthetic: true });
    expect(calls[0].text).toMatch(/timestamp_start::timestamptz < \$2::timestamptz/);
    expect(calls[0].text).toMatch(/LIKE ANY/);
  });
  it('limit appends LIMIT', async () => {
    const { sql, calls } = fakeSql();
    await listActionIdsByFilter(sql, 'org_default', { synthetic: true }, 10000);
    expect(calls[0].text).toMatch(/LIMIT 10000$/);
  });
});
