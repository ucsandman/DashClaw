import { describe, it, expect } from 'vitest';
import { describeAction } from '@/lib/plain-language';

/**
 * The notification card and the /approvals card must never disagree. Both
 * read the same function, so this test pins that they are given the same
 * inputs rather than each building their own string.
 */
describe('notification parity', () => {
  it('pins the exact headline both surfaces must render', () => {
    const out = describeAction({
      declared_goal: 'Bash: git push --force origin main',
      risk_score: 85,
      intel: { bash: { intent: 'destructive', reversible: false } },
    });
    // A golden string, not a self-comparison: if either surface ever builds
    // its own sentence instead of calling describeAction, this is the value
    // it has to match.
    expect(out.headline).toBe('Overwrites the shared code history on GitHub.');
    expect(out.warnings).toContain('Work other people pushed can be lost.');
  });

  it('gives a notification something readable even with no intel at all', () => {
    const out = describeAction({ declared_goal: 'Bash: git push --force origin main', risk_score: 85 });
    expect(out.headline).toContain('Overwrites');
    expect(out.reversible).toBe('unknown');
  });
});
