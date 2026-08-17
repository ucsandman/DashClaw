import { describe, expect, it } from 'vitest';
import { classifyAct, evidenceTotal } from '@/lib/guard/evidence.js';

// Two evidence-classifier bypasses found by the 2026-08-11 adversarial review.
// Both let a catastrophe grade as routine:
//   1. a newline is a shell command separator, but neither the inert-git-message
//      exemption nor the chain splitter treated it as one, so everything after
//      the first line of a multi-line Bash command went ungraded;
//   2. `"rm" -rf /` is legal shell, but the quoted-data relaxation blanked the
//      quoted COMMAND WORD out of the executable skeleton, so no pattern saw it.
// The client-side reference (hooks/dashclaw_agent_intel/command_parser.py,
// split_chain_texts) already splits on "\n"; these pin the server to it.

const RMRF_HOME = 'rm -rf ~';
const RMRF_ROOT = 'rm -rf /';

const shell = (command) => classifyAct({ kind: 'shell', command });

describe('classifyAct — newline is a command separator', () => {
  it('grades a newline-chained destructive exactly like the && variant', () => {
    const chained = shell(`git commit -m "wip" && ${RMRF_HOME}`);
    const newlined = shell(`git commit -m "wip"\n${RMRF_HOME}`);

    expect(newlined.flags).toContain('destructive');
    expect(newlined.flags).toContain('protected_target');
    expect(evidenceTotal(newlined)).toBe(100);
    expect(evidenceTotal(newlined)).toBe(evidenceTotal(chained));
    expect(newlined.derived_action_type).toBe(chained.derived_action_type);
  });

  it('treats CRLF line endings as separators too (Windows is first-class here)', () => {
    const c = shell(`git commit -m "wip"\r\n${RMRF_HOME}`);
    expect(c.flags).toContain('destructive');
    expect(c.flags).toContain('protected_target');
    expect(evidenceTotal(c)).toBe(100);
  });

  it('grades every line of a multi-line command, not just the first', () => {
    const c = shell(`cd /repo\nnpm run build\n${RMRF_ROOT}`);
    expect(c.flags).toContain('destructive');
    expect(evidenceTotal(c)).toBe(100);
  });

  it('keeps a multi-line commit MESSAGE inert (the newline is quoted data)', () => {
    const c = shell('git commit -m "fix: guard policy\n\nthe rm -rf / class is a threshold rule"');
    expect(c.flags).toEqual(['git_message']);
    expect(evidenceTotal(c)).toBe(35);
  });
});

describe('classifyAct — a quoted command word is still code', () => {
  it('grades a quoted rm command word like the bare one', () => {
    const c = shell(`"rm" -rf /`);
    expect(c.flags).toContain('destructive');
    expect(c.flags).toContain('protected_target');
    expect(evidenceTotal(c)).toBe(100);
  });

  it('sees through single quotes and an env-launcher prefix', () => {
    const c = shell(`env FOO=1 'rm' -rf ~`);
    expect(c.flags).toContain('destructive');
    expect(evidenceTotal(c)).toBe(100);
  });

  it('keeps the destructive grade under sudo', () => {
    const c = shell(`sudo "rm" -rf /`);
    expect(c.flags).toContain('destructive');
    expect(c.flags).toContain('privilege');
    expect(evidenceTotal(c)).toBe(100);
  });

  // `rtk` is installed as a PreToolUse hook that rewrites EVERY Bash command to
  // `rtk <cmd>`, so on such a machine this prefix is present on all traffic. It
  // must be transparent to the command word or the quoted-command-word bypass
  // reopens for every command that runs there.
  it('keeps the destructive grade under an rtk launcher prefix', () => {
    const c = shell(`rtk "rm" -rf /`);
    expect(c.flags).toContain('destructive');
    expect(evidenceTotal(c)).toBe(100);
  });

  it('sees a quoted interpreter as an exec sink', () => {
    const c = shell(`"bash" -c "${RMRF_ROOT}"`);
    expect(c.flags).toContain('destructive');
  });

  it('leaves a quoted ARGUMENT inert — the false-positive class stays fixed', () => {
    const c = shell(`gh release create v5.18.0 --notes "fixes the ${RMRF_ROOT} false positive"`);
    expect(c.flags).not.toContain('destructive');
  });

  it('leaves a dangerous-looking commit message inert', () => {
    const c = shell(`git commit -m "${RMRF_ROOT}"`);
    expect(c.flags).toEqual(['git_message']);
    expect(evidenceTotal(c)).toBe(35);
  });

  it('still catches command substitution inside a commit message', () => {
    const c = shell(`git commit -m "$(${RMRF_ROOT})"`);
    expect(c.flags).toContain('destructive');
    expect(c.flags).not.toContain('git_message');
  });
});
