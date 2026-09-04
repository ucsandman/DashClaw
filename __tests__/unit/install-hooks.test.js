import { describe, it, expect } from 'vitest';
import {
  isManagedHookCommand,
  MANAGED_HOOK_FILES,
  globalStopCommand,
  globalStopBlock,
  mergeGlobalStopHook,
  mergeGlobalGovernanceHooks,
  globalGovernanceBlocks,
  detectPythonCommand,
  hookBlocks,
} from '../../scripts/install-hooks.mjs';

/**
 * Tests for the install-hooks.mjs managed-hook whitelist.
 *
 * Before commit 0986e958, this function used a naive substring check
 * (`cmd.includes('dashclaw_')`) which swept away user-authored hooks with
 * similar names on re-install. The whitelist approach restricts removal to
 * the three exact managed filenames. These tests guard against a regression
 * that would re-introduce the over-broad match.
 */

describe('install-hooks isManagedHookCommand', () => {
  it('recognises the three managed hooks via Unix-style paths', () => {
    expect(isManagedHookCommand('python .claude/hooks/dashclaw_pretool.py')).toBe(true);
    expect(isManagedHookCommand('python .claude/hooks/dashclaw_posttool.py')).toBe(true);
    expect(isManagedHookCommand('python .claude/hooks/dashclaw_stop.py')).toBe(true);
  });

  it('recognises the three managed hooks via Windows-style paths', () => {
    expect(isManagedHookCommand('python .claude\\hooks\\dashclaw_pretool.py')).toBe(true);
    expect(isManagedHookCommand('python .claude\\hooks\\dashclaw_posttool.py')).toBe(true);
    expect(isManagedHookCommand('python .claude\\hooks\\dashclaw_stop.py')).toBe(true);
  });

  it('matches when the filename stands alone (no path)', () => {
    expect(isManagedHookCommand('dashclaw_pretool.py')).toBe(true);
  });

  it('matches when the path is quoted in the settings command', () => {
    // settings.json JSON-escapes its values; rendered commands often look
    // like `python ".claude/hooks/dashclaw_stop.py"`. The path separator
    // before the filename is what the regex locks onto, so quoting is fine.
    expect(isManagedHookCommand('python ".claude/hooks/dashclaw_stop.py"')).toBe(true);
    expect(isManagedHookCommand('python ".claude\\hooks\\dashclaw_pretool.py"')).toBe(true);
  });

  it('does NOT match user-authored wrappers with similar names', () => {
    // These are the canonical regression cases — the pre-fix substring
    // match ('dashclaw_') would have eaten all of them.
    expect(isManagedHookCommand('python .claude/hooks/my_dashclaw_pretool.py')).toBe(false);
    expect(isManagedHookCommand('python .claude/hooks/dashclaw_metrics.py')).toBe(false);
    expect(isManagedHookCommand('python wrappers/run_dashclaw_pretool_with_tracing.py')).toBe(false);
    expect(isManagedHookCommand('dashclaw_custom.py')).toBe(false);
  });

  it('does NOT match partial filename collisions', () => {
    // Someone named their script with a managed filename as a substring —
    // still NOT a managed hook.
    expect(isManagedHookCommand('my_dashclaw_pretool.py.bak')).toBe(false);
    expect(isManagedHookCommand('dashclaw_stop.py.old')).toBe(false);
    expect(isManagedHookCommand('./notdashclaw_stop.py')).toBe(false);
  });

  it('does NOT match empty or irrelevant commands', () => {
    expect(isManagedHookCommand('')).toBe(false);
    expect(isManagedHookCommand('echo hello')).toBe(false);
    expect(isManagedHookCommand('python scripts/other.py')).toBe(false);
  });

  it('exposes the canonical list of managed files', () => {
    expect(MANAGED_HOOK_FILES).toEqual([
      'dashclaw_pretool.py',
      'dashclaw_posttool.py',
      'dashclaw_stop.py',
      'dashclaw_db_containment.py',
      'dashclaw_session_digest.py',
      'enforcement_liveness_probe.py',
    ]);
  });
});

