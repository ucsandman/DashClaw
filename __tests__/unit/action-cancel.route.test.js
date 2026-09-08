import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgRole,
  mockGetUserId,
  mockLogActivity,
  mockPublishOrgEvent,
  mockScanSensitiveData,
  mockCancelAction,
  mockGetActionCancelFacts,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgRole: vi.fn(),
  mockGetUserId: vi.fn(),
  mockLogActivity: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn(),
  mockCancelAction: vi.fn(),
  mockGetActionCancelFacts: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: () => 'org_test',
  getOrgRole: mockGetOrgRole,
  getUserId: mockGetUserId,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/repositories/actions.repository.execution.js', () => ({
  cancelAction: mockCancelAction,
  getActionCancelFacts: mockGetActionCancelFacts,
}));

import { POST } from '@/api/actions/[actionId]/cancel/route.js';

const routeCtx = { params: Promise.resolve({ actionId: 'act_1' }) };

function req(body) {
  return makeRequest('http://localhost/api/actions/act_1/cancel', {
    headers: { 'x-org-id': 'org_test' },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockScanSensitiveData.mockReturnValue({ clean: true, redacted: undefined, findings: [] });
  mockPublishOrgEvent.mockResolvedValue(undefined);
  mockLogActivity.mockResolvedValue(undefined);
  mockGetOrgRole.mockReturnValue('admin');
  mockGetUserId.mockReturnValue('admin_1');
  // Default: a never-executed action owned by agent_1.
  mockGetActionCancelFacts.mockResolvedValue({
    action_id: 'act_1',
    agent_id: 'agent_1',
    status: 'running',
    outcome_status: 'pending',
    claimed: false,
  });
  mockCancelAction.mockResolvedValue({
    ok: true,
    action_id: 'act_1',
    agent_id: 'agent_1',
    status: 'cancelled',
  });
});

describe('POST /api/actions/[actionId]/cancel', () => {
  it('cancels with a reason, audits, and publishes the update', async () => {
    const res = await POST(req({ reason: 'probe never executed the destructive branch' }), routeCtx);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, action_id: 'act_1', status: 'cancelled' });
    expect(mockCancelAction).toHaveBeenCalledWith(mockSql, {
      orgId: 'org_test',
      actionId: 'act_1',
      reason: 'probe never executed the destructive branch',
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity.mock.calls[0][0]).toMatchObject({
      action: 'action.cancelled',
      resourceId: 'act_1',
    });
    expect(mockPublishOrgEvent).toHaveBeenCalledWith('action.updated', {
      orgId: 'org_test',
      action: { action_id: 'act_1', status: 'cancelled', close_source: 'direct' },
    });
  });

  it('requires a reason', async () => {
    const res = await POST(req({ reason: '   ' }), routeCtx);
    expect(res.status).toBe(400);
    expect(mockCancelAction).not.toHaveBeenCalled();
  });

  it('returns 404 when the action is unknown', async () => {
    mockGetActionCancelFacts.mockResolvedValue(null);

    const res = await POST(req({ reason: 'x' }), routeCtx);

    expect(res.status).toBe(404);
    expect(mockCancelAction).not.toHaveBeenCalled();
  });

  it('lets the owning agent cancel its own never-executed action', async () => {
    mockGetOrgRole.mockReturnValue('member');
    mockGetUserId.mockReturnValue('agent_1');

    const res = await POST(req({ reason: 'aborted before execution' }), routeCtx);

    expect(res.status).toBe(200);
  });

  it('rejects a non-owner non-admin with 403', async () => {
    mockGetOrgRole.mockReturnValue('member');
    mockGetUserId.mockReturnValue('agent_other');

    const res = await POST(req({ reason: 'x' }), routeCtx);

    expect(res.status).toBe(403);
    expect(mockCancelAction).not.toHaveBeenCalled();
  });

  it('returns 409 with claim details when the action already executed', async () => {
    mockCancelAction.mockResolvedValue({
      ok: false,
      code: 'NOT_CANCELLABLE',
      action_id: 'act_1',
      agent_id: 'agent_1',
      status: 'completed',
      outcome_status: 'completed',
      claimed: true,
    });

    const res = await POST(req({ reason: 'x' }), routeCtx);

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data).toMatchObject({ code: 'NOT_CANCELLABLE', current_status: 'completed', execution_claimed: true });
    expect(mockPublishOrgEvent).not.toHaveBeenCalled();
  });

  it('redacts sensitive content in the reason before persisting', async () => {
    mockScanSensitiveData.mockReturnValue({
      clean: false,
      redacted: 'token [REDACTED]',
      findings: [{ severity: 'critical', category: 'secret' }],
    });

    const res = await POST(req({ reason: 'token abc123' }), routeCtx);

    expect(res.status).toBe(200);
    expect(mockCancelAction.mock.calls[0][1].reason).toBe('token [REDACTED]');
    const data = await res.json();
    expect(data.security).toMatchObject({ clean: false, findings_count: 1 });
  });
});
