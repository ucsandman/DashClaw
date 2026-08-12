// __tests__/unit/guardrails-insert-or-revive.test.ts
//
// Covers the REAL insertOrRevivePolicy. It moved out of the review-verdict
// route when the approval-card grant route needed it too; this file is where
// its collision/revive behavior is proven, since the route tests mock the
// repository wholesale and can only assert call order.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInvalidate } = vi.hoisted(() => ({ mockInvalidate: vi.fn() }));
vi.mock('@/lib/guard/caches.js', () => ({ invalidateGuardPolicyCache: mockInvalidate }));

import { insertOrRevivePolicy } from '@/lib/repositories/guardrails.repository';

const DATA = { id: 'gp_new', name: '[Grant] apply → build.mjs', policyType: 'allow_grant', rules: '{"a":1}' };

/**
 * The repository talks to a tagged-template sql client. Each test hands back a
 * scripted sequence of results, one per sql`` call, and records the calls so we
 * can tell an INSERT from an UPDATE without parsing SQL by hand.
 */
function sqlMock(script: Array<unknown[] | Error>) {
  const calls: string[] = [];
  let i = 0;
  const tag = async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    calls.push(text.includes('INSERT INTO guard_policies') ? 'insert'
      : text.includes('UPDATE guard_policies') ? 'update'
      : text.includes('SELECT') ? 'select' : 'other');
    const next = script[i++];
    if (next instanceof Error) throw next;
    return next ?? [];
  };
  return Object.assign(tag, { calls, query: async () => [] });
}

const collision = () => Object.assign(new Error('guard_policies_org_name_unique'), { code: '23505' });

describe('insertOrRevivePolicy', () => {
  beforeEach(() => mockInvalidate.mockClear());

  it('inserts cleanly when there is no name collision', async () => {
    const sql = sqlMock([[{ id: 'gp_new', active: 1 }]]);
    const row = await insertOrRevivePolicy(sql as never, 'org_1', DATA);
    expect(row).toEqual({ id: 'gp_new', active: 1 });
    expect(sql.calls).toEqual(['insert']);
  });

  // The failure this exists to prevent: an earlier grant with the same name was
  // deactivated, so the insert trips the unique index and the operator's click
  // dead-ends on a 409 while the rule stays inactive and keeps interrupting.
  it('revives a same-named inactive policy on a unique-violation', async () => {
    const sql = sqlMock([
      collision(),
      [{ id: 'gp_existing' }],
      [{ id: 'gp_existing', active: 1 }],
    ]);
    const row = await insertOrRevivePolicy(sql as never, 'org_1', DATA);
    expect(row).toEqual({ id: 'gp_existing', active: 1 });
    expect(sql.calls).toEqual(['insert', 'select', 'update']);
  });

  it('rethrows a collision when no same-named row can be found', async () => {
    const sql = sqlMock([collision(), []]);
    await expect(insertOrRevivePolicy(sql as never, 'org_1', DATA)).rejects.toThrow(/guard_policies_org_name_unique/);
  });

  // Only the name-unique violation is recoverable. Any other failure must
  // surface, not be silently turned into a revive of an unrelated row.
  it('rethrows an unrelated database error without attempting a revive', async () => {
    const sql = sqlMock([Object.assign(new Error('connection terminated'), { code: '08006' })]);
    await expect(insertOrRevivePolicy(sql as never, 'org_1', DATA)).rejects.toThrow(/connection terminated/);
    expect(sql.calls).toEqual(['insert']);
  });
});
