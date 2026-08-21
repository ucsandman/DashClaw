// __tests__/unit/doctor-create-default-policy.test.js
// app/lib/doctor/fixes/create-default-policy.mjs — the create_default_policy fix
// relies entirely on seedCatastrophePack's per-name idempotency (no extra
// existence guard): applied reflects whether anything new was imported.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSql } = vi.hoisted(() => ({ mockGetSql: vi.fn() }));
vi.mock('@/lib/db', () => ({ getSql: mockGetSql }));

import { apply } from '@/lib/doctor/fixes/create-default-policy.mjs';

// Tagged-template sql stub — same shape as catastrophe-pack-seed.test.js's
// makeSqlStub: SELECT decides skip-vs-insert by name, INSERT is a no-op.
function makeSqlStub(existingNames = []) {
  const sql = (strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('SELECT')) {
      const name = values[1];
      return Promise.resolve(existingNames.includes(name) ? [{ id: 'gp_existing' }] : []);
    }
    return Promise.resolve([]);
  };
  return sql;
}

beforeEach(() => {
  mockGetSql.mockReset();
});

describe('doctor fix: create_default_policy', () => {
  it('empty org — imports all four Short List policies', async () => {
    mockGetSql.mockReturnValue(makeSqlStub([]));
    const res = await apply();
    expect(res.applied).toBe(true);
    expect(res.description).toContain('4 catastrophe-only policies');
  });

  it('partially seeded org (2 names present) — imports the missing 2, notes the rest', async () => {
    mockGetSql.mockReturnValue(
      makeSqlStub([
        'Catastrophe Pack — Hold Mass-Destructive Operations for Approval',
        'Catastrophe Pack — Hold Secret-File Writes for Approval',
      ]),
    );
    const res = await apply();
    expect(res.applied).toBe(true);
    expect(res.description).toContain('2 catastrophe-only policies');
    expect(res.description).toContain('2 already present');
  });

  it('all four already present — applied false with an honest description', async () => {
    mockGetSql.mockReturnValue(
      makeSqlStub([
        'Catastrophe Pack — Hold Mass-Destructive Operations for Approval',
        'Catastrophe Pack — Hold Secret-File Writes for Approval',
        'Catastrophe Pack — Hold Force-Push Over Protected Branches',
        'Catastrophe Pack — Rate-Limit Runaway Agents',
      ]),
    );
    const res = await apply();
    expect(res.applied).toBe(false);
    expect(res.description).toBe('org_default already has the full Short List');
  });

  it('seed error — applied false, description carries the error message', async () => {
    mockGetSql.mockReturnValue(() => Promise.reject(new Error('db unreachable')));
    const res = await apply();
    expect(res.applied).toBe(false);
    expect(res.description).toBe('Failed to create policy: db unreachable');
  });
});
