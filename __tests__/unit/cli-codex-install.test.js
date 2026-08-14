import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Defects found live on the OpenClaw embedded-codex lane (2026-08-07):
//   1. The MCP server (a Node .js entry) was registered with command "python"
//      — that spawn can never succeed.
//   2. The managed block was appended after user [tables], so its top-level
//      `approval_policy` key silently landed inside the preceding table scope.
//   3. `--agent-id` was not threaded into the block (hardcoded "codex"),
//      mis-attributing every governed action.
//   4. Hook timeout was written as `timeoutSec`, which codex's config.toml
//      parser ignores (the serde field is renamed `timeout`).
//   5. `dashclaw install codex --help` RAN the install instead of printing
//      usage.
import { parse as parseToml } from 'smol-toml';

import {
  assertParseableToml,
  buildConfigTomlBlock,
  buildRootKeysBlock,
  mergeConfigToml,
} from '../../cli/lib/codex/install.js';
import { isHelpInvocation } from '../../cli/lib/argv.js';

const MCP = 'C:\\repo\\mcp-server\\bin\\dashclaw-mcp.js';
const HOOKS = 'C:\\home\\hooks\\dashclaw';

function block(overrides = {}) {
  return buildConfigTomlBlock({ mcpServerPath: MCP, hooksDir: HOOKS, ...overrides });
}

describe('buildConfigTomlBlock', () => {
  it('registers the Node MCP server with node, not python', () => {
    const b = block();
    expect(b).toContain('command = "node"');
    expect(b).not.toContain('command = "python"\n');
  });

  it('threads --agent-id into the MCP args and every hook command', () => {
    const b = block({ agentId: 'moltfire-openclaw' });
    const matches = b.match(/--agent-id moltfire-openclaw/g) || [];
    // pretool + posttool + stop hook commands
    expect(matches.length).toBe(3);
    expect(b).toContain('"--agent-id", "moltfire-openclaw"');
    expect(b).not.toContain('--agent-id codex');
  });

  it('defaults the agent id to codex', () => {
    expect(block()).toContain('--agent-id codex');
  });

  it('writes the codex-recognized timeout key, not timeoutSec', () => {
    const b = block();
    expect(b).toContain('timeout = 3600');
    expect(b).not.toContain('timeoutSec');
  });

  it('holds no top-level keys — those live in the root-keys block', () => {
    expect(block()).not.toContain('approval_policy');
  });
});

describe('buildRootKeysBlock', () => {
  it('carries approval_policy', () => {
    expect(buildRootKeysBlock({ approvalPolicy: 'never' })).toContain(
      'approval_policy = "never"'
    );
  });

  it('carries notify when requested', () => {
    const b = buildRootKeysBlock({
      approvalPolicy: 'on-request',
      includeNotify: true,
      dashclawCliPath: 'C:\\repo\\cli\\bin\\dashclaw.js',
    });
    expect(b).toContain('notify = ["node"');
  });
});

