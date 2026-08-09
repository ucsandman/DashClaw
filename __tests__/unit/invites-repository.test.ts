/**
 * app/lib/repositories/invites.repository.ts — email-matched invites (seats).
 * No invite emails, no join links: the admin records an address, and the
 * teammate joins at first sign-in when their verified OAuth email matches a
 * live invite. Addresses normalize to lowercase; the 0069 partial unique
 * index enforces one live invite per (org, address).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqlTag } from '../../app/lib/types/db';
import {
  createInvite,
  listPendingInvites,
  revokeInvite,
  findPendingInviteByEmail,
  acceptInvite,
} from '../../app/lib/repositories/invites.repository';

type Call = { text: string; values: unknown[] };

function makeSqlMock(responses: Array<unknown[] | Error>) {
  const queue = [...responses];
  const calls: Call[] = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    calls.push({ text, values });
    const next = queue.shift() ?? [];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }) as unknown as SqlTag & { calls: Call[] };
  (fn as unknown as { calls: Call[] }).calls = calls;
  return fn;
}

beforeEach(() => vi.clearAllMocks());

describe('createInvite', () => {
  it('normalizes the address, refuses existing members, and inserts with an expiry', async () => {
    const sql = makeSqlMock([
      [],                        // member check: not already in the org
      [{ id: 'inv_1' }],         // insert RETURNING
    ]);
    const result = await createInvite(sql, {
      orgId: 'org_a', email: '  Casey@Example.COM ', role: 'member', createdByUserId: 'usr_admin',
    });
    expect(result).toMatchObject({ created: true, invite: { id: 'inv_1' } });
    // both queries see the normalized address
    expect(sql.calls[0]!.values).toContain('casey@example.com');
    expect(sql.calls[1]!.values).toContain('casey@example.com');
    expect(sql.calls[1]!.text).toContain('INSERT INTO invites');
    expect(sql.calls[1]!.text).toContain('expires_at');
  });

  it('reports already_member without inserting', async () => {
    const sql = makeSqlMock([[{ id: 'usr_existing' }]]);
    const result = await createInvite(sql, {
      orgId: 'org_a', email: 'casey@example.com', role: 'member', createdByUserId: 'usr_admin',
    });
    expect(result).toEqual({ created: false, reason: 'already_member' });
    expect(sql.calls.length).toBe(1);
  });

  it('maps the partial-unique collision to already_invited', async () => {
    const dup = Object.assign(new Error('duplicate key value violates unique constraint "invites_org_email_pending_idx"'), { code: '23505' });
    const sql = makeSqlMock([[], dup]);
    const result = await createInvite(sql, {
      orgId: 'org_a', email: 'casey@example.com', role: 'member', createdByUserId: 'usr_admin',
    });
    expect(result).toEqual({ created: false, reason: 'already_invited' });
  });

  it('rejects malformed addresses and roles outside the users constraint', async () => {
    const sql = makeSqlMock([]);
    expect(await createInvite(sql, { orgId: 'o', email: 'not-an-email', role: 'member', createdByUserId: 'u' }))
      .toEqual({ created: false, reason: 'invalid_email' });
    expect(await createInvite(sql, { orgId: 'o', email: 'a@b.co', role: 'owner', createdByUserId: 'u' }))
      .toEqual({ created: false, reason: 'invalid_role' });
    expect(sql.calls.length).toBe(0);
  });
});

describe('listPendingInvites / revokeInvite', () => {
  it('lists only pending invites for the org', async () => {
    const sql = makeSqlMock([[{ id: 'inv_1', email: 'a@b.co', role: 'member', expires_at: '2099-01-01T00:00:00Z', created_at: '2026-08-09T00:00:00Z' }]]);
    const rows = await listPendingInvites(sql, 'org_a');
    expect(rows).toHaveLength(1);
    expect(sql.calls[0]!.text).toContain('accepted_at IS NULL');
    expect(sql.calls[0]!.values).toContain('org_a');
  });

  it('revoke deletes only a pending invite scoped to the org', async () => {
    const sql = makeSqlMock([[{ id: 'inv_1' }]]);
    const result = await revokeInvite(sql, { orgId: 'org_a', inviteId: 'inv_1' });
    expect(result).toEqual({ revoked: true });
    const { text, values } = sql.calls[0]!;
    expect(text).toContain('DELETE FROM invites');
    expect(text).toContain('accepted_at IS NULL');
    expect(values).toEqual(expect.arrayContaining(['org_a', 'inv_1']));
  });

  it('revoking an unknown or accepted invite reports revoked: false', async () => {
    const sql = makeSqlMock([[]]);
    expect(await revokeInvite(sql, { orgId: 'org_a', inviteId: 'inv_x' })).toEqual({ revoked: false });
  });
});

describe('findPendingInviteByEmail', () => {
  it('matches case-insensitively, live-only, newest first', async () => {
    const sql = makeSqlMock([[{ id: 'inv_2', org_id: 'org_b', role: 'member' }]]);
    const invite = await findPendingInviteByEmail(sql, 'Casey@Example.com');
    expect(invite).toMatchObject({ id: 'inv_2', orgId: 'org_b', role: 'member' });
    const { text, values } = sql.calls[0]!;
    expect(values).toContain('casey@example.com');
    expect(text).toContain('accepted_at IS NULL');
    expect(text).toContain('expires_at >');
    expect(text).toContain('ORDER BY created_at DESC');
  });

  it('returns null when nothing matches or the address is empty', async () => {
    expect(await findPendingInviteByEmail(makeSqlMock([[]]), 'a@b.co')).toBeNull();
    const sql = makeSqlMock([]);
    expect(await findPendingInviteByEmail(sql, '')).toBeNull();
    expect(sql.calls.length).toBe(0);
  });
});

describe('acceptInvite', () => {
  it('stamps acceptance exactly once and returns the org + role', async () => {
    const sql = makeSqlMock([[{ org_id: 'org_b', role: 'member' }]]);
    const result = await acceptInvite(sql, { inviteId: 'inv_2', userId: 'usr_new' });
    expect(result).toEqual({ accepted: true, orgId: 'org_b', role: 'member' });
    const { text } = sql.calls[0]!;
    expect(text).toContain('SET accepted_at = NOW()');
    expect(text).toContain('accepted_at IS NULL');
  });

  it('an already-accepted invite reports accepted: false', async () => {
    const sql = makeSqlMock([[]]);
    expect(await acceptInvite(sql, { inviteId: 'inv_2', userId: 'usr_new' })).toEqual({ accepted: false });
  });
});
