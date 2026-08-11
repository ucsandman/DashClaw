import { describe, it, expect } from 'vitest';
import { describeAction } from '@/lib/plain-language';
import { CALM_RULE_IDS } from '@/lib/plain-language/types';

describe('describeAction dispatch', () => {
  it('routes a Bash goal to the shell translator', () => {
    const out = describeAction({
      declared_goal: 'Bash: git push --force origin main',
      risk_score: 85,
      intel: { bash: { intent: 'destructive', reversible: false } },
    });
    expect(out.headline).toContain('Overwrites');
  });

  it('routes PowerShell down the same path as Bash', () => {
    const out = describeAction({ declared_goal: 'PowerShell: ls', risk_score: 5, intel: { bash: { intent: 'read', reversible: true } } });
    expect(out.ruleId).toBe('bash.read');
  });

  it('routes a file goal to the file translator and prefers target over the parsed path', () => {
    const out = describeAction({ declared_goal: 'Write: app/page.tsx', target: 'app/page.tsx', risk_score: 20, intel: { file: { sensitive_path: false } } });
    expect(out.detail).toBe('app/page.tsx');
  });

  it('routes an MCP goal to the MCP translator', () => {
    const out = describeAction({ declared_goal: 'MCP: mcp__dashclaw-local__dashclaw_guard', risk_score: 5 });
    expect(out.headline).toContain('Asks DashClaw');
  });

  it('routes an unlabelled prose goal to the conversation rule', () => {
    const out = describeAction({ declared_goal: 'Text-only assistant response', risk_score: 0 });
    expect(out.ruleId).toBe('conversation');
  });

  it('returns unknown for a missing goal rather than throwing', () => {
    expect(describeAction({ declared_goal: null }).confidence).toBe('unknown');
  });

  it('caps confidence at partial when the goal hit the 2000-char cap', () => {
    const long = `Bash: ls ${'a'.repeat(2000)}`.slice(0, 2000);
    const out = describeAction({ declared_goal: long, risk_score: 5, intel: { bash: { intent: 'read', reversible: true } } });
    expect(out.confidence).not.toBe('high');
    expect(out.warnings.join(' ')).toContain('too long to record in full');
  });
});

describe('the no-calm-lie invariant', () => {
  const dangerous = [
    { declared_goal: 'Bash: ls -la', risk_score: 90, intel: { bash: { intent: 'read', reversible: true } } },
    { declared_goal: 'MCP: mcp__dashclaw-local__dashclaw_status', risk_score: 85 },
    { declared_goal: 'Read: {"file_path":"/etc/shadow"}', risk_score: 95 },
  ];

  it.each(dangerous)('never returns a calm rule id at high risk: $declared_goal', (input) => {
    const out = describeAction(input);
    expect(CALM_RULE_IDS.has(out.ruleId)).toBe(false);
  });

  it('never claims "nothing is changed" next to a high risk score', () => {
    for (const input of dangerous) {
      const out = describeAction(input);
      expect(`${out.headline} ${out.warnings.join(' ')}`).not.toMatch(/Nothing is changed|Reads only/);
    }
  });
});
