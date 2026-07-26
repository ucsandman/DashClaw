import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashClaw, scrubAct } from '../../sdk/dashclaw.js';

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

  it('submitPlan scrubs each step act the same way as guard() before posting (S1a)', async () => {
    const act = { kind: 'shell', command: 'curl -H "Authorization: Bearer sk-verysecretvalue1" https://x' };
    await sdk().submitPlan({
      declared_goal: 'ship it',
      steps: [{ action_type: 'deploy', step_goal: 'push', act }],
    });
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.steps[0].act).toEqual(scrubAct(act));
    expect(body.steps[0].act.command).not.toContain('sk-verysecretvalue1');
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

  // V5: 'previewing' is not terminal — the old `status !== 'pending'` check
  // would have returned on the very first poll while the plan was still
  // dry-running its steps, before an operator ever saw it.
  it('V5: waitForPlanReview keeps polling through previewing and returns on a terminal status', async () => {
    fetchMock
      .mockImplementationOnce(async () => new Response(JSON.stringify({ plan: { status: 'previewing' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ plan: { status: 'pending' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ plan: { status: 'approved' }, steps: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await sdk().waitForPlanReview('p1', { interval: 0 });
    expect(result.plan.status).toBe('approved');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