describe('install-hooks global capture (--global)', () => {
  // Backslashes in the repo root must be forward-slashed in the rendered
  // command so it runs identically under PowerShell and POSIX shells.
  const REPO = 'C:\\Projects\\DashClaw';
  // --agent-id claude-code: per-harness identity via argv (roadmap v2.2).
  const CMD = 'python "C:/Projects/DashClaw/hooks/dashclaw_stop.py" --agent-id claude-code';

  it('builds a forward-slashed absolute Stop command for this repo', () => {
    expect(globalStopCommand(REPO)).toBe(CMD);
  });

  it('produces a command the managed-hook matcher recognises', () => {
    // So re-running --global upgrades in place instead of stacking duplicates.
    expect(isManagedHookCommand(globalStopCommand(REPO))).toBe(true);
  });

  it('is capture-only: one Stop entry, no PreToolUse/PostToolUse', () => {
    const block = globalStopBlock(REPO);
    expect(block).toHaveLength(1);
    expect(block[0].hooks[0].command).toBe(CMD);
  });

  it('merges into empty settings by creating hooks.Stop', () => {
    const merged = mergeGlobalStopHook({}, REPO);
    expect(merged.hooks.Stop).toHaveLength(1);
    expect(merged.hooks.Stop[0].hooks[0].command).toBe(CMD);
  });

  it('preserves third-party Stop hooks and other events', () => {
    // Real-world: the user already runs other observability Stop hooks
    // (e.g. aline-ai, orca). Those MUST survive a DashClaw install.
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python other_pretool.py' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'some-other-observability-hook.cmd' }] }],
      },
    };
    const merged = mergeGlobalStopHook(existing, REPO);
    expect(merged.hooks.Stop).toHaveLength(2);
    expect(merged.hooks.Stop[0].hooks[0].command).toBe('some-other-observability-hook.cmd');
    expect(merged.hooks.Stop[1].hooks[0].command).toBe(CMD);
    expect(merged.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
  });

  it('is idempotent — re-merging does not duplicate the DashClaw entry', () => {
    const once = mergeGlobalStopHook({}, REPO);
    const twice = mergeGlobalStopHook(once, REPO);
    const dashclawEntries = twice.hooks.Stop.filter(
      (e) => (e.hooks || []).some((h) => isManagedHookCommand(h.command || '')),
    );
    expect(dashclawEntries).toHaveLength(1);
  });

  it('uninstall removes the DashClaw entry but keeps user hooks', () => {
    const withUser = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-hook.cmd' }] }] } };
    const installed = mergeGlobalStopHook(withUser, REPO);
    expect(installed.hooks.Stop).toHaveLength(2);
    const removed = mergeGlobalStopHook(installed, REPO, { remove: true });
    expect(removed.hooks.Stop).toHaveLength(1);
    expect(removed.hooks.Stop[0].hooks[0].command).toBe('user-hook.cmd');
  });

  it('uninstall drops the empty Stop key when no hooks remain', () => {
    const installed = mergeGlobalStopHook({}, REPO);
    const removed = mergeGlobalStopHook(installed, REPO, { remove: true });
    expect(removed.hooks.Stop).toBeUndefined();
  });

  it('does not mutate the input settings object', () => {
    const input = { hooks: { Stop: [] } };
    const snapshot = JSON.stringify(input);
    mergeGlobalStopHook(input, REPO);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('install-hooks python interpreter selection (Linux python3 fix)', () => {
  // Debian/Ubuntu ship only `python3`; a hardcoded `python` silently disables
  // every governance hook there. The installer resolves the interpreter on the
  // target machine and bakes it into the settings.json commands.
  it('detects python3 off-Windows and python on Windows', () => {
    expect(detectPythonCommand()).toBe(process.platform === 'win32' ? 'python' : 'python3');
  });

  it('renders pure helpers with the literal "python" by default (deterministic)', () => {
    expect(globalStopCommand('C:\\Projects\\DashClaw')).toBe('python "C:/Projects/DashClaw/hooks/dashclaw_stop.py" --agent-id claude-code');
    expect(hookBlocks().PreToolUse[0].hooks[0].command)
      .toBe('python "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_pretool.py" --agent-id claude-code');
  });

  it('matches the Workflow tool so dynamic-workflow fan-outs are governed (v4.3)', () => {
    expect(hookBlocks().PreToolUse[0].matcher).toContain('Workflow');
    expect(hookBlocks().PostToolUse[0].matcher).toContain('Workflow');
  });

  it('bakes the chosen interpreter into every hook command when one is passed', () => {
    expect(globalStopCommand('C:\\Projects\\DashClaw', 'python3'))
      .toBe('python3 "C:/Projects/DashClaw/hooks/dashclaw_stop.py" --agent-id claude-code');
    const blocks = hookBlocks('python3');
    expect(blocks.PreToolUse[0].hooks[0].command).toBe('python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_pretool.py" --agent-id claude-code');
    expect(blocks.PostToolUse[0].hooks[0].command).toBe('python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_posttool.py" --agent-id claude-code');
    expect(blocks.Stop[0].hooks[0].command).toBe('python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_stop.py" --agent-id claude-code');
  });

  it('threads the interpreter through the global Stop merge', () => {
    const merged = mergeGlobalStopHook({}, 'C:\\Projects\\DashClaw', { python: 'python3' });
    expect(merged.hooks.Stop[0].hooks[0].command).toBe('python3 "C:/Projects/DashClaw/hooks/dashclaw_stop.py" --agent-id claude-code');
  });
});

describe('SessionStart liveness probe hook', () => {
  it('hookBlocks wires the enforcement-liveness probe with --source session-start', () => {
    const blocks = hookBlocks('python');
    expect(blocks.SessionStart).toBeDefined();
    const cmd = blocks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain('enforcement_liveness_probe.py');
    expect(cmd).toContain('--source session-start');
    expect(cmd).toContain('$CLAUDE_PROJECT_DIR');
    // The retired digest must not be re-introduced.
    expect(cmd).not.toContain('dashclaw_session_digest.py');
  });

  it('still recognises a retired digest command as managed (so re-install strips it)', () => {
    // dashclaw_session_digest.py stays in MANAGED_HOOK_FILES purely so a
    // re-install over a digest-era settings.json cleanly removes the stale entry.
    expect(isManagedHookCommand('python "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_session_digest.py"')).toBe(true);
    expect(isManagedHookCommand('python "x/my_dashclaw_session_digest.py"')).toBe(false);
  });

  it('globalGovernanceBlocks wires the SessionStart probe with an absolute path', () => {
    const blocks = globalGovernanceBlocks('/repo', 'python3');
    const cmd = blocks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain('/repo/hooks/enforcement_liveness_probe.py');
    expect(cmd).toContain('--source session-start');
  });

  it('globalGovernanceBlocks matches the Workflow tool (v4.3)', () => {
    const blocks = globalGovernanceBlocks('/repo', 'python3');
    expect(blocks.PreToolUse[0].matcher).toContain('Workflow');
    expect(blocks.PostToolUse[0].matcher).toContain('Workflow');
  });

  it('re-merge does not duplicate the SessionStart entry', () => {
    const once = mergeGlobalGovernanceHooks({}, '/repo', { python: 'python3' });
    const twice = mergeGlobalGovernanceHooks(once, '/repo', { python: 'python3' });
    expect(twice.hooks.SessionStart).toHaveLength(1);
  });
});
