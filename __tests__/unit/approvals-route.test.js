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
const mockFireWebhooksForApproval = vi.fn(() => Promise.resolve());

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: () => {} };
});
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
vi.mock('../../app/lib/repositories/actions.repository.js', () => ({
  recordApproval: (...a) => mockRecordApproval(...a),
  getActionStatus: (...a) => mockGetActionStatus(...a),
  getActionSummary: (...a) => mockGetActionSummary(...a),
}));
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
});
