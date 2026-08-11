// The approval surfaces must show the operator the FULL command they are
// judging (field report 2026-08-07: a Telegram card cut a command at 200 chars
// mid-word). These tests pin the new behavior: full goal up to the platform
// limit, and an HONEST "(+N more chars)" marker when a cut is unavoidable.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireTelegramApproval } from '../../app/lib/telegramApprovals';

describe('approval goal visibility', () => {
  const origFetch = global.fetch;
  let sentBodies;

  beforeEach(() => {
    sentBodies = [];
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.TELEGRAM_ADMIN_CHAT_ID = '12345';
    delete process.env.DASHCLAW_ALERTS_TELEGRAM;
    global.fetch = vi.fn(async (url, opts) => {
      sentBodies.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ result: { message_id: 1 } }) };
    });
  });

  afterEach(() => {
    global.fetch = origFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  });

  it('sends the full goal untruncated up to 3500 chars', async () => {
    const goal = 'Bash: ' + 'x'.repeat(1900); // realistic post-hook 2000-char goal
    await fireTelegramApproval({
      action_id: 'act_1', agent_id: 'a', action_type: 'other',
      declared_goal: goal, risk_score: 85, status: 'pending_approval',
    });
    expect(sentBodies).toHaveLength(1);
    expect(sentBodies[0].text).toContain(goal); // whole goal present, no cut
    expect(sentBodies[0].text).not.toContain('more chars');
  });

  it('cuts only as far as the 4096-char limit forces, with an honest marker', async () => {
    const goal = 'y'.repeat(5000);
    await fireTelegramApproval({
      action_id: 'act_2', agent_id: 'a', action_type: 'other',
      declared_goal: goal, risk_score: 85, status: 'pending_approval',
    });
    const text = sentBodies[0].text;
    // The goal's budget is now measured from the composed message rather than
    // reserved as a fixed 3500 (2026-08-11): a guessed reserve was safe only
    // while the plain-English block above it was short. Measuring shows the
    // operator MORE of the command, never less, so the old floor still holds.
    expect(text).toContain('y'.repeat(3500));
    expect(text.length).toBeLessThanOrEqual(4096);

    // Whatever it cut, the marker accounts for it exactly.
    const kept = text.match(/Goal: (y+)/)?.[1].length ?? 0;
    const dropped = Number(text.match(/\(\+(\d+) more chars/)?.[1] ?? 0);
    expect(kept + dropped).toBe(5000);
  });
});
