import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetActionOutcome,
  mockSetActionOutcome,
  mockGetActionStatus,
  mockPublishOrgEvent,
  mockScanSensitiveData,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActionOutcome: vi.fn(),
  mockSetActionOutcome: vi.fn(),
  mockGetActionStatus: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getActionOutcome: mockGetActionOutcome,
  setActionOutcome: mockSetActionOutcome,
  getActionStatus: mockGetActionStatus,
}));

import { GET, POST } from '@/api/actions/[actionId]/outcome/route.js';

const routeCtx = { params: Promise.resolve({ actionId: 'act_1' }) };

function req(body) {
  return makeRequest('http://localhost/api/actions/act_1/outcome', {
    headers: { 'x-org-id': 'org_test' },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockScanSensitiveData.mockReturnValue({ clean: true, redacted: undefined, findings: [] });
  mockPublishOrgEvent.mockResolvedValue(undefined);
  // Default: a legitimately-running action.
  mockGetActionStatus.mockResolvedValue({ status: 'running', agent_id: 'a1' });
});

describe('/api/actions/[actionId]/outcome GET', () => {
  it('returns the current outcome', async () => {
    mockGetActionOutcome.mockResolvedValue({
      action_id: 'act_1',
      status: 'completed',
      outcome_at: '2026-05-13T00:00:00Z',
      summary: 'shipped',
      error_message: null,
      progress: null,
      elapsed_ms: 1234,
    });

    const res = await GET(req(), routeCtx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.elapsed_ms).toBe(1234);
  });

  it('returns 404 when the action does not exist', async () => {
    mockGetActionOutcome.mockResolvedValue(null);
    const res = await GET(req(), routeCtx);
    expect(res.status).toBe(404);
  });

  it('returns pending outcome with elapsed_ms still ticking', async () => {
    mockGetActionOutcome.mockResolvedValue({
      action_id: 'act_1',
      status: 'pending',
      outcome_at: null,
      summary: null,
      error_message: null,
      progress: null,
      elapsed_ms: 5000,
    });
    const res = await GET(req(), routeCtx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.elapsed_ms).toBe(5000);
  });
});

describe('/api/actions/[actionId]/outcome POST', () => {
  const outcomeRow = {
    action_id: 'act_1',
    status: 'completed',
    outcome_at: '2026-05-13T00:00:00Z',
    summary: 'shipped',
    error_message: null,
    progress: null,
    elapsed_ms: 1234,
  };

  it('records a completed outcome', async () => {
    mockSetActionOutcome.mockResolvedValue({ ok: true, outcome: outcomeRow });

    const res = await POST(req({ status: 'completed', summary: 'shipped' }), routeCtx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.outcome.status).toBe('completed');
    // The envelope must carry an `action` key: the SSE serializer reads
    // payload.action, so an envelope without it serializes to `data: null` and
    // every terminal-outcome frame is dropped by live consumers.
    expect(mockPublishOrgEvent).toHaveBeenCalledWith(
      'action.updated',
      expect.objectContaining({
        orgId: 'org_test',
        action: expect.objectContaining({ action_id: 'act_1', status: 'completed' }),
      }),
    );
  });

  it('rejects an outcome on a blocked action (R10)', async () => {
    mockGetActionStatus.mockResolvedValue({ status: 'blocked', agent_id: 'a1' });
    const res = await POST(req({ status: 'completed', summary: 'faked' }), routeCtx);
    expect(res.status).toBe(409);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('rejects an outcome on a not-yet-approved action (R10)', async () => {
    mockGetActionStatus.mockResolvedValue({ status: 'pending_approval', agent_id: 'a1' });
    const res = await POST(req({ status: 'completed' }), routeCtx);
    expect(res.status).toBe(409);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('returns 404 when the action does not exist (lifecycle gate)', async () => {
    mockGetActionStatus.mockResolvedValue(null);
    const res = await POST(req({ status: 'completed' }), routeCtx);
    expect(res.status).toBe(404);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid status', async () => {
    const res = await POST(req({ status: 'banana' }), routeCtx);
    expect(res.status).toBe(400);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('rejects lost_confirmation from agents (sweep-only)', async () => {
    const res = await POST(req({ status: 'lost_confirmation' }), routeCtx);
    expect(res.status).toBe(400);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('requires error_message when status=failed', async () => {
    const res = await POST(req({ status: 'failed' }), routeCtx);
    expect(res.status).toBe(400);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('requires progress object when status=partial', async () => {
    const res = await POST(req({ status: 'partial' }), routeCtx);
    expect(res.status).toBe(400);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('accepts partial with valid progress object', async () => {
    mockSetActionOutcome.mockResolvedValue({
      ok: true,
      outcome: { ...outcomeRow, status: 'partial', progress: { step: 2 } },
    });
    const res = await POST(req({ status: 'partial', progress: { step: 2 } }), routeCtx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.outcome.status).toBe('partial');
  });

  it('returns 409 when outcome is already terminal', async () => {
    mockSetActionOutcome.mockResolvedValue({
      ok: false,
      reason: 'conflict',
      current_status: 'completed',
    });
    const res = await POST(req({ status: 'completed' }), routeCtx);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.current_status).toBe('completed');
  });

  it('returns 404 when action is in a different org', async () => {
    mockSetActionOutcome.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await POST(req({ status: 'completed' }), routeCtx);
    expect(res.status).toBe(404);
  });

  it('rejects oversized progress payload', async () => {
    const bigStr = 'x'.repeat(10000);
    const res = await POST(req({ status: 'partial', progress: { big: bigStr } }), routeCtx);
    expect(res.status).toBe(400);
    expect(mockSetActionOutcome).not.toHaveBeenCalled();
  });

  it('redacts secret-shaped strings from summary before persisting', async () => {
    mockScanSensitiveData.mockReturnValue({
      clean: false,
      redacted: '[REDACTED]',
      findings: [{ severity: 'critical', category: 'api_key' }],
    });
    mockSetActionOutcome.mockResolvedValue({ ok: true, outcome: outcomeRow });

    const res = await POST(req({ status: 'completed', summary: 'sk-secret-string' }), routeCtx);
    expect(res.status).toBe(200);
    expect(mockSetActionOutcome).toHaveBeenCalledWith(
      mockSql,
      'org_test',
      'act_1',
      expect.objectContaining({ summary: '[REDACTED]' }),
    );
    const data = await res.json();
    expect(data.security.clean).toBe(false);
    expect(data.security.critical_count).toBe(1);
  });
});
