import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSql: vi.fn(() => vi.fn()),
  getOrgId: vi.fn(() => 'org_1'),
  evaluateGuard: vi.fn(),
  createActionRecord: vi.fn(async () => ({ action_id: 'act_approval' })),
  createArtifact: vi.fn(async () => ({ artifact_id: 'art_1' })),
  listArtifacts: vi.fn(async () => ({ artifacts: [], total: 0 })),
  upsertSignalSnapshots: vi.fn(async () => {}),
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
vi.mock('@/lib/org.js', () => ({ getOrgId: mocks.getOrgId, getUserId: () => 'key_test1' }));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: mocks.evaluateGuard }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ createActionRecord: mocks.createActionRecord }));
vi.mock('@/lib/repositories/artifacts.repository.js', () => ({
  createArtifact: mocks.createArtifact,
  listArtifacts: mocks.listArtifacts,
}));
vi.mock('@/lib/repositories/signals.repository.js', () => ({ upsertSignalSnapshots: mocks.upsertSignalSnapshots }));
vi.mock('@/lib/repositories/work-orders.repository.js', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, ...mocks.repo }; // keep assertTransition/RESEARCH_BRIEF_SEED real
});

import { GET as listGET, POST as submitPOST } from '@/api/work-orders/route.js';
import { POST as completePOST } from '@/api/work-orders/[workOrderId]/complete/route.js';
import { GET as artifactsGET } from '@/api/work-orders/[workOrderId]/artifacts/route.js';

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

  it('returns 409 and skips audit+receipt when transitionWorkOrder loses a race', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    mocks.repo.transitionWorkOrder.mockResolvedValue(null);
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'worker-1', output: { title: 'T' } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('not_claimed');
    expect(mocks.createActionRecord).not.toHaveBeenCalled();
    expect(mocks.repo.createWorkOrderReceipt).not.toHaveBeenCalled();
  });

  it('returns 200 with over_budget=true and fires signals when cost exceeds ceiling', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(CLAIMED);
    mocks.repo.transitionWorkOrder.mockResolvedValue({ ...CLAIMED, status: 'completed', completed_at: '2026-06-11T00:01:00Z' });
    const res = await completePOST(
      req('http://x/api/work-orders/wo_1/complete', { method: 'POST', body: JSON.stringify({ status: 'completed', agent_id: 'worker-1', output: { title: 'T' }, cost: { total_usd: 9.99 } }) }),
      { params: Promise.resolve({ workOrderId: 'wo_1' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receipt.receipt.over_budget).toBe(true);
    expect(mocks.upsertSignalSnapshots).toHaveBeenCalled();
  });
});

describe('GET /api/work-orders/:id/artifacts', () => {
  const COMPLETED = {
    id: 'wo_2', org_id: 'org_1', type: 'research_brief', type_version: '1.0', status: 'completed',
    claimed_by: 'worker-1', max_cost_usd: '0.5', timeout_seconds: 600, input_hash: 'sha256:i',
    created_at: '2026-06-11T00:00:00Z', claimed_at: '2026-06-11T00:00:05Z',
  };

  it('queries listArtifacts by audit_record_id when receipt is present', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(COMPLETED);
    mocks.repo.getWorkOrderReceipt.mockResolvedValue({
      id: 'wor_1', org_id: 'org_1', work_order_id: 'wo_2',
      receipt: { governance: { audit_record_id: 'act_y', mode: 'governed', matched_policies: [] } },
    } as unknown as null);
    mocks.listArtifacts.mockResolvedValue({ artifacts: [{ artifact_id: 'art_z' }], total: 1 } as unknown as never);

    const res = await artifactsGET(
      req('http://x/api/work-orders/wo_2/artifacts'),
      { params: Promise.resolve({ workOrderId: 'wo_2' }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.artifacts).toHaveLength(1);
    expect(mocks.listArtifacts).toHaveBeenCalledWith(
      expect.anything(), 'org_1', expect.objectContaining({ action_id: 'act_y', limit: 100 }),
    );
  });

  it('returns empty list without calling listArtifacts when order has no receipt', async () => {
    mocks.repo.getWorkOrder.mockResolvedValue(COMPLETED);
    mocks.repo.getWorkOrderReceipt.mockResolvedValue(null);

    const res = await artifactsGET(
      req('http://x/api/work-orders/wo_2/artifacts'),
      { params: Promise.resolve({ workOrderId: 'wo_2' }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ artifacts: [], total: 0 });
    expect(mocks.listArtifacts).not.toHaveBeenCalled();
  });
});
