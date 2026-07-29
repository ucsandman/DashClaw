import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteActionsByFilter, listActionIdsByFilter } from '@/lib/repositories/actions.repository.js';

// Filtered bulk delete: listActionIdsByFilter (the write-ahead audit's target
// set) and deleteActionsByFilter share one WHERE builder — these tests pin
// that the two compose identical filters and that related tables are cleaned
// before the action rows.

const query = vi.fn<(text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>(async () => []);
const sql = Object.assign(vi.fn(async () => []), { query }) as never;

beforeEach(() => {
  query.mockClear();
  query.mockResolvedValue([]);
});

describe('deleteActionsByFilter', () => {
  it('deletes open_loops and assumptions before action_records, all under the same WHERE', async () => {
    await deleteActionsByFilter(sql, 'org_1', { before: '2026-01-01', agentId: 'agent_1', status: 'completed' });

    expect(query).toHaveBeenCalledTimes(3);
    const [loops, assumptions, actions] = query.mock.calls;
    expect(loops?.[0]).toContain('DELETE FROM open_loops');
    expect(assumptions?.[0]).toContain('DELETE FROM assumptions');
    expect(actions?.[0]).toContain('DELETE FROM action_records');
    expect(actions?.[0]).toContain('RETURNING action_id');

    const expectedWhere =
      'WHERE org_id = $1 AND timestamp_start::timestamptz < $2::timestamptz AND agent_id = $3 AND status = $4';
    for (const call of query.mock.calls) {
      expect(call?.[0]).toContain(expectedWhere);
      expect(call?.[1]).toEqual(['org_1', '2026-01-01', 'agent_1', 'completed']);
    }
  });

  it('composes the same WHERE as listActionIdsByFilter for the same filter', async () => {
    const filter = { before: '2026-01-01', agentId: null, status: 'failed' };
    await listActionIdsByFilter(sql, 'org_1', filter);
    await deleteActionsByFilter(sql, 'org_1', filter);

    const listSql = String(query.mock.calls[0]?.[0]);
    const deleteSql = String(query.mock.calls[3]?.[0]);
    const whereOf = (s: string) => s.slice(s.indexOf('WHERE org_id')).replace(' RETURNING action_id', '');
    expect(whereOf(deleteSql)).toBe(whereOf(listSql));
    expect(query.mock.calls[0]?.[1]).toEqual(query.mock.calls[3]?.[1]);
  });

  it('omits unset filters from the WHERE clause', async () => {
    await deleteActionsByFilter(sql, 'org_1', { before: '2026-01-01' });

    const actionsSql = String(query.mock.calls[2]?.[0]);
    expect(actionsSql).toContain('WHERE org_id = $1 AND timestamp_start::timestamptz < $2::timestamptz');
    expect(actionsSql).not.toContain('agent_id');
    expect(actionsSql).not.toContain('status =');
    expect(query.mock.calls[2]?.[1]).toEqual(['org_1', '2026-01-01']);
  });
});
