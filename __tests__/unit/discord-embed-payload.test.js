import { describe, expect, it } from 'vitest';
import { buildEmbedPayload } from '../../app/lib/discordApprovals.js';

const baseAction = {
  action_id: 'act_abc12345',
  agent_id: 'claude-code',
  action_type: 'deploy',
  risk_score: 80,
  reversible: false,
  declared_goal: 'Deploy release/v0.4.2 to production',
};

describe('buildEmbedPayload', () => {
  it('returns exactly 4 fields: Agent, Action, Risk score (inline=true), Goal (inline=false)', () => {
    const payload = buildEmbedPayload(baseAction);
    const embed = payload.embeds[0];

    expect(embed.fields).toHaveLength(4);
    const [agent, action, risk, goal] = embed.fields;

    expect(agent.name.toLowerCase()).toContain('agent');
    expect(agent.value).toContain('claude-code');
    expect(agent.inline).toBe(true);

    expect(action.name.toLowerCase()).toContain('action');
    expect(action.value).toContain('deploy');
    expect(action.inline).toBe(true);

    expect(risk.name.toLowerCase()).toContain('risk');
    expect(risk.value).toContain('80');
    expect(risk.inline).toBe(true);

    expect(goal.name.toLowerCase()).toContain('goal');
    expect(goal.value).toContain('Deploy release/v0.4.2');
    expect(goal.inline).toBe(false);
  });

  it('shows the full goal up to 1000 chars, then cuts with an honest marker (v5.11.2)', () => {
    // The operator judges the approval by this string — the old 200-char cut
    // made real commands unjudgeable (field report 2026-08-07). Discord's
    // embed-field hard limit is 1024, so 1000 + marker stays within it.
    const midGoal = 'x'.repeat(500);
    const midPayload = buildEmbedPayload({ ...baseAction, declared_goal: midGoal });
    expect(midPayload.embeds[0].fields[3].value).toBe(midGoal); // no cut under 1000

    const longGoal = 'y'.repeat(2000);
    const payload = buildEmbedPayload({ ...baseAction, declared_goal: longGoal });
    const goalField = payload.embeds[0].fields[3];
    expect(goalField.value).toContain('y'.repeat(1000));
    expect(goalField.value).toContain('(+1000 more chars)');
    expect(goalField.value.length).toBeLessThanOrEqual(1024); // Discord hard limit
    expect(goalField.value).not.toContain('y'.repeat(1001));
  });

  it('uses color 0xf97316 (brand orange — the one permitted in-code hex)', () => {
    const payload = buildEmbedPayload(baseAction);
    expect(payload.embeds[0].color).toBe(0xf97316);
  });

  it('components has ACTION_ROW (type 1) with Approve (style 3) and Deny (style 4)', () => {
    const payload = buildEmbedPayload(baseAction);
    expect(payload.components).toHaveLength(1);
    const row = payload.components[0];
    expect(row.type).toBe(1); // ACTION_ROW
    expect(row.components).toHaveLength(2);

    const [approve, deny] = row.components;
    expect(approve.type).toBe(2); // BUTTON
    expect(approve.style).toBe(3); // SUCCESS
    expect(approve.custom_id).toBe('ap:act_abc12345');
    expect(approve.label.toLowerCase()).toContain('approve');

    expect(deny.type).toBe(2);
    expect(deny.style).toBe(4); // DANGER
    expect(deny.custom_id).toBe('dn:act_abc12345');
    expect(deny.label.toLowerCase()).toContain('deny');
  });

  it('custom_id preserves the full action_id (matches CALLBACK_DATA_RE 57-char limit)', () => {
    // 57-char action_id body (regex allows act_[a-z0-9_-]{1,57})
    const longId = 'act_' + 'a'.repeat(57);
    const payload = buildEmbedPayload({ ...baseAction, action_id: longId });
    const [approve, deny] = payload.components[0].components;
    expect(approve.custom_id).toBe(`ap:${longId}`);
    expect(deny.custom_id).toBe(`dn:${longId}`);
    // Total length of ap:/dn: prefix + action_id must be ≤ Discord's 100-char
    // custom_id limit. 3 + 4 + 57 = 64 → well within.
    expect(approve.custom_id.length).toBeLessThanOrEqual(100);
  });

  it('footer.text contains action.action_id', () => {
    const payload = buildEmbedPayload(baseAction);
    expect(payload.embeds[0].footer).toBeDefined();
    expect(payload.embeds[0].footer.text).toContain('act_abc12345');
  });

  it('sets the plain-language headline as the embed description, ahead of the Goal field', () => {
    const payload = buildEmbedPayload({ ...baseAction, declared_goal: 'Bash: rm -rf /tmp/build' });
    const embed = payload.embeds[0];
    expect(embed.description).toBe('Deletes /tmp/build and everything inside it.');
    // Exact command is never hidden or replaced.
    expect(embed.fields[3].name.toLowerCase()).toContain('goal');
    expect(embed.fields[3].value).toBe('Bash: rm -rf /tmp/build');
  });

  it('omits description when the translator has no confident read', () => {
    const payload = buildEmbedPayload({ ...baseAction, declared_goal: 'Bash: some-tool --mystery-flag' });
    expect(payload.embeds[0].description).toBeUndefined();
  });

  it('keeps the description intact even when the Goal field is cut for length (field report 2026-08-07)', () => {
    const longPath = '/tmp/' + 'a'.repeat(4000);
    const payload = buildEmbedPayload({ ...baseAction, declared_goal: `Bash: rm -rf ${longPath}` });
    const embed = payload.embeds[0];
    expect(embed.description).toBe(`Deletes /tmp/${'a'.repeat(75)}… and everything inside it.`);
    expect(embed.fields[3].value).toContain('more chars'); // the existing honest-cut marker
  });
});
