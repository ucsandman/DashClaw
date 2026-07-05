import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// The execute route writes the parent action's terminal outcome after
// executeWorkflow returns (or throws). Those writes must be gated on
// status='running' so a concurrent operator cancel (running->cancelled) is not
// clobbered back to completed/failed. These tests lock that the route passes
// { gateStatus: 'running' } on both the success and the throw paths.
const h = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  getWorkflowTemplate: vi.fn(),
  evaluateGuard: vi.fn(),
  getModelStrategy: vi.fn(),
  createActionRecord: vi.fn(),
  createBlockedActionRecord: vi.fn(),
  updateActionOutcome: vi.fn(),
  executeWorkflow: vi.fn(),
  insertStepResult: vi.fn(),
  updateStepResult: vi.fn(),
  createArtifact: vi.fn(),
  checkQuotaFast: vi.fn(),
  getOrgPlan: vi.fn(),
  incrementMeter: vi.fn(),
  scanSensitiveData: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => h.mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test', getUserId: () => 'key_test1' }));
vi.mock('@/lib/apiErrors.js', () => ({
  apiErrorResponse: () => ({ status: 500, json: async () => ({ error: 'internal' }) }),
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: h.evaluateGuard }));
vi.mock('@/lib/repositories/workflow-templates.repository.js', () => ({ getWorkflowTemplate: h.getWorkflowTemplate }));
vi.mock('@/lib/repositories/model-strategies.repository.js', () => ({ getModelStrategy: h.getModelStrategy }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: h.createActionRecord,
  createBlockedActionRecord: h.createBlockedActionRecord,
  updateActionOutcome: h.updateActionOutcome,
}));
vi.mock('@/lib/security.js', () => ({
  scanSensitiveData: h.scanSensitiveData,
  redactAny: function redactAny(value, findings) {
    if (typeof value === 'string') {
      const scan = h.scanSensitiveData(value);
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
vi.mock('@/lib/workflow-executor.js', () => ({ executeWorkflow: h.executeWorkflow }));
vi.mock('@/lib/repositories/workflow-runs.repository.js', () => ({
  insertStepResult: h.insertStepResult,
  updateStepResult: h.updateStepResult,
}));
vi.mock('@/lib/repositories/artifacts.repository.js', () => ({ createArtifact: h.createArtifact }));
vi.mock('@/lib/usage.js', () => ({
  checkQuotaFast: h.checkQuotaFast,
  getOrgPlan: h.getOrgPlan,
  incrementMeter: h.incrementMeter,
}));

import { POST } from '@/api/workflows/templates/[templateId]/execute/route.js';

const ctx = { params: Promise.resolve({ templateId: 'wt_1' }) };
function req(body = {}) {
  return makeRequest('http://localhost/api/workflows/templates/wt_1/execute', {
    headers: { 'x-org-id': 'org_test' },
    body,
  });
}

describe('POST /api/workflows/templates/[templateId]/execute: parent outcome gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getWorkflowTemplate.mockResolvedValue({
      template_id: 'wt_1', slug: 'demo', name: 'Demo', steps: [{ id: 's1' }], model_strategy_id: null,
    });
    h.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    h.getOrgPlan.mockResolvedValue({});
    h.checkQuotaFast.mockResolvedValue({ allowed: true });
    h.createActionRecord.mockResolvedValue(undefined);
    h.updateActionOutcome.mockResolvedValue({ action_id: 'x', status: 'completed' });
    h.incrementMeter.mockResolvedValue(undefined);
    h.scanSensitiveData.mockReturnValue({ clean: true, redacted: '{}', findings: [] });
  });

  it('gates the terminal outcome write on status=running (success path)', async () => {
    h.executeWorkflow.mockResolvedValue({ success: true, result: { ok: 1 }, total_elapsed_ms: 5, steps: [] });
    const res = await POST(req({ agent_id: 'a' }), ctx);
    expect(res.status).toBe(200);
    expect(h.updateActionOutcome).toHaveBeenCalledTimes(1);
    const [, , , fields, opts] = h.updateActionOutcome.mock.calls[0];
    expect(fields.status).toBe('completed');
    expect(opts).toEqual({ gateStatus: 'running' });
  });

  it('on executeWorkflow throw, marks the parent failed (gated) and propagates a 500', async () => {
    h.executeWorkflow.mockRejectedValue(new Error('mid-run db fail'));
    const res = await POST(req({ agent_id: 'a' }), ctx);
    expect(res.status).toBe(500);
    expect(h.updateActionOutcome).toHaveBeenCalledTimes(1);
    const [, , , fields, opts] = h.updateActionOutcome.mock.calls[0];
    expect(fields.status).toBe('failed');
    expect(opts).toEqual({ gateStatus: 'running' });
  });
});
