import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashClaw, ApprovalDeniedError } from '../../sdk/dashclaw.js';

// SSE-first waitForApproval makes an initial fetch to /api/stream before polling.
// This helper returns a mock response that causes the SSE path to bail out immediately.
function sseUnavailable() {
  return { ok: false, status: 503, headers: new Headers() };
}

describe('HITL Approval Flow', () => {
  let claw;

  beforeEach(() => {
    claw = new DashClaw({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      agentId: 'test-agent'
    });

    // Mock global fetch
    global.fetch = vi.fn();
  });

  it('waitForApproval resolves only on explicit approval metadata', async () => {
    // 1. First poll: pending_approval
    // 2. Second poll: running (without metadata) -> should THROW
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ action: { action_id: 'act_1', status: 'pending_approval' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ action: { action_id: 'act_1', status: 'running' } }) // No approved_by
      });

    await expect(claw.waitForApproval('act_1', { interval: 1, timeout: 100 }))
      .rejects.toThrow(/explicit approval metadata/);
  });

  it('waitForApproval resolves when approved_by is present', async () => {
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ action: { action_id: 'act_1', status: 'pending_approval' } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: {
            action_id: 'act_1',
            status: 'running',
            approved_by: 'usr_123'
          }
        })
      });

    const result = await claw.waitForApproval('act_1', { interval: 1, timeout: 100 });
    expect(result.action.approved_by).toBe('usr_123');
  });

  it('waitForApproval throws ApprovalDeniedError on failed status', async () => {
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: {
            action_id: 'act_1',
            status: 'failed',
            error_message: 'Denied by human'
          }
        })
      });

    await expect(claw.waitForApproval('act_1', { interval: 1, timeout: 100 }))
      .rejects.toThrow(ApprovalDeniedError);
  });

  it('ApprovalDeniedError includes decision property', async () => {
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: {
            action_id: 'act_1',
            status: 'cancelled',
            error_message: 'Operator cancelled.'
          }
        })
      });

    try {
      await claw.waitForApproval('act_1', { interval: 1, timeout: 100 });
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalDeniedError);
      expect(error.decision).toBe('cancelled');
    }
  });

  it('throws timeout error when action stays pending_approval', async () => {
    // mockResolvedValue (not Once) returns the same value for all calls including SSE
    // SSE gets { ok: true, json: ... } with no body, bails out, then polling uses the same default
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ action: { action_id: 'act_2', status: 'pending_approval' } })
    });

    await expect(claw.waitForApproval('act_2', { interval: 1, timeout: 25 }))
      .rejects.toThrow(/Timed out waiting for approval of action act_2/);
  });

  it('returns immediately when action is already running (never pending)', async () => {
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ action: { action_id: 'act_3', status: 'running' } })
      });

    const result = await claw.waitForApproval('act_3', { interval: 1, timeout: 100 });
    expect(result.action.status).toBe('running');
    expect(fetch).toHaveBeenCalledTimes(2); // 1 SSE + 1 poll
  });

  it('polls multiple cycles before resolving on approval', async () => {
    const pending = {
      ok: true,
      json: async () => ({ action: { action_id: 'act_4', status: 'pending_approval' } })
    };

    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: { action_id: 'act_4', status: 'running', approved_by: 'usr_456' }
        })
      });

    const result = await claw.waitForApproval('act_4', { interval: 1, timeout: 5000 });
    expect(result.action.approved_by).toBe('usr_456');
    expect(fetch).toHaveBeenCalledTimes(5); // 1 SSE + 4 polls
  });

  it('propagates network errors from polling fetch', async () => {
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockRejectedValueOnce(new Error('Network failure'));

    await expect(claw.waitForApproval('act_5', { interval: 1, timeout: 100 }))
      .rejects.toThrow('Network failure');
  });

  it('throws ApprovalDeniedError with the note the operator typed on cancelled status', async () => {
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: {
            action_id: 'act_6',
            status: 'cancelled',
            approval_expires_at: '2026-11-25T21:00:00.000Z',
            reasoning: 'Buy the domain.\n\n[HITL Decision: DENY by usr_1]\nReason: Budget limit exceeded'
          }
        })
      });

    await expect(claw.waitForApproval('act_6', { interval: 1, timeout: 100 }))
      .rejects.toThrow(ApprovalDeniedError);

    try {
      fetch
        .mockResolvedValueOnce(sseUnavailable())
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            action: {
              action_id: 'act_6',
              status: 'cancelled',
              approval_expires_at: '2026-11-25T21:00:00.000Z',
              reasoning: 'Buy the domain.\n\n[HITL Decision: DENY by usr_1]\nReason: Budget limit exceeded'
            }
          })
        });
      await claw.waitForApproval('act_6', { interval: 1, timeout: 100 });
    } catch (error) {
      expect(error.message).toBe('Budget limit exceeded');
      expect(error.decision).toBe('cancelled');
    }
  });

  it('polling fallback returns the full action object (open_loops, assumptions), matching the SSE path', async () => {
    // GET /api/actions/:id returns { action, open_loops, assumptions,
    // message_summary }. The polling fallback must resolve to that full shape,
    // not just { action }, so consumers get the same data whether or not SSE
    // was available.
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: { action_id: 'act_full', status: 'running', approved_by: 'usr_1' },
          open_loops: [{ id: 'loop_1' }],
          assumptions: [{ id: 'asm_1' }],
          message_summary: { count: 2 },
        }),
      });

    const result = await claw.waitForApproval('act_full', { interval: 1, timeout: 100 });
    expect(result.action.approved_by).toBe('usr_1');
    expect(result.open_loops).toEqual([{ id: 'loop_1' }]);
    expect(result.assumptions).toEqual([{ id: 'asm_1' }]);
    expect(result.message_summary).toEqual({ count: 2 });
  });

  it('works with default options when no options object is provided', async () => {
    fetch
      .mockResolvedValueOnce(sseUnavailable())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          action: { action_id: 'act_7', status: 'running' }
        })
      });

    const result = await claw.waitForApproval('act_7');
    expect(result.action.status).toBe('running');
  });
});
