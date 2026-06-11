import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
}

describe('DashClaw — Work Orders SDK wrappers', () => {
  let claw;
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });

  it('submitWorkOrder POSTs to /api/work-orders with requested_by defaulting to agentId', async () => {
    await claw.submitWorkOrder({ type: 'research_brief', input: { topic: 'agent rails' } });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/work-orders');
    expect(c.body.type).toBe('research_brief');
    expect(c.body.requested_by).toBe('agent-1');
  });

  it('submitWorkOrder respects an explicit requested_by override', async () => {
    await claw.submitWorkOrder({ type: 'research_brief', input: { topic: 'x' }, requested_by: 'orchestrator-2' });
    expect(lastCall().body.requested_by).toBe('orchestrator-2');
  });

  it('submitWorkOrder passes budget when provided', async () => {
    await claw.submitWorkOrder({ type: 'research_brief', input: { topic: 'x' }, budget: { max_cost_usd: 0.5, timeout_seconds: 120 } });
    const c = lastCall();
    expect(c.body.budget).toEqual({ max_cost_usd: 0.5, timeout_seconds: 120 });
  });

  it('getWorkOrder GETs /api/work-orders/:id', async () => {
    await claw.getWorkOrder('wo_abc');
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/work-orders/wo_abc');
  });

  it('listWorkOrders GETs /api/work-orders with filters serialized as query params', async () => {
    await claw.listWorkOrders({ status: 'queued', limit: 20 });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/work-orders?status=queued&limit=20');
  });

  it('listWorkOrders GETs /api/work-orders with no params when called empty', async () => {
    await claw.listWorkOrders();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/work-orders');
  });

  it('cancelWorkOrder sends DELETE to /api/work-orders/:id', async () => {
    await claw.cancelWorkOrder('wo_xyz');
    const c = lastCall();
    expect(c.method).toBe('DELETE');
    expect(c.url).toBe('http://localhost:3000/api/work-orders/wo_xyz');
  });

  it('claimWorkOrder POSTs to /api/work-orders/claim with agent_id defaulting to agentId', async () => {
    await claw.claimWorkOrder();
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/work-orders/claim');
    expect(c.body.agent_id).toBe('agent-1');
    expect(c.body.types).toBeNull();
  });

  it('claimWorkOrder passes types and agent_id overrides', async () => {
    await claw.claimWorkOrder({ types: ['research_brief', 'data_summary'], agent_id: 'worker-7' });
    const c = lastCall();
    expect(c.body.types).toEqual(['research_brief', 'data_summary']);
    expect(c.body.agent_id).toBe('worker-7');
  });

  it('completeWorkOrder POSTs to /api/work-orders/:id/complete with agent_id defaulting to agentId', async () => {
    await claw.completeWorkOrder('wo_abc', { status: 'completed', output: { title: 'T', summary: 'S', findings: [] } });
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/work-orders/wo_abc/complete');
    expect(c.body.status).toBe('completed');
    expect(c.body.agent_id).toBe('agent-1');
    expect(c.body.output.title).toBe('T');
  });

  it('completeWorkOrder respects explicit agent_id and passes cost/error fields', async () => {
    await claw.completeWorkOrder('wo_abc', {
      status: 'failed',
      agent_id: 'worker-5',
      error: { code: 'model_error', message: 'timeout' },
      cost: { input_tokens: 100, output_tokens: 50, total_usd: 0.02 },
    });
    const c = lastCall();
    expect(c.body.agent_id).toBe('worker-5');
    expect(c.body.error.code).toBe('model_error');
    expect(c.body.cost.total_usd).toBe(0.02);
  });

  it('listWorkOrderTypes GETs /api/work-orders/types', async () => {
    await claw.listWorkOrderTypes();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/work-orders/types');
  });

  it('registerWorkOrderType POSTs to /api/work-orders/types with the full definition', async () => {
    const def = {
      type: 'data_summary',
      input_schema: { type: 'object', required: ['dataset'], properties: { dataset: { type: 'string' } } },
      output_schema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
      default_max_cost_usd: 0.1,
    };
    await claw.registerWorkOrderType(def);
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/work-orders/types');
    expect(c.body.type).toBe('data_summary');
    expect(c.body.input_schema.required).toContain('dataset');
    expect(c.body.default_max_cost_usd).toBe(0.1);
  });
});
