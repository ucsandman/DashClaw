// __tests__/unit/approval-surfaces-flood.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEval, mockNotify, mockTelegram, mockDiscord, mockWebhooks, afterCalls } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockNotify: vi.fn(async () => {}),
  mockTelegram: vi.fn(async () => {}),
  mockDiscord: vi.fn(async () => {}),
  mockWebhooks: vi.fn(async () => {}),
  afterCalls: [],
}));
vi.mock('next/server', () => ({ after: (fn) => { afterCalls.push(fn); } }));
vi.mock('../../app/lib/approval-flood', () => ({
  evaluateApprovalFlood: mockEval,
  notifyNewFloods: mockNotify,
  getInterruptBudget: vi.fn(async () => ({ perPolicy: 10, windowMin: 15, fleetWide: 30 })),
  matchedPolicyIds: (gd) => (Array.isArray(gd?.matched_policies) ? gd.matched_policies : []),
}));
vi.mock('../../app/lib/telegramApprovals', () => ({ fireTelegramApproval: mockTelegram }));
vi.mock('../../app/lib/discordApprovals', () => ({ fireDiscordApproval: mockDiscord }));
vi.mock('../../app/lib/webhooks', () => ({ fireWebhooksForApproval: mockWebhooks }));

import { fireApprovalSurfaces } from '../../app/lib/approvalSurfaces';

const action = { status: 'pending_approval', action_id: 'act_1' };

beforeEach(() => { vi.clearAllMocks(); afterCalls.length = 0; });

async function drainAfter() { for (const fn of afterCalls.splice(0)) await fn(); }

describe('fireApprovalSurfaces flood gating', () => {
  it('fires per-action prompts when not flooding', async () => {
    mockEval.mockResolvedValue({ state: {}, suppressed: new Set(), newlyTripped: [], fleetTripped: false });
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockTelegram).toHaveBeenCalled();
    expect(mockDiscord).toHaveBeenCalled();
    expect(mockWebhooks).toHaveBeenCalled();
  });

  it('suppresses prompts (not webhooks) when a matched policy is tripped', async () => {
    mockEval.mockResolvedValue({ state: {}, suppressed: new Set(['gp_a']), newlyTripped: [], fleetTripped: false });
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockTelegram).not.toHaveBeenCalled();
    expect(mockDiscord).not.toHaveBeenCalled();
    expect(mockWebhooks).toHaveBeenCalled();
  });

  it('sends the flood notification exactly when newly tripped', async () => {
    mockEval.mockResolvedValue({ state: {}, suppressed: new Set(['gp_a']), newlyTripped: [{ policy_id: 'gp_a', count: 47 }], fleetTripped: false });
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('fails open to per-action prompts when the flood check throws', async () => {
    mockEval.mockRejectedValue(new Error('boom'));
    fireApprovalSurfaces(action, {}, 'org1', { matched_policies: ['gp_a'] });
    await drainAfter();
    expect(mockTelegram).toHaveBeenCalled();
  });
});
