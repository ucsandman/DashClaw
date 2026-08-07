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
import {
  buildConfigTomlBlock,
  buildRootKeysBlock,
  mergeConfigToml,
} from '../../cli/lib/codex/install.js';

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

describe('dashclaw install codex --help', () => {
  it('prints usage and installs nothing', () => {
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
