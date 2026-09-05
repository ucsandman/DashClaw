import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// --- Mocks ---

const mockGetSql = vi.fn();
const mockGetOrgId = vi.fn(() => 'org_test');
const mockGetOrgRole = vi.fn(() => 'admin');
const mockGetUserId = vi.fn(() => 'user_1');
const mockLogActivity = vi.fn();
const mockPublishOrgEvent = vi.fn(() => Promise.resolve());
const mockScanSensitiveData = vi.fn((v) => ({ clean: true, redacted: v, findings: [] }));
const mockRecordApproval = vi.fn();
const mockGetActionStatus = vi.fn();
const mockGetActionSummary = vi.fn();
const mockExpireOverdueApproval = vi.fn();
const mockFireWebhooksForApproval = vi.fn(() => Promise.resolve());

// after() callbacks run immediately in tests (the route now defers the
// approve/deny audit write through after() so Vercel can't drop it).
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    after: (cb) => {
      try {
        const r = typeof cb === 'function' ? cb() : undefined;
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch { /* deferred work must not sink the test request */ }
    },
  };
});
vi.mock('../../app/lib/approvalNotifications.js', () => ({
  clearApprovalNotifications: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockGetSql }));
vi.mock('../../app/lib/org.js', () => ({
  getOrgId: (...a) => mockGetOrgId(...a),
  getOrgRole: (...a) => mockGetOrgRole(...a),
  getUserId: (...a) => mockGetUserId(...a),
}));
vi.mock('../../app/lib/audit.js', () => ({ logActivity: (...a) => mockLogActivity(...a) }));
vi.mock('../../app/lib/events.js', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: (...a) => mockPublishOrgEvent(...a),
}));
vi.mock('../../app/lib/security.js', () => ({
  scanSensitiveData: (...a) => mockScanSensitiveData(...a),
  redactAny: function redactAny(value, findings) {
    if (typeof value === 'string') {
      const scan = mockScanSensitiveData(value);
      if (!scan.clean) findings.push(...scan.findings);
      return scan.redacted;
    }
    if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
      return out;
    }
    return value;
  },
}));
vi.mock('../../app/lib/repositories/actions.repository.js', async (importOriginal) => {
  // Partial mock: keep the real pure helpers (isApprovalOverdue and friends)
  // so the route's expiry checks run genuine logic against mocked rows.
  const actual = await importOriginal();
  return {
    ...actual,
    recordApproval: (...a) => mockRecordApproval(...a),
    getActionStatus: (...a) => mockGetActionStatus(...a),
    getActionSummary: (...a) => mockGetActionSummary(...a),
    expireOverdueApproval: (...a) => mockExpireOverdueApproval(...a),
  };
});
vi.mock('../../app/lib/webhooks.js', () => ({
  fireWebhooksForApproval: (...a) => mockFireWebhooksForApproval(...a),
}));

const { POST } = await import('../../app/api/approvals/[actionId]/route.js');

// --- Helpers ---

function req(body) {
  return makeRequest('http://localhost:3000/api/approvals/act_123', {
    headers: { 'x-api-key': 'oc_live_test' },
    body,
  });
}

const params = Promise.resolve({ actionId: 'act_123' });

