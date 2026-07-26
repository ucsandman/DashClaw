import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashClaw } from '../../sdk/dashclaw.js';

describe('SDK plan methods', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sdk = () => new DashClaw({ baseUrl: 'http://dashclaw.test', apiKey: 'oc_live_x', agentId: 'claude-code' });

  it('submitPlan posts to /api/plans with agent_id defaulted from the client', async () => {
    await sdk().submitPlan({ declared_goal: 'ship it', steps: [{ action_type: 'deploy', step_goal: 'push' }] });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/plans');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.agent_id).toBe('claude-code');
    expect(body.declared_goal).toBe('ship it');
  });

  it('resolvePlan posts verdict and step_overrides to /api/plans/:planId', async () => {
    await sdk().resolvePlan('p1', 'approve', { step_overrides: { s1: 'allow' } });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/plans/p1');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.verdict).toBe('approve');
    expect(body.step_overrides).toEqual({ s1: 'allow' });
  });

  it('waitForPlanReview polls until status leaves pending and returns the result', async () => {
    fetchMock
      .mockImplementationOnce(async () => new Response(JSON.stringify({ plan: { status: 'pending' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ plan: { status: 'approved' }, steps: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await sdk().waitForPlanReview('p1', { interval: 0 });
    expect(result.plan.status).toBe('approved');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waitForPlanReview times out with an error', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ plan: { status: 'pending' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(sdk().waitForPlanReview('p1', { timeout: 10, interval: 5 })).rejects.toThrow(/not reviewed within/);
  });
});
