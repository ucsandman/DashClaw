/**
 * findOpenApprovalRequest: "is a request for this exact ask already waiting on
 * a human?" The match is the same tuple the operator-approval grant uses
 * (agent, action type, goal, act content hash) plus the creating principal, so
 * a request can never be handed to a different act or a different caller.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';

vi.mock('@/lib/guard', () => ({ invalidateGuardPolicyCache: vi.fn() }));

import { findOpenApprovalRequest } from '@/lib/repositories/actions.repository.approvals';

const ASK = {
  agentId: 'agt_1',
  actionType: 'outreach_send',
  declaredGoal: 'Send the follow-up email',
  actContentHash: 'hash_1',
  createdBy: 'key_1',
};

describe('findOpenApprovalRequest', () => {
  it('returns the open request for the ask', async () => {
    const row = { action_id: 'act_open1', status: 'pending_approval' };
    const sql = createSqlMock({ taggedResponses: [[row]] });

    expect(await findOpenApprovalRequest(sql, 'org_1', ASK)).toEqual(row);
  });

  it('returns null when nothing is waiting', async () => {
    const sql = createSqlMock();

    expect(await findOpenApprovalRequest(sql, 'org_1', ASK)).toBeNull();
  });

  it('binds the org, the ask tuple, the act hash and the creating principal', async () => {
    const sql = createSqlMock();

    await findOpenApprovalRequest(sql, 'org_1', ASK);

    expect(sql.taggedCalls).toHaveLength(1);
    expect(sql.taggedCalls[0].values).toEqual(['org_1', 'agt_1', 'outreach_send', 'Send the follow-up email', 'hash_1', 'key_1']);
  });

  it('only matches a request that is still pending and has not expired', async () => {
    const sql = createSqlMock();

    await findOpenApprovalRequest(sql, 'org_1', ASK);

    const text = sql.taggedCalls[0].text.replace(/\s+/g, ' ');
    expect(text).toContain("status = 'pending_approval'");
    expect(text).toContain('approval_expires_at > NOW()');
  });

  it('binds null for an ask with no act and no principal, so only a row with neither can match', async () => {
    const sql = createSqlMock();

    await findOpenApprovalRequest(sql, 'org_1', { ...ASK, actContentHash: null, createdBy: null });

    expect(sql.taggedCalls[0].values.slice(4)).toEqual([null, null]);
    expect(sql.taggedCalls[0].text.replace(/\s+/g, ' ')).toMatch(/act_content_hash IS NOT DISTINCT FROM \?.*created_by IS NOT DISTINCT FROM \?/);
  });

  it.each([
    ['agent id', { agentId: '' }],
    ['action type', { actionType: undefined }],
    ['goal', { declaredGoal: null }],
  ])('never queries for an ask with no %s', async (_label, missing) => {
    const sql = createSqlMock();

    expect(await findOpenApprovalRequest(sql, 'org_1', { ...ASK, ...missing })).toBeNull();
    expect(sql.taggedCalls).toHaveLength(0);
  });
});