describe('POST /api/approvals/[actionId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects non-admin users with 403', async () => {
    mockGetOrgRole.mockReturnValueOnce('viewer');

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/admin/i);
  });

  it('rejects an unattributed approver (empty user id) with 403', async () => {
    // Security review 2026-07-05: before this gate, key-auth requests carried
    // no x-user-id, recordApproval stored approved_by = '', and the guard's
    // operator-approval grant treated '' as a valid grant — an approval
    // attributed to nobody. Middleware now attributes every admin path
    // (operator / key_<id> / trial:<org>); anything still empty is rejected.
    mockGetUserId.mockReturnValueOnce('');

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('APPROVER_IDENTITY_REQUIRED');
    expect(mockRecordApproval).not.toHaveBeenCalled();
  });

  it('rejects self-approval: the creating principal cannot approve its own action', async () => {
    // Separation of duties (drizzle/0055): the same credential that created
    // the pending action POSTs its own approval — machine self-approval
    // through the human gate. Rejected regardless of role.
    mockGetUserId.mockReturnValueOnce('key_agent1');
    mockGetActionStatus.mockResolvedValueOnce({
      status: 'pending_approval', agent_id: 'agent_1', created_by: 'key_agent1',
      approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(mockRecordApproval).not.toHaveBeenCalled();
  });

  it("exempts the 'operator' root principal from the self-approval gate (single-admin self-host)", async () => {
    mockGetUserId.mockReturnValueOnce('operator');
    mockGetActionStatus.mockResolvedValueOnce({
      status: 'pending_approval', agent_id: 'agent_1', created_by: 'operator',
      approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const updatedAction = { action_id: 'act_123', status: 'running', agent_id: 'agent_1' };
    mockRecordApproval.mockResolvedValueOnce(updatedAction);
    mockGetActionSummary.mockResolvedValueOnce(updatedAction);

    const res = await POST(req({ decision: 'allow' }), { params });

    expect(res.status).toBe(200);
    expect(mockRecordApproval).toHaveBeenCalled();
  });

  it('allows approval by a different principal than the creator', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      status: 'pending_approval', agent_id: 'agent_1', created_by: 'key_agent1',
      approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const updatedAction = { action_id: 'act_123', status: 'running', agent_id: 'agent_1' };
    mockRecordApproval.mockResolvedValueOnce(updatedAction);
    mockGetActionSummary.mockResolvedValueOnce(updatedAction);

    // Approver is user_1 (default mock), creator is key_agent1 — distinct.
    const res = await POST(req({ decision: 'allow' }), { params });

    expect(res.status).toBe(200);
  });

  it('rejects invalid decision with 400', async () => {
    const res = await POST(req({ decision: 'maybe' }), { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/invalid decision/i);
  });

  it('returns 404 when action not found', async () => {
    mockGetActionStatus.mockResolvedValueOnce(null);

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/not found/i);
  });

  it('returns 400 when action is not pending_approval', async () => {
    mockGetActionStatus.mockResolvedValueOnce({ status: 'completed', agent_id: 'agent_1' });

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/not pending/i);
  });

  it('allows a pending action successfully', async () => {
    mockGetActionStatus.mockResolvedValueOnce({ status: 'pending_approval', agent_id: 'agent_1' });
    const updatedAction = { action_id: 'act_123', status: 'running', agent_id: 'agent_1' };
    mockRecordApproval.mockResolvedValueOnce(updatedAction);
    mockGetActionSummary.mockResolvedValueOnce(updatedAction);

    const res = await POST(req({ decision: 'allow', reasoning: 'Looks safe' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.action.status).toBe('running');
    expect(data.security.clean).toBe(true);

    // Verify recordApproval was called with correct status
    expect(mockRecordApproval).toHaveBeenCalledWith(
      expect.anything(), 'org_test', 'act_123',
      expect.objectContaining({ newStatus: 'running', decision: 'allow' })
    );

    // Verify audit log
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'action.allowed' }),
      expect.anything()
    );

    // Verify webhook fired
    expect(mockFireWebhooksForApproval).toHaveBeenCalledWith(
      'org_test', 'approval_granted', expect.objectContaining({ status: 'running' }), expect.anything()
    );
  });

  it('denies a pending action successfully', async () => {
    mockGetActionStatus.mockResolvedValueOnce({ status: 'pending_approval', agent_id: 'agent_1' });
    const updatedAction = { action_id: 'act_123', status: 'failed', agent_id: 'agent_1' };
    mockRecordApproval.mockResolvedValueOnce(updatedAction);
    mockGetActionSummary.mockResolvedValueOnce(updatedAction);

    const res = await POST(req({ decision: 'deny', reasoning: 'Too risky' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    expect(mockRecordApproval).toHaveBeenCalledWith(
      expect.anything(), 'org_test', 'act_123',
      expect.objectContaining({
        newStatus: 'failed',
        decision: 'deny',
        errorMessage: 'Too risky',
      })
    );

    expect(mockFireWebhooksForApproval).toHaveBeenCalledWith(
      'org_test', 'approval_denied', expect.objectContaining({ status: 'failed' }), expect.anything()
    );
  });

  it('uses default deny message when no reasoning provided', async () => {
    mockGetActionStatus.mockResolvedValueOnce({ status: 'pending_approval', agent_id: 'agent_1' });
    mockRecordApproval.mockResolvedValueOnce({ action_id: 'act_123', status: 'failed' });
    mockGetActionSummary.mockResolvedValueOnce(null);

    const res = await POST(req({ decision: 'deny' }), { params });
    expect(res.status).toBe(200);

    expect(mockRecordApproval).toHaveBeenCalledWith(
      expect.anything(), 'org_test', 'act_123',
      expect.objectContaining({ errorMessage: 'Denied by human operator' })
    );
  });

  it('redacts sensitive data in reasoning', async () => {
    mockGetActionStatus.mockResolvedValueOnce({ status: 'pending_approval', agent_id: 'agent_1' });
    mockRecordApproval.mockResolvedValueOnce({ action_id: 'act_123', status: 'running' });
    mockGetActionSummary.mockResolvedValueOnce(null);
    mockScanSensitiveData.mockReturnValueOnce({
      clean: false,
      redacted: '[REDACTED]',
      findings: [{ severity: 'critical', category: 'api_key' }],
    });

    const res = await POST(req({ decision: 'allow', reasoning: 'sk-secret-key-here' }), { params });
    const data = await res.json();

    expect(data.security.clean).toBe(false);
    expect(data.security.findings_count).toBe(1);
    expect(data.security.critical_count).toBe(1);
    expect(data.security.categories).toContain('api_key');
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ details: { decision: 'allow', reasoning: '[REDACTED]' } }),
      expect.anything(),
    );
  });

  it('emits real-time event on approval', async () => {
    mockGetActionStatus.mockResolvedValueOnce({ status: 'pending_approval', agent_id: 'agent_1' });
    const updatedAction = { action_id: 'act_123', status: 'running' };
    mockRecordApproval.mockResolvedValueOnce(updatedAction);
    mockGetActionSummary.mockResolvedValueOnce(null);

    await POST(req({ decision: 'allow' }), { params });

    expect(mockPublishOrgEvent).toHaveBeenCalledWith(
      'action.updated',
      expect.objectContaining({ orgId: 'org_test', action: updatedAction })
    );
  });

  it('returns 500 on unexpected error', async () => {
    mockGetActionStatus.mockRejectedValueOnce(new Error('DB down'));

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
  });

  it('returns 409 when recordApproval returns null (race with another approver)', async () => {
    // Simulates atomic status guard in recordApproval detecting that another
    // caller resolved the action between the getActionStatus read and UPDATE.
    mockGetActionStatus.mockResolvedValueOnce({ status: 'pending_approval', agent_id: 'agent_1' });
    mockRecordApproval.mockResolvedValueOnce(null);

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/already resolved/i);
    // No event, no webhook, no audit log when we lose the race.
    expect(mockFireWebhooksForApproval).not.toHaveBeenCalled();
  });

  // --- Approvals lifecycle hygiene (roadmap v2.3) ---

  it('returns 410 with a truthful message when the action is already expired', async () => {
    mockGetActionStatus.mockResolvedValueOnce({ status: 'expired', agent_id: 'agent_1' });

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(410);
    expect(data.code).toBe('APPROVAL_EXPIRED');
    expect(data.error).toMatch(/can no longer release anything/i);
    expect(mockRecordApproval).not.toHaveBeenCalled();
  });

  it('lazily expires an overdue pending approval and returns 410', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      status: 'pending_approval', agent_id: 'agent_1',
      approval_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const expiredRow = { action_id: 'act_123', status: 'expired', agent_id: 'agent_1', action_type: 'deploy' };
    mockExpireOverdueApproval.mockResolvedValueOnce(expiredRow);

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(410);
    expect(data.code).toBe('APPROVAL_EXPIRED');
    expect(data.action.status).toBe('expired');
    expect(mockExpireOverdueApproval).toHaveBeenCalledWith(expect.anything(), 'org_test', 'act_123');
    expect(mockRecordApproval).not.toHaveBeenCalled();
    // The flip is announced so /approvals refreshes in real time.
    expect(mockPublishOrgEvent).toHaveBeenCalledWith('action.updated', expect.objectContaining({ action: expiredRow }));
  });

  it('treats a legacy pending row (no expiry stamp) older than 24h as overdue', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      status: 'pending_approval', agent_id: 'agent_1',
      approval_expires_at: null,
      created_at: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    });
    mockExpireOverdueApproval.mockResolvedValueOnce({ action_id: 'act_123', status: 'expired' });

    const res = await POST(req({ decision: 'allow' }), { params });

    expect(res.status).toBe(410);
  });

  it('does NOT expire a pending approval that is still inside its window', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      status: 'pending_approval', agent_id: 'agent_1',
      approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const updatedAction = { action_id: 'act_123', status: 'running', agent_id: 'agent_1' };
    mockRecordApproval.mockResolvedValueOnce(updatedAction);
    mockGetActionSummary.mockResolvedValueOnce(updatedAction);

    const res = await POST(req({ decision: 'allow' }), { params });

    expect(res.status).toBe(200);
    expect(mockExpireOverdueApproval).not.toHaveBeenCalled();
  });

  it('falls back to the real status when the expiry flip loses a race', async () => {
    mockGetActionStatus
      .mockResolvedValueOnce({
        status: 'pending_approval', agent_id: 'agent_1',
        approval_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      // Re-read after the null flip: another approver won.
      .mockResolvedValueOnce({ status: 'running', agent_id: 'agent_1' });
    mockExpireOverdueApproval.mockResolvedValueOnce(null);

    const res = await POST(req({ decision: 'allow' }), { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/not pending/i);
  });

});
