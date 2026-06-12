import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// The sql mock simulates Postgres: any statement that references the joined
// `ar` alias must actually JOIN action_records, otherwise Postgres errors with
// "missing FROM-clause entry for table ar". The pre-fix count query referenced
// ar.agent_id (via the WHERE clause) without the join and 500'd whenever an
// agent_id filter was supplied. Because the MCP server always injects the
// configured agent_id, dashclaw_loop_list hit this on every call.
const { mockSql } = vi.hoisted(() => {
  const sql = Object.assign(
    // tagged-template calls, used here only for the stats aggregate
    vi.fn(async () => [{ open_count: 2, resolved_count: 1, critical_open: 0, high_open: 1 }]),
    {
      query: vi.fn(async (text) => {
        if (/\bar\./.test(text) && !/join\s+action_records/i.test(text)) {
          throw new Error('column ar.agent_id does not exist: missing FROM-clause entry for table "ar"');
        }
        if (/count\(\*\)/i.test(text)) return [{ total: '3' }];
        return [{ loop_id: 'loop_1', status: 'open', priority: 'high', agent_id: 'agent-x' }];
      }),
    },
  );
  return { mockSql: sql };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));

import { GET } from '@/api/actions/loops/route.js';

describe('/api/actions/loops GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
  });

  it('returns 200 with loops when filtered by agent_id', async () => {
    const res = await GET(makeRequest('http://localhost/api/actions/loops?agent_id=agent-x'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.loops)).toBe(true);
    expect(data.total).toBe(3);
    expect(data.stats).toBeTruthy();
  });

  it('returns 200 without an agent_id filter', async () => {
    const res = await GET(makeRequest('http://localhost/api/actions/loops'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(3);
  });

  it('filters by action_id (regression: the param was parsed by MCP loop_list but ignored here)', async () => {
    const res = await GET(makeRequest('http://localhost/api/actions/loops?action_id=act_123'));
    expect(res.status).toBe(200);
    const mainCall = mockSql.query.mock.calls.find(([text]) => /ol\.action_id\s*=\s*\$\d/.test(text));
    expect(mainCall).toBeTruthy();
    expect(mainCall[1]).toContain('act_123');
  });

  it('count query joins action_records so ar.* filters resolve (regression)', async () => {
    await GET(makeRequest('http://localhost/api/actions/loops?agent_id=agent-x'));
    const countCall = mockSql.query.mock.calls.find(([text]) => /count\(\*\)/i.test(text));
    expect(countCall).toBeTruthy();
    expect(/join\s+action_records/i.test(countCall[0])).toBe(true);
  });
});