describe('mergeConfigToml placement', () => {
  const LANE_FILE = [
    '# user notify line',
    'notify = ["node", "x.js", "codex", "notify"]',
    '',
    "[projects.'c:\\users\\me\\ws']",
    'trust_level = "trusted"',
    '',
  ].join('\n');

  function merge(dir, initial) {
    const configPath = join(dir, 'config.toml');
    if (initial != null) writeFileSync(configPath, initial);
    mergeConfigToml({
      configPath,
      mcpServerPath: MCP,
      hooksDir: HOOKS,
      approvalPolicy: 'never',
      agentId: 'moltfire-openclaw',
    });
    return readFileSync(configPath, 'utf8');
  }

  it('places approval_policy before the first user table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const out = merge(dir, LANE_FILE);
    const policyAt = out.indexOf('approval_policy');
    const firstTableAt = out.search(/^\s*\[/m);
    expect(policyAt).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(firstTableAt);
    // user content preserved
    expect(out).toContain('# user notify line');
    expect(out).toContain("[projects.'c:\\users\\me\\ws']");
  });

  it('is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const once = merge(dir, LANE_FILE);
    const twice = merge(dir, null);
    expect(twice).toBe(once);
  });

  it('migrates a legacy single-block layout without duplicating approval_policy', () => {
    const legacy = [
      LANE_FILE,
      '# >>> dashclaw start — managed block, do not edit by hand',
      'approval_policy = "on-request"',
      '[mcp_servers.dashclaw]',
      'command = "python"',
      '[[hooks.PreToolUse]]',
      'matcher = "Bash"',
      '[[hooks.PreToolUse.hooks]]',
      'type = "command"',
      'command = "python old.py --agent-id codex"',
      'timeoutSec = 3600',
      '# <<< dashclaw end',
      '',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const out = merge(dir, legacy);
    expect(out.match(/approval_policy/g)).toHaveLength(1);
    expect(out).not.toContain('timeoutSec');
    expect(out).not.toContain('command = "python"\n');
    const policyAt = out.indexOf('approval_policy');
    expect(policyAt).toBeLessThan(out.search(/^\s*\[/m));
  });
});

// Defects found live on this machine (2026-08-14): a hand-written
// [mcp_servers.dashclaw] table coexisting with the managed one is a duplicate
// TOML table (whole config fails to parse), and the old installer's bare
// approval_policy appended after the last user table ([tui.model_availability_nux])
// bound to that table and broke codex's schema validation. Every `codex exec`
// on the machine failed until the file was repaired by hand.
describe('mergeConfigToml corruption regressions (2026-08-14)', () => {
  // Shape of the real broken config: manual dashclaw server (with env
  // subtable), user tables after it, and the file ENDING on an open table.
  const INCIDENT_FILE = [
    '# my hand-wired dashclaw server',
    '[mcp_servers.dashclaw]',
    'command = "python"',
    "args = ['C:\\Projects\\DashClaw\\mcp-server\\bin\\dashclaw-mcp.js']",
    '[mcp_servers.dashclaw.env]',
    'DASHCLAW_URL = "http://localhost:3000"',
    '',
    "[projects.'c:\\users\\me\\ws']",
    'trust_level = "trusted"',
    '',
    '[tui.model_availability_nux]',
    'seen = 1',
    '',
  ].join('\n');

  function merge(dir, initial) {
    const configPath = join(dir, 'config.toml');
    if (initial != null) writeFileSync(configPath, initial);
    mergeConfigToml({
      configPath,
      mcpServerPath: MCP,
      hooksDir: HOOKS,
      approvalPolicy: 'never',
      agentId: 'codex',
    });
    return readFileSync(configPath, 'utf8');
  }

  it('produces parseable TOML with exactly one dashclaw server table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const out = merge(dir, INCIDENT_FILE);

    const parsed = parseToml(out); // throws if the duplicate-table bug is back
    const activeHeaders = out
      .split('\n')
      .filter((l) => /^\s*\[\[?\s*mcp_servers\.dashclaw/.test(l));
    expect(activeHeaders).toHaveLength(1);
    expect(parsed.mcp_servers.dashclaw.command).toBe('node');
    // the manual table (and its env subtable) was neutralized, not merged
    expect(parsed.mcp_servers.dashclaw.env).toBeUndefined();
    // ...but the user's content is still visible as comments
    expect(out).toContain('# [mcp_servers.dashclaw]');
    expect(out).toContain('# DASHCLAW_URL = "http://localhost:3000"');
  });

  it('keeps approval_policy at root even when the file ends on an open table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const parsed = parseToml(merge(dir, INCIDENT_FILE));
    expect(parsed.approval_policy).toBe('never');
    expect(parsed.tui.model_availability_nux).toEqual({ seen: 1 });
  });

  it('is idempotent across re-runs on the incident file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const once = merge(dir, INCIDENT_FILE);
    const twice = merge(dir, null);
    expect(twice).toBe(once);
  });

  it('dedupes a hand-moved root-level approval_policy instead of doubling it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const out = merge(dir, 'approval_policy = "untrusted"\n\n' + INCIDENT_FILE);
    const parsed = parseToml(out);
    expect(parsed.approval_policy).toBe('never');
    const active = out
      .split('\n')
      .filter((l) => /^\s*approval_policy\s*=/.test(l));
    expect(active).toHaveLength(1);
  });

  // L1: prove the round-trip gate can actually fail — duplicate tables are
  // exactly what the 2026-08-14 config died on.
  it('assertParseableToml rejects duplicate tables loudly', () => {
    const dupe = '[a]\nx = 1\n[a]\ny = 2\n';
    expect(() =>
      assertParseableToml(dupe, { path: 'config.toml', phase: 'merged' }),
    ).toThrow(/not valid TOML/);
  });

  it('neutralizes the quoted-key spelling of the manual table too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const quoted = '[mcp_servers."dashclaw"]\ncommand = "python"\n';
    const out = merge(dir, quoted);
    const parsed = parseToml(out);
    expect(parsed.mcp_servers.dashclaw.command).toBe('node');
    expect(out).toContain('# [mcp_servers."dashclaw"]');
  });

  it('refuses to write when the merge result would not parse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dc-codex-'));
    const configPath = join(dir, 'config.toml');
    // User content that is already broken TOML stays broken after the merge —
    // the gate must throw and leave the file byte-identical.
    const trap = '[projects\ntrust_level = "trusted"\n';
    writeFileSync(configPath, trap);
    expect(() =>
      mergeConfigToml({
        configPath,
        mcpServerPath: MCP,
        hooksDir: HOOKS,
        approvalPolicy: 'never',
        agentId: 'codex',
      }),
    ).toThrow(/not valid TOML/);
    expect(readFileSync(configPath, 'utf8')).toBe(trap);
  });
});

describe('subcommand --help guard', () => {
  it('flags --help and -h anywhere in argv', () => {
    expect(isHelpInvocation(['install', 'codex', '--help'])).toBe(true);
    expect(isHelpInvocation(['install', 'codex', '-h'])).toBe(true);
    expect(isHelpInvocation(['approve', 'act_1', '--reason', 'ok'])).toBe(false);
  });

  // Full e2e (bin dispatch prints usage, installs nothing). The bin's import
  // graph needs cli-only deps (`tar`) that repo-root CI doesn't install, so
  // this only runs where `npm install` has been done inside cli/.
  const cliDepsPresent = existsSync(
    resolve(__dirname, '../../cli/node_modules/tar')
  );
  it.runIf(cliDepsPresent)('prints usage and installs nothing', () => {
    const home = mkdtempSync(join(tmpdir(), 'dc-help-'));
    const bin = resolve(__dirname, '../../cli/bin/dashclaw.js');
    const out = execFileSync(process.execPath, [bin, 'install', 'codex', '--help'], {
      env: { ...process.env, CODEX_HOME: home },
      encoding: 'utf8',
    });
    expect(out).toContain('Usage:');
    expect(existsSync(join(home, 'config.toml'))).toBe(false);
    expect(readdirSync(home)).toHaveLength(0);
  });
});
