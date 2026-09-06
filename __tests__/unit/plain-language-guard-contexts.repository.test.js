import { describe, it, expect, vi } from 'vitest';
import { getGuardContextsByIds } from '@/lib/repositories/actions.repository';

function sqlMock(rows) {
  return vi.fn(async () => rows);
}

describe('getGuardContextsByIds', () => {
  it('returns an empty map without querying when given no ids', async () => {
    const sql = sqlMock([]);
    const out = await getGuardContextsByIds(sql, 'org_1', []);
    expect(out.size).toBe(0);
    expect(sql).not.toHaveBeenCalled();
  });

  it('parses the TEXT context column into objects keyed by decision id', async () => {
    const sql = sqlMock([
      { id: 'gd_1', context: JSON.stringify({ intel: { bash: { intent: 'destructive' } } }) },
      { id: 'gd_2', context: JSON.stringify({ intel: { file: { sensitive_path: true } } }) },
    ]);
    const out = await getGuardContextsByIds(sql, 'org_1', ['gd_1', 'gd_2']);
    expect(out.get('gd_1').intel.bash.intent).toBe('destructive');
    expect(out.get('gd_2').intel.file.sensitive_path).toBe(true);
  });

  it('skips a row whose context is unparseable rather than throwing', async () => {
    const sql = sqlMock([{ id: 'gd_1', context: '{not json' }]);
    const out = await getGuardContextsByIds(sql, 'org_1', ['gd_1']);
    expect(out.has('gd_1')).toBe(false);
  });

  it('carries the decision reason as the _gating_reason sibling', async () => {
    const sql = sqlMock([
      { id: 'gd_1', context: JSON.stringify({ intel: {} }), reason: 'assumption "x" was invalidated 4 min ago' },
      { id: 'gd_2', context: JSON.stringify({ intel: {} }), reason: null },
    ]);
    const out = await getGuardContextsByIds(sql, 'org_1', ['gd_1', 'gd_2']);
    expect(out.get('gd_1')._gating_reason).toBe('assumption "x" was invalidated 4 min ago');
    expect(out.get('gd_2')._gating_reason).toBeNull();
  });

  it('de-duplicates ids before querying', async () => {
    const sql = sqlMock([]);
    await getGuardContextsByIds(sql, 'org_1', ['gd_1', 'gd_1', 'gd_2']);
    expect(sql.mock.calls[0].at(-1)).toEqual(['gd_1', 'gd_2']);
  });
});
