import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashClaw } from '../../sdk/dashclaw.js';

describe('SDK audit regressions', () => {
  let claw;

  beforeEach(() => {
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
    vi.spyOn(claw, 'guard').mockResolvedValue({
      decision: 'allow',
      recorded: true,
      action_id: 'act_1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not turn completion-report uncertainty into a failed callback report', async () => {
    vi.spyOn(claw, '_patch').mockImplementation(async (_path, body) => ({
      claimed: true,
      action_id: 'act_1',
      attempt_id: body.attempt_id,
    }));
    const outcome = vi.spyOn(claw, 'reportActionOutcome')
      .mockRejectedValueOnce(new Error('completion response lost'))
      .mockResolvedValueOnce({});
    const callback = vi.fn().mockResolvedValue('external effect completed');

    const error = await claw.runGoverned(
      { kind: 'shell', command: 'deploy-safe-fixture' },
      { action_type: 'deploy', declared_goal: 'deploy fixture' },
      callback,
    ).catch((caught) => caught);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledWith('act_1', { status: 'completed' });
    expect(error).toMatchObject({ name: 'OutcomeConfirmationError', actionId: 'act_1' });
  });

  it('claims the exact scrubbed act before executing the callback', async () => {
    const claimCalls = [];
    vi.spyOn(claw, '_patch').mockImplementation(async (path, body) => {
      claimCalls.push({ path, body });
      return { claimed: true, action_id: 'act_1', attempt_id: body.attempt_id };
    });
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const callback = vi.fn().mockResolvedValue('done');

    await claw.runGoverned(
      { kind: 'shell', command: 'echo token=oc_live_fixture' },
      { action_type: 'other', declared_goal: 'run fixture', client_capabilities: ['custom'] },
      callback,
    );

    expect(claw.guard).toHaveBeenCalledWith(
      expect.objectContaining({ client_capabilities: ['custom', 'execution_claims'] }),
      { record: true },
    );
    expect(claimCalls).toHaveLength(1);
    expect(claimCalls[0].path).toBe('/api/actions/act_1');
    expect(claimCalls[0].body).toMatchObject({
      claim_execution: true,
      agent_id: 'agent-1',
      act: { kind: 'shell', command: 'echo token=[REDACTED]' },
    });
    expect(claimCalls[0].body.attempt_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('refuses to execute when the claim response is missing exact confirmation', async () => {
    vi.spyOn(claw, '_patch').mockResolvedValue({ claimed: true, action_id: 'act_OTHER', attempt_id: 'wrong' });
    vi.spyOn(claw, 'reportActionOutcome').mockResolvedValue({});
    const callback = vi.fn();

    const error = await claw.runGoverned(
      { kind: 'shell', command: 'echo safe' },
      { action_type: 'other', declared_goal: 'run fixture' },
      callback,
    ).catch((caught) => caught);

    expect(error).toMatchObject({ name: 'ExecutionClaimError', actionId: 'act_1' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not retry or execute after a lost claim response from an old server', async () => {
    const missingClaimEndpoint = Object.assign(new Error('not found'), { status: 404 });
    const claim = vi.spyOn(claw, '_patch').mockRejectedValue(missingClaimEndpoint);
    const callback = vi.fn();

    const error = await claw.runGoverned(
      { kind: 'shell', command: 'echo safe' },
      { action_type: 'other', declared_goal: 'run fixture' },
      callback,
    ).catch((caught) => caught);

    expect(claim).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
    expect(error).toMatchObject({ name: 'ExecutionClaimError', actionId: 'act_1' });
    expect(error.message).toContain('upgrade DashClaw');
  });

  it('starts authoritative polling while the SSE stream remains open', async () => {
    let releaseSSE;
    const sseGate = new Promise((resolve) => { releaseSSE = resolve; });
    vi.spyOn(claw, '_waitForApprovalViaSSE').mockReturnValue(sseGate);
    const poll = vi.spyOn(claw, '_pollForApproval').mockResolvedValue({
      action: { action_id: 'act_1', status: 'running', approved_by: 'operator-1' },
    });

    const waiting = claw.waitForApproval('act_1', { timeout: 5000, interval: 25 });
    try {
      await Promise.resolve();
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      releaseSSE(null);
      await waiting;
    }
  });
});
