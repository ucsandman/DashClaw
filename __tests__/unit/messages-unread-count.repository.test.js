import { describe, expect, it } from 'vitest';
import { getUnreadMessageCount } from '@/lib/repositories/messagesContext.repository';

// Pins the broadcast read-state predicate: read_by membership MUST use the
// jsonb element-containment operator (`read_by::jsonb ? $reader`) with the
// RAW reader id as the parameter. The old text-LIKE version treated `_` and
// `%` in agent ids as SQL wildcards, so substring/pattern-colliding ids
// (e.g. reader 'agent_1' vs entry "agentX1", or 'bot' vs 'bot-2') produced
// false read state on broadcasts.

function makeSql() {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('$?'), params: values });
    return Promise.resolve([{ count: 0 }]);
  };
  sql.query = (text, params) => {
    calls.push({ text, params });
    return Promise.resolve([{ count: 0 }]);
  };
  sql.calls = calls;
  return sql;
}

describe('getUnreadMessageCount — broadcast read_by matching', () => {
  it('agent-scoped branch uses jsonb ? containment with the raw reader id', async () => {
    const sql = makeSql();
    await getUnreadMessageCount(sql, 'org_1', 'agent_1');

    expect(sql.calls).toHaveLength(1);
    const { text, params } = sql.calls[0];
    expect(text).toContain('read_by::jsonb ?');
    expect(text).not.toMatch(/LIKE/i);
    // Raw id — no JSON quotes, no % wildcards wrapped around it
    expect(params).toContain('agent_1');
    expect(params.some(p => typeof p === 'string' && (p.includes('%') || p.includes('"')))).toBe(false);
  });

  it('org-wide branch (dashboard reader) uses jsonb ? containment with the raw reader id', async () => {
    const sql = makeSql();
    await getUnreadMessageCount(sql, 'org_1');

    expect(sql.calls).toHaveLength(1);
    const { text, params } = sql.calls[0];
    expect(text).toContain('read_by::jsonb ?');
    expect(text).not.toMatch(/LIKE/i);
    expect(params).toContain('dashboard');
    expect(params.some(p => typeof p === 'string' && (p.includes('%') || p.includes('"')))).toBe(false);
  });
});
