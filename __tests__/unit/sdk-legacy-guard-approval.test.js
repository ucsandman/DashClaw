import { beforeEach, describe, expect, it, vi } from 'vitest';
// DEPRECATED SURFACE UNDER TEST: `dashclaw/legacy` (dashclaw-v1.js) is deprecated
// and scheduled for removal in v5.0.0. These tests prove the deprecated-but-live
// legacy surface still functions — do not extend the legacy SDK; build new work
// against the canonical client.
import { DashClaw, GuardBlockedError } from '../../sdk/legacy/dashclaw-v1.js';

/**
 * Regression tests for the legacy SDK _guardCheck + createAction HITL path.
 *
 * Bug: _guardCheck used to treat `require_approval` as equivalent to `block`,
 * so in `guardMode: 'enforce'` it threw GuardBlockedError BEFORE the POST to
 * /api/actions, which meant the server never created a pending_approval row
 * and the PWA approval queue was starved.
 *
 * Fix: only `block` triggers warn/enforce paths. `require_approval` falls
 * through so createAction can POST and the server returns
 * status='pending_approval'. Existing HITL behavior (hitlMode='wait' +
 * waitForApproval) continues to work downstream.
 */

function jsonRes(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

function routeFetch(handlers) {
  return vi.fn(async (url, init) => {
    const method = (init?.method || 'GET').toUpperCase();
    // url may be a full URL string — strip the origin to get the pathname
    const pathname = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const key = `${method} ${pathname}`;
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`Unhandled fetch: ${key}`);
    }
    return handler(init);
  });
}

function makeClaw(opts = {}) {
  return new DashClaw({
    baseUrl: 'http://localhost:3000',
    apiKey: 'test-key',
    agentId: 'test-agent',
    ...opts,
  });
}

describe('DashClaw legacy SDK — guard + approval flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('_guardCheck in enforce mode', () => {
    it('still throws GuardBlockedError when guard returns `block`', async () => {
      const claw = makeClaw({ guardMode: 'enforce' });
      global.fetch = routeFetch({
        'POST /api/guard': () => jsonRes({
          decision: 'block',
          action_id: 'a_block_1',
          reasons: ['policy violation'],
        }),
      });

      await expect(
        claw.createAction({
          action_type: 'deploy',
          declared_goal: 'ship v2',
          risk_score: 80,
        })
      ).rejects.toBeInstanceOf(GuardBlockedError);

      // Critically: POST /api/actions must NOT have fired for a hard block.
      const calls = global.fetch.mock.calls.map(([u, i]) => `${i?.method} ${u}`);
      expect(calls.some((c) => c.includes('POST') && c.includes('/api/actions'))).toBe(false);
    });

    it('does NOT throw when guard returns `require_approval` — POST /api/actions proceeds', async () => {
      const claw = makeClaw({ guardMode: 'enforce' });
      let postedBody = null;

      global.fetch = routeFetch({
        'POST /api/guard': () => jsonRes({
          decision: 'require_approval',
          action_id: 'a_req_1',
          reasons: ['risk_score above threshold'],
        }),
        'POST /api/actions': async (init) => {
          postedBody = JSON.parse(init.body);
          return jsonRes({
            action: { id: 'act_pending_1', status: 'pending_approval' },
            action_id: 'act_pending_1',
          });
        },
      });

      const res = await claw.createAction({
        action_type: 'deploy',
        declared_goal: 'ship v2',
        risk_score: 90,
      });

      // POST /api/actions must have fired with the action body
      expect(postedBody).not.toBeNull();
      expect(postedBody.action_type).toBe('deploy');
      expect(postedBody.declared_goal).toBe('ship v2');
      expect(postedBody.agent_id).toBe('test-agent');

      // Server's pending_approval response is returned verbatim
      expect(res.action.status).toBe('pending_approval');
      expect(res.action_id).toBe('act_pending_1');
    });
  });

  describe('createAction — HITL response handling', () => {
    it('returns the pending_approval response immediately when hitlMode is off (default)', async () => {
      const claw = makeClaw({ guardMode: 'enforce' });
      const waitSpy = vi.spyOn(claw, 'waitForApproval');

      global.fetch = routeFetch({
        'POST /api/guard': () => jsonRes({
          decision: 'require_approval',
          action_id: 'a_req_2',
          reasons: [],
        }),
        'POST /api/actions': () => jsonRes({
          action: { id: 'act_pending_2', status: 'pending_approval' },
          action_id: 'act_pending_2',
        }),
      });

      const res = await claw.createAction({
        action_type: 'message',
        declared_goal: 'notify user',
      });

      expect(waitSpy).not.toHaveBeenCalled();
      expect(res.action.status).toBe('pending_approval');
      expect(res.action_id).toBe('act_pending_2');
    });

    it('waits on approval when hitlMode is `wait` and resolves with the approved action', async () => {
      const claw = makeClaw({ guardMode: 'enforce', hitlMode: 'wait' });

      // Stub waitForApproval so we do not depend on the 5s polling interval.
      const approved = {
        action: { id: 'act_pending_3', status: 'running' },
        action_id: 'act_pending_3',
      };
      const waitSpy = vi
        .spyOn(claw, 'waitForApproval')
        .mockResolvedValue(approved);

      global.fetch = routeFetch({
        'POST /api/guard': () => jsonRes({
          decision: 'require_approval',
          action_id: 'a_req_3',
          reasons: ['touches sensitive system'],
        }),
        'POST /api/actions': () => jsonRes({
          action: { id: 'act_pending_3', status: 'pending_approval' },
          action_id: 'act_pending_3',
        }),
      });

      const res = await claw.createAction({
        action_type: 'deploy',
        declared_goal: 'ship v2',
      });

      expect(waitSpy).toHaveBeenCalledTimes(1);
      expect(waitSpy).toHaveBeenCalledWith('act_pending_3');
      expect(res).toBe(approved);
      expect(res.action.status).toBe('running');
    });
  });
});
