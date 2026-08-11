import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal('fetch', mockFetch);

const { fireTelegramApproval } = await import('../../app/lib/telegramApprovals.js');

describe('fireTelegramApproval — config gate', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '12345';
    delete process.env.DASHCLAW_ALERTS_TELEGRAM;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  const pendingAction = {
    action_id: 'act_abc123def',
    status: 'pending_approval',
    agent_id: 'openclaw-telegram',
    action_type: 'deploy',
    risk_score: 80,
    reversible: false,
    declared_goal: 'Push release/v0.4.2 to production',
  };

  it('returns silently when TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    fireTelegramApproval(pendingAction, null, 'org_1');
    await new Promise((r) => setImmediate(r));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns silently when DASHCLAW_ALERTS_TELEGRAM === 'false'", async () => {
    process.env.DASHCLAW_ALERTS_TELEGRAM = 'false';
    fireTelegramApproval(pendingAction, null, 'org_1');
    await new Promise((r) => setImmediate(r));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns silently when action status is not pending_approval', async () => {
    fireTelegramApproval({ ...pendingAction, status: 'running' }, null, 'org_1');
    await new Promise((r) => setImmediate(r));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('fireTelegramApproval — payload', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.TELEGRAM_BOT_TOKEN = 'TBOT';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '42';
    delete process.env.DASHCLAW_ALERTS_TELEGRAM;
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('POSTs to /sendMessage with chat_id, text, and inline keyboard', async () => {
    const action = {
      action_id: 'act_abc12345',
      status: 'pending_approval',
      agent_id: 'openclaw-telegram',
      action_type: 'deploy',
      risk_score: 80,
      reversible: false,
      declared_goal: 'Push release/v0.4.2 to production',
    };

    fireTelegramApproval(action, null, 'org_1');
    await new Promise((r) => setImmediate(r));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTBOT/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('42');
    expect(body.text).toContain('openclaw-telegram');
    expect(body.text).toContain('deploy');
    expect(body.text).toContain('80');
    expect(body.text).toContain('irreversible');
    expect(body.text).toContain('Push release/v0.4.2 to production');
    expect(body.text).toContain('act_abc12345');

    expect(body.reply_markup.inline_keyboard).toEqual([[
      { text: '✅ Approve', callback_data: 'ap:act_abc12345' },
      { text: '❌ Reject',  callback_data: 'dn:act_abc12345' },
    ]]);
  });

  it('renders reversible actions with the reversible label', async () => {
    fireTelegramApproval({
      action_id: 'act_rev0001x',
      status: 'pending_approval',
      agent_id: 'a', action_type: 'review',
      risk_score: 10, reversible: true, declared_goal: 'read files',
    }, null, 'org_1');
    await new Promise((r) => setImmediate(r));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('reversible');
    expect(body.text).not.toContain('irreversible');
  });

  it('puts the plain-language headline before the Goal line, exact command still present', async () => {
    fireTelegramApproval({
      action_id: 'act_plain0001',
      status: 'pending_approval',
      agent_id: 'a', action_type: 'deploy',
      risk_score: 50, reversible: false,
      declared_goal: 'Bash: rm -rf /tmp/build',
    }, null, 'org_1');
    await new Promise((r) => setImmediate(r));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const headlineIdx = body.text.indexOf('Deletes /tmp/build and everything inside it.');
    const goalIdx = body.text.indexOf('Goal: Bash: rm -rf /tmp/build');
    expect(headlineIdx).toBeGreaterThan(-1);
    expect(goalIdx).toBeGreaterThan(-1);
    expect(headlineIdx).toBeLessThan(goalIdx);
  });

  it('leaves the message exactly as today when the translator has no confident read', async () => {
    fireTelegramApproval({
      action_id: 'act_plain0002',
      status: 'pending_approval',
      agent_id: 'a', action_type: 'deploy',
      risk_score: 50, reversible: false,
      declared_goal: 'Bash: some-tool --mystery-flag',
    }, null, 'org_1');
    await new Promise((r) => setImmediate(r));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toBe([
      '⏳ DashClaw approval needed',
      '',
      'Agent:   a',
      'Action:  deploy',
      'Risk:    50 • irreversible',
      '',
      'Goal: Bash: some-tool --mystery-flag',
      '',
      'act_plain0002',
    ].join('\n'));
  });

  it('keeps the headline intact even when the raw command is long enough to be truncated (field report 2026-08-07)', async () => {
    const longPath = '/tmp/' + 'a'.repeat(4000);
    fireTelegramApproval({
      action_id: 'act_plain0003',
      status: 'pending_approval',
      agent_id: 'a', action_type: 'deploy',
      risk_score: 50, reversible: false,
      declared_goal: `Bash: rm -rf ${longPath}`,
    }, null, 'org_1');
    await new Promise((r) => setImmediate(r));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const expectedHeadline = `Deletes /tmp/${'a'.repeat(75)}… and everything inside it.`;
    expect(body.text).toContain(expectedHeadline);
    expect(body.text).toContain('more chars — open the action link for the rest');

    const headlineIdx = body.text.indexOf(expectedHeadline);
    const goalIdx = body.text.indexOf('Goal: ');
    expect(headlineIdx).toBeGreaterThan(-1);
    expect(headlineIdx).toBeLessThan(goalIdx);
  });
});

describe('fireTelegramApproval — fail-open', () => {
  const originalEnv = { ...process.env };
  const action = {
    action_id: 'act_foo12345',
    status: 'pending_approval',
    agent_id: 'a', action_type: 'deploy',
    risk_score: 80, reversible: false, declared_goal: 'g',
  };
  let warnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.TELEGRAM_BOT_TOKEN = 'TBOT';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '42';
    delete process.env.DASHCLAW_ALERTS_TELEGRAM;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('does not throw when Telegram returns 500', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    expect(() => fireTelegramApproval(action, null, 'org_1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sendMessage returned 500')
    );
  });

  it('does not throw when fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    expect(() => fireTelegramApproval(action, null, 'org_1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to send approval'),
      expect.any(String),
    );
  });

  it('does not throw when fetch aborts (timeout)', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(() => fireTelegramApproval(action, null, 'org_1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(warnSpy).toHaveBeenCalled();
  });
});
