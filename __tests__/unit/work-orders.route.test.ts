import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSql: vi.fn(() => vi.fn()),
  getOrgId: vi.fn(() => 'org_1'),
  evaluateGuard: vi.fn(),
  createActionRecord: vi.fn(async () => ({ action_id: 'act_approval' })),
  createArtifact: vi.fn(async () => ({ artifact_id: 'art_1' })),
  repo: {
    ensureSeedTypes: vi.fn(async () => {}),
    getWorkOrderType: vi.fn(),
    createWorkOrder: vi.fn(),
    listWorkOrders: vi.fn(async () => ({ work_orders: [], total: 0 })),
    getWorkOrder: vi.fn(),
    getWorkOrderReceipt: vi.fn(async () => null),
    claimNextWorkOrder: vi.fn(async () => null),
    transitionWorkOrder: vi.fn(),
    sweepExpiredLeases: vi.fn(async () => []),
    sweepApprovalReleases: vi.fn(async () => []),
    createWorkOrderReceipt: vi.fn(async () => ({ id: 'wor_1' })),
  },
}));

vi.mock('@/lib/db.js', () => ({ getSql: mocks.getSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mocks.getOrgId }));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: mocks.evaluateGuard }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ createActionRecord: mocks.createActionRecord }));
vi.mock('@/lib/repositories/artifacts.repository.js', () => ({ createArtifact: mocks.createArtifact }));
vi.mock('@/lib/repositories/work-orders.repository.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, ...mocks.repo }; // keep assertTransition/RESEARCH_BRIEF_SEED real
});

import { GET as listGET, POST as submitPOST } from '@/api/work-orders/route.js';
import { POST as completePOST } from '@/api/work-orders/[workOrderId]/complete/route.js';

const TYPE_ROW = {
  type: 'research_brief', version: '1.0', status: 'active',
  input_schema: { type: 'object', required: ['topic'], properties: { topic: { type: 'string', minLength: 3 } } },
  output_schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
  default_max_cost_usd: '0.5', default_timeout_seconds: 600,
};

function req(url: string, init?: RequestInit) {
  return new Request(url, { headers: { 'content-type': 'application/json' }, ...init });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrgId.mockReturnValue('org_1');
  mocks.repo.getWorkOrderType.mockResolvedValue(TYPE_ROW);
  mocks.evaluateGuard.mockResolvedValue({
    decision: 'allow', decision_id: 'act_gd_1', matched_policies: [], risk_score: 10, reason: null,
  });
  mocks.repo.createWorkOrder.mockImplementation(async (_sql: unknown, _org: string, data: { status: string }) => ({
    id: 'wo_new', status: data.status,
  }));
});

describe('POST /api/work-orders', () => {
  it('rejects invalid input with structured per-field 400', async () => {
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'ab' } }),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_failed');
    expect(body.details[0].field).toBe('topic');
  });

  it('rejects missing/invalid budget with 422', async () => {
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST',
      body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' }, budget: { max_cost_usd: 0 } }),
    }));
    expect(res.status).toBe(422);
  });

  it('queues on allow and returns 201 with guard info', async () => {
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' } }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.guard.decision).toBe('allow');
  });

  it('persists a blocked order on guard block', async () => {
    mocks.evaluateGuard.mockResolvedValue({ decision: 'block', decision_id: 'act_gd_2', matched_policies: ['p1'], risk_score: 90, reason: 'nope' });
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' } }),
    }));
    const body = await res.json();
    expect(body.status).toBe('blocked');
    expect(mocks.repo.createWorkOrder.mock.calls[0]![2].status).toBe('blocked');
  });

  it('parks pending_approval and creates the approval action record', async () => {
    mocks.evaluateGuard.mockResolvedValue({ decision: 'require_approval', decision_id: 'act_gd_3', matched_policies: ['p2'], risk_score: 70, reason: 'high cost' });
    const res = await submitPOST(req('http://x/api/work-orders', {
      method: 'POST', body: JSON.stringify({ type: 'research_brief', input: { topic: 'agent rails' } }),
    }));
    const body = await res.json();
    expect(body.status).toBe('pending_approval');
    expect(mocks.createActionRecord).toHaveBeenCalled();
  });
});

describe('GET /api/work-orders', () => {
  it('sweeps lazily then lists', async () => {
    const res = await listGET(req('http://x/api/work-orders?status=queued'));
    expect(res.status).toBe(200);
    expect(mocks.repo.sweepExpiredLeases).toHaveBeenCalled();
    expect(mocks.repo.sweepApprovalReleases).toHaveBeenCalled();
  });
});

describe('POST /api/work-orders/:id/complete', () => {
  const CLAIMED = {
    id: 'wo_1', org_id: 'org_1', type: 'research_brief', type_version: '1.0', status: 'claimed',
    claimed_by: 'worker-1', max_cost_usd: '0.5', timeout_seconds: 600, input_hash: 'sha256:i',
    created_at: '2026-06-11T00:00:00Z', claimed_at: '2026-06-11T00:00:05Z',
  };

  it('rejects non-claim-holder with 403', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'intruder', output: { title: 't' } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(403);
  });

  it('rejects output-contract violations with 422 and leaves the order claimed', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'worker-1', output: { nope: true } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('output_contract_violation');
    expect(mocks.repo.transitionWorkOrder).not.toHaveBeenCalled();
  });

  it('builds receipt + audit record on valid completion', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    mocks.repo.transitionWorkOrder.mockResolvedValue({ ...CLAIMED, status: 'completed', completed_at: '2026-06-11T00:01:00Z' });
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'worker-1', output: { title: 'T' }, cost: { total_usd: 0.12 } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.receipt_hash).toBeTruthy();
    expect(mocks.createActionRecord).toHaveBeenCalled();
    expect(mocks.repo.createWorkOrderReceipt).toHaveBeenCalled();
  });
});
