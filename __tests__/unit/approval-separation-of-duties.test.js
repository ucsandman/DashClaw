/**
 * Separation of duties on the approval gate (drizzle/0055, security review
 * 2026-07-05): the principal that created an action may not approve it.
 *
 * - createActionRecord persists the trusted middleware principal (created_by).
 *   Position pin: the insert binds created_by directly BEFORE the v4.3 lineage
 *   pair, so .at(-5) = created_by (fleet-attribution pins -4/-3, close-source
 *   pins -2, approvals-lifecycle pins -1 — all unchanged).
 * - recordBulkApprovals excludes rows the approver's own principal created
 *   ('operator' root principal exempt) inside the same atomic UPDATE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createActionRecord, recordBulkApprovals } from '../../app/lib/repositories/actions.repository.js';

function makeCapturingSqlMock(responses) {
  const queue = [...responses];
  const calls = [];
  const sql = vi.fn((strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(queue.shift() ?? []);
  });
  sql.query = vi.fn((text, params) => {
    calls.push({ text, values: params });
    return Promise.resolve(queue.shift() ?? []);
  });
  sql.calls = calls;
  return sql;
}

const payload = (extra = {}) => ({
  orgId: 'org_1',
  action_id: 'act_1',
  data: { agent_id: 'a1', action_type: 'deploy', declared_goal: 'ship' },
  actionStatus: 'pending_approval',
  costEstimate: 0,
  signature: null,
  verified: false,
  timestamp_start: '2026-07-05T00:00:00Z',
  riskScore: 10,
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe('createActionRecord — created_by principal stamp', () => {
  it('persists the payload createdBy (trusted middleware principal)', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload({ createdBy: 'key_abc123' }));
    const { text, values } = sql.calls[0];
    expect(text).toContain('created_by');
    expect(values.at(-5)).toBe('key_abc123');
  });

  it('binds NULL when no principal was passed (system/legacy writers)', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload());
    expect(sql.calls[0].values.at(-5)).toBeNull();
  });

  it('never reads created_by from the client data body', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload({
      data: { agent_id: 'a1', action_type: 'deploy', created_by: 'key_spoofed' },
    }));
    expect(sql.calls[0].values.at(-5)).toBeNull();
  });
});

describe('recordBulkApprovals — separation-of-duties exclusion', () => {
  const bulkData = {
    newStatus: 'running',
    errorMessage: null,
    decision: 'allow',
    userId: 'key_admin1',
    safeReasoning: 'bulk',
  };

  it('excludes rows the approver principal created, atomically in the UPDATE', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await recordBulkApprovals(sql, 'org_1', ['act_1', 'act_2'], bulkData);
    const { text, values } = sql.calls[0];
    expect(text).toContain("($8 = 'operator' OR created_by IS DISTINCT FROM $8)");
    expect(values[7]).toBe('key_admin1');
  });

  it("the 'operator' root principal is exempt (single-admin self-host)", async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await recordBulkApprovals(sql, 'org_1', ['act_1'], { ...bulkData, userId: 'operator' });
    // The clause short-circuits on $8 = 'operator'; the same SQL is bound
    // with the operator principal, so no row is excluded by creator.
    expect(sql.calls[0].values[7]).toBe('operator');
  });
});
