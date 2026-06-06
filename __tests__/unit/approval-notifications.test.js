import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRecord, mockListOpen, mockMarkCleared } = vi.hoisted(() => ({
  mockRecord: vi.fn(async () => {}),
  mockListOpen: vi.fn(),
  mockMarkCleared: vi.fn(async () => {}),
}));

vi.mock('@/lib/repositories/approval-notifications.repository.js', () => ({
  recordApprovalNotification: mockRecord,
  listOpenApprovalNotifications: mockListOpen,
  markApprovalNotificationsCleared: mockMarkCleared,
}));

import { recordSentApprovalNotification, clearApprovalNotifications } from '@/lib/approvalNotifications.js';

const sql = {};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DISCORD_BOT_TOKEN = 'disc-token';
  process.env.TELEGRAM_BOT_TOKEN = 'tg-token';
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('recordSentApprovalNotification', () => {
  it('inserts a notification row', async () => {
    await recordSentApprovalNotification(sql, {
      orgId: 'o1', actionId: 'act_1', channel: 'discord', messageId: 'm1', channelRef: 'c1',
    });
    expect(mockRecord).toHaveBeenCalledWith(sql, expect.objectContaining({ orgId: 'o1', channel: 'discord', messageId: 'm1' }));
  });

  it('never throws if the repo insert fails', async () => {
    mockRecord.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      recordSentApprovalNotification(sql, { orgId: 'o1', actionId: 'a', channel: 'telegram', messageId: 'm' }),
    ).resolves.toBeUndefined();
  });
});

describe('clearApprovalNotifications', () => {
  const twoChannels = () => [
    { id: '1', org_id: 'o1', action_id: 'act_1', channel: 'discord', message_id: 'dm', channel_ref: 'dc', created_at: '', cleared_at: null },
    { id: '2', org_id: 'o1', action_id: 'act_1', channel: 'telegram', message_id: '42', channel_ref: 'tc', created_at: '', cleared_at: null },
  ];

  it('edits BOTH channels + marks cleared when resolved via dashboard', async () => {
    mockListOpen.mockResolvedValue(twoChannels());
    await clearApprovalNotifications(sql, { orgId: 'o1', actionId: 'act_1', decision: 'allow', resolvedBy: 'usr_1', resolvedVia: 'dashboard' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const urls = global.fetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('discord.com') && u.includes('/messages/dm'))).toBe(true);
    expect(urls.some((u) => u.includes('api.telegram.org') && u.includes('editMessageText'))).toBe(true);
    expect(mockMarkCleared).toHaveBeenCalledWith(sql, 'o1', 'act_1');
  });

  it('skips the originating channel (resolved via telegram → only Discord edited)', async () => {
    mockListOpen.mockResolvedValue(twoChannels());
    await clearApprovalNotifications(sql, { orgId: 'o1', actionId: 'act_1', decision: 'deny', resolvedBy: 'telegram:5', resolvedVia: 'telegram' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toContain('discord.com');
    expect(mockMarkCleared).toHaveBeenCalled();
  });

  it('is a no-op when nothing is open', async () => {
    mockListOpen.mockResolvedValue([]);
    await clearApprovalNotifications(sql, { orgId: 'o1', actionId: 'act_1', decision: 'allow', resolvedBy: 'x' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockMarkCleared).not.toHaveBeenCalled();
  });

  it('never throws if listing fails', async () => {
    mockListOpen.mockRejectedValueOnce(new Error('db down'));
    await expect(
      clearApprovalNotifications(sql, { orgId: 'o1', actionId: 'a', decision: 'allow', resolvedBy: 'x' }),
    ).resolves.toBeUndefined();
  });
});
