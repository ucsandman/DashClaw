import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashClaw } from '../../sdk/dashclaw.js';

describe('SDK delegation-constraint methods', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 'gp_1' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sdk = () => new DashClaw({ baseUrl: 'http://dashclaw.test', apiKey: 'oc_live_x', agentId: 'claude-code' });

  it('createDelegationConstraint posts a delegation_constraint policy to /api/policies', async () => {
    const rules = { parent: 'claude-code', child_types: ['*'], max_risk_score: 40, escalate_action: 'require_approval' };
    await sdk().createDelegationConstraint(rules);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/policies');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.policy_type).toBe('delegation_constraint');
    expect(body.rules).toEqual(rules);
    expect(body.active).toBe(true);
    expect(body.name).toBe('Delegation constraint');
    expect(body.agent_ids).toBeUndefined();
  });

  it('createDelegationConstraint accepts an opts.name override', async () => {
    await sdk().createDelegationConstraint({ parent: '*' }, { name: 'ceiling' });
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.name).toBe('ceiling');
  });

  it('createDelegationConstraint includes agent_ids only when given', async () => {
    await sdk().createDelegationConstraint({ parent: '*' }, { agent_ids: ['claude-code', 'claude-code:explore'] });
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.agent_ids).toEqual(['claude-code', 'claude-code:explore']);
  });
});
