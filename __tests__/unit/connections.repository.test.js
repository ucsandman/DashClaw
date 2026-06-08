import { describe, it, expect } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { listConnections } from '../../app/lib/repositories/connections.repository.js';

describe('listConnections', () => {
  const cases = [
    ['org + agent + provider', { agentId: 'a1', provider: 'openai' }],
    ['org + agent', { agentId: 'a1' }],
    ['org + provider', { provider: 'openai' }],
    ['org only', {}],
  ];

  it.each(cases)('caps the %s branch with an explicit LIMIT', async (_label, filter) => {
    const sql = createSqlMock({ taggedResponses: [[]] });

    await listConnections(sql, 'org_1', filter);

    expect(sql.taggedCalls).toHaveLength(1);
    const { text, values } = sql.taggedCalls[0];
    expect(text).toContain('FROM agent_connections');
    expect(text).toContain('ORDER BY updated_at DESC LIMIT');
    expect(values).toContain(500);
  });

  it('returns an empty array when the query yields nothing', async () => {
    const sql = createSqlMock({ taggedResponses: [null] });
    const result = await listConnections(sql, 'org_1', {});
    expect(result).toEqual([]);
  });
});
