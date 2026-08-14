// cli/test/codex/install.test.js
//
// Tests for the Codex install flow. We avoid touching the real ~/.codex by
// pointing CODEX_HOME at a temp directory for the duration of each test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseToml } from 'smol-toml';

import {
  installCodex,
  mergeConfigToml,
  mergeAgentsMd,
  buildConfigTomlBlock,
  buildRootKeysBlock,
  buildAgentsMdBlock,
  replaceManagedBlock,
  neutralizeManualDashclawTables,
  neutralizeManualRootKeys,
  assertParseableToml,
  codexHome,
  codexConfigPath,
  codexHooksDir,
  MANAGED_START,
  MANAGED_END,
  AGENTS_MANAGED_START,
  AGENTS_MANAGED_END,
} from '../../lib/codex/install.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const silentLogger = { info() {}, warn() {} };

describe('replaceManagedBlock', () => {
  it('appends a new block when no markers exist', () => {
    const out = replaceManagedBlock('existing config\n', 'BLOCK');
    assert.match(out, /existing config/);
    assert.match(out, /BLOCK/);
    assert.equal(out.endsWith('\n'), true);
  });

  it('replaces an existing block in place', () => {
    const original = [
      'preamble = 1',
      '',
      MANAGED_START,
      'old line',
      MANAGED_END,
      '',
      'postamble = 2',
      '',
    ].join('\n');
    const newBlock = [MANAGED_START, 'new line', MANAGED_END].join('\n');
    const out = replaceManagedBlock(original, newBlock);
    assert.match(out, /preamble = 1/);
    assert.match(out, /new line/);
    assert.match(out, /postamble = 2/);
    assert.doesNotMatch(out, /old line/);
  });

  it('is idempotent under repeat application', () => {
    const block = [MANAGED_START, 'x = 1', MANAGED_END].join('\n');
    const once = replaceManagedBlock('', block);
    const twice = replaceManagedBlock(once, block);
    assert.equal(once, twice);
  });

  it('preserves trailing content exactly once', () => {
    const orig = [
      MANAGED_START,
      'old',
      MANAGED_END,
      '',
      '[other]',
      'key = "value"',
    ].join('\n');
    const block = [MANAGED_START, 'new', MANAGED_END].join('\n');
    const out = replaceManagedBlock(orig, block);
    assert.match(out, /\[other\]\nkey = "value"/);
  });
});

describe('buildConfigTomlBlock', () => {
  const built = buildConfigTomlBlock({
    mcpServerPath: 'C:\\Projects\\DashClaw\\mcp-server\\bin\\dashclaw-mcp.js',
    hooksDir: 'C:\\Users\\test\\.codex\\hooks\\dashclaw',
  });

  it('starts and ends with managed markers', () => {
    assert.match(built, new RegExp('^' + escapeRe(MANAGED_START)));
    assert.match(built, new RegExp(escapeRe(MANAGED_END) + '$'));
  });

  it('registers the dashclaw MCP server with codex agent id', () => {
    assert.match(built, /\[mcp_servers\.dashclaw\]/);
    assert.match(built, /"--agent-id", "codex"/);
  });

  it('declares all four hook events with the right matcher', () => {
    assert.match(built, /\[\[hooks\.PreToolUse\]\]/);
    assert.match(built, /\[\[hooks\.PostToolUse\]\]/);
    assert.match(built, /\[\[hooks\.Stop\]\]/);
    assert.match(built, /\[\[hooks\.SessionStart\]\]/);
    assert.match(built, /matcher = "Bash\|Edit\|Write\|MultiEdit"/);
  });

  it('wires the SessionStart enforcement-liveness probe (v8.2)', () => {
    assert.match(built, /\[\[hooks\.SessionStart\]\]\n\[\[hooks\.SessionStart\.hooks\]\]/);
    // The probe is wired with --source session-start (throttled + detached) and
    // NOT --agent-id — it forces its own synthetic identity internally.
    // --runtime codex names WHICH SEAM reported (drizzle/0072), so a dead codex
    // seam can no longer render green behind a healthy Claude Code run.
    assert.match(built, /command = ".*enforcement_liveness_probe\.py --source session-start --runtime codex"/);
    assert.doesNotMatch(built, /dashclaw_session_digest\.py/);
  });

  it('every dashclaw_ hook command declares the codex identity via --agent-id (roadmap v2.2)', () => {
    // The hooks' argv identity beats a machine-ambient DASHCLAW_AGENT_ID, so
    // Codex tool calls are never mis-attributed to another harness. The
    // SessionStart probe is exempt (not dashclaw_-prefixed, no --agent-id), so
    // only the three governance hooks (pre/post/stop) are matched here.
    const hookCommands = built.split('\n').filter((l) => l.startsWith('command = ') && l.includes('dashclaw_'));
    assert.equal(hookCommands.length, 3);
    for (const line of hookCommands) {
      assert.match(line, / --agent-id codex"$/);
    }
  });

  it('escapes Windows backslashes in command paths', () => {
    // Backslashes in the actual paths should become double-backslashes inside
    // TOML basic strings so the toml parser sees the original char.
    assert.match(built, /\\\\Users\\\\test\\\\\.codex\\\\hooks\\\\dashclaw/);
  });

  it('sets the long pretool timeout for human approval', () => {
    // serde renames codex's timeout_sec to `timeout` in config.toml; any other
    // spelling (timeoutSec included) is silently ignored → 600s default.
    assert.match(built, /^timeout = 3600$/m);
    assert.doesNotMatch(built, /timeoutSec/);
  });

  it('sets approval_policy = on-request by default (root-keys block)', () => {
    assert.match(buildRootKeysBlock({}), /approval_policy = "on-request"/);
  });

  it('respects a custom approval policy (root-keys block)', () => {
    const custom = buildRootKeysBlock({ approvalPolicy: 'untrusted' });
    assert.match(custom, /approval_policy = "untrusted"/);
  });

  it('omits the notify line by default', () => {
    assert.doesNotMatch(built, /^notify =/m);
    assert.doesNotMatch(buildRootKeysBlock({}), /^notify =/m);
  });

  it('emits a notify line when includeNotify=true (root-keys block)', () => {
    const withNotify = buildRootKeysBlock({
      includeNotify: true,
      dashclawCliPath: '/usr/local/bin/dashclaw.js',
    });
    assert.match(withNotify, /^notify = \["node", "\/usr\/local\/bin\/dashclaw\.js", "codex", "notify"\]/m);
  });

  it('throws when includeNotify is true but cli path is missing', () => {
    assert.throws(
      () => buildRootKeysBlock({ includeNotify: true }),
      /dashclawCliPath/,
    );
  });
});

describe('buildAgentsMdBlock', () => {
  it('starts and ends with HTML-comment markers', () => {
    const out = buildAgentsMdBlock({});
    assert.equal(out.startsWith(AGENTS_MANAGED_START), true);
    assert.equal(out.endsWith(AGENTS_MANAGED_END), true);
  });

  it('mentions all four guard decisions', () => {
    const out = buildAgentsMdBlock({});
    for (const decision of ['allow', 'warn', 'block', 'require_approval']) {
      assert.ok(out.includes(decision), `block should mention ${decision}`);
    }
  });

  it('includes instance URL when provided', () => {
    const out = buildAgentsMdBlock({ baseUrl: 'https://dc.example.com' });
    assert.match(out, /https:\/\/dc\.example\.com/);
  });

  it('omits instance URL section when baseUrl is missing', () => {
    const out = buildAgentsMdBlock({});
    assert.doesNotMatch(out, /This instance/);
  });
});

describe('mergeConfigToml', () => {
  it('creates the file when missing', () => {
    const dir = makeTempDir('dc-codex-');
    const configPath = path.join(dir, 'config.toml');
    const result = mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
    });
    assert.equal(result.changed, true);
    assert.equal(result.backup, null);
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /mcp_servers\.dashclaw/);
  });

  it('preserves user content outside the managed block', () => {
    const dir = makeTempDir('dc-codex-');
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(
      configPath,
      [
        'model = "gpt-5"',
        '',
        '[profiles.work]',
        'model = "gpt-5.1-codex"',
        '',
      ].join('\n'),
    );
    mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
    });
    const text = fs.readFileSync(configPath, 'utf8');
    assert.match(text, /model = "gpt-5"/);
    assert.match(text, /\[profiles\.work\]/);
    assert.match(text, /\[mcp_servers\.dashclaw\]/);
  });

  it('is idempotent — re-running yields identical output', () => {
    const dir = makeTempDir('dc-codex-');
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, 'preserved = true\n');
    mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
    });
    const first = fs.readFileSync(configPath, 'utf8');
    mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
    });
    const second = fs.readFileSync(configPath, 'utf8');
    assert.equal(first, second);
  });

  it('writes a .dashclaw-bak on first mutation only', () => {
    const dir = makeTempDir('dc-codex-');
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, 'original = true\n');
    const r1 = mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
    });
    assert.equal(r1.backup, configPath + '.dashclaw-bak');
    assert.equal(fs.readFileSync(r1.backup, 'utf8'), 'original = true\n');

    // Second run preserves the original backup unchanged.
    fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8') + '\n# touched\n');
    mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
    });
    assert.equal(fs.readFileSync(r1.backup, 'utf8'), 'original = true\n');
  });
});

describe('mergeAgentsMd', () => {
  it('creates AGENTS.md when missing', () => {
    const dir = makeTempDir('dc-agents-');
    const agentsMdPath = path.join(dir, 'AGENTS.md');
    const result = mergeAgentsMd({ agentsMdPath, baseUrl: 'https://x.test' });
    assert.equal(result.changed, true);
    const text = fs.readFileSync(agentsMdPath, 'utf8');
    assert.match(text, /DashClaw Governance Protocol/);
    assert.match(text, /https:\/\/x\.test/);
  });

  it('appends a block to an existing AGENTS.md without clobbering', () => {
    const dir = makeTempDir('dc-agents-');
    const agentsMdPath = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(
      agentsMdPath,
      '# My Project\n\nProject-specific guidance that should be preserved.\n',
    );
    mergeAgentsMd({ agentsMdPath });
    const text = fs.readFileSync(agentsMdPath, 'utf8');
    assert.match(text, /Project-specific guidance/);
    assert.match(text, /DashClaw Governance Protocol/);
  });

  it('replaces an existing managed block in place', () => {
    const dir = makeTempDir('dc-agents-');
    const agentsMdPath = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(
      agentsMdPath,
      [
        '# My Project',
        '',
        AGENTS_MANAGED_START,
        'OLD CONTENT',
        AGENTS_MANAGED_END,
        '',
        '## My Section',
      ].join('\n'),
    );
    mergeAgentsMd({ agentsMdPath });
    const text = fs.readFileSync(agentsMdPath, 'utf8');
    assert.doesNotMatch(text, /OLD CONTENT/);
    assert.match(text, /## My Section/);
    assert.match(text, /DashClaw Governance Protocol/);
  });
});

describe('codexHome / codexConfigPath / codexHooksDir', () => {
  it('honors CODEX_HOME when set', () => {
    const env = { CODEX_HOME: '/custom/codex' };
    assert.equal(codexHome(env), path.resolve('/custom/codex'));
    assert.equal(codexConfigPath(env), path.resolve('/custom/codex/config.toml'));
    assert.match(codexHooksDir(env), /hooks[\/\\]dashclaw$/);
  });

  it('defaults to ~/.codex when CODEX_HOME unset', () => {
    const env = {};
    assert.match(codexHome(env), /\.codex$/);
  });
});

describe('installCodex (end-to-end)', () => {
  it('installs hooks, merges config, drops AGENTS.md', async () => {
    const codexHomeDir = makeTempDir('dc-codex-home-');
    const projectDir = makeTempDir('dc-codex-proj-');
    const env = { CODEX_HOME: codexHomeDir };

    const result = await installCodex({
      repoRoot: REPO_ROOT,
      projectDir,
      env,
      baseUrl: 'https://test.dashclaw',
      trustHooks: false,
      logger: silentLogger,
    });

    // Hooks installed
    for (const file of [
      'dashclaw_pretool.py',
      'dashclaw_posttool.py',
      'dashclaw_stop.py',
      'enforcement_liveness_probe.py',
    ]) {
      assert.equal(
        fs.existsSync(path.join(codexHomeDir, 'hooks', 'dashclaw', file)),
        true,
        `${file} should be installed`,
      );
    }
    assert.equal(
      fs.statSync(path.join(codexHomeDir, 'hooks', 'dashclaw', 'dashclaw_agent_intel')).isDirectory(),
      true,
    );

    // Config merged
    const config = fs.readFileSync(path.join(codexHomeDir, 'config.toml'), 'utf8');
    assert.match(config, /mcp_servers\.dashclaw/);
    assert.match(config, /\[\[hooks\.SessionStart\]\]/);
    assert.match(config, /enforcement_liveness_probe\.py --source session-start/);

    // AGENTS.md created
    const agents = fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /DashClaw Governance Protocol/);
    assert.match(agents, /https:\/\/test\.dashclaw/);

    // Return shape sanity
    assert.equal(result.config.path, path.join(codexHomeDir, 'config.toml'));
    assert.equal(result.agentsMd.path, path.join(projectDir, 'AGENTS.md'));
  });

  it('wires the notify line when includeNotify=true', async () => {
    const codexHomeDir = makeTempDir('dc-codex-home-');
    const projectDir = makeTempDir('dc-codex-proj-');
    const env = { CODEX_HOME: codexHomeDir };

    await installCodex({
      repoRoot: REPO_ROOT,
      projectDir,
      env,
      includeNotify: true,
      trustHooks: false,
      logger: silentLogger,
    });

    const config = fs.readFileSync(path.join(codexHomeDir, 'config.toml'), 'utf8');
    assert.match(config, /notify = \["node",.*"codex", "notify"\]/);
    // CLI path must point at the actual dashclaw.js in the repo. We compare
    // the FILE basenames (cross-platform) and assert the notify line mentions
    // dashclaw.js at all.
    assert.ok(
      config.includes('dashclaw.js'),
      'notify line should reference dashclaw.js',
    );
  });

  it('is fully idempotent across two runs', async () => {
    const codexHomeDir = makeTempDir('dc-codex-home-');
    const projectDir = makeTempDir('dc-codex-proj-');
    const env = { CODEX_HOME: codexHomeDir };

    await installCodex({
      repoRoot: REPO_ROOT,
      projectDir,
      env,
      trustHooks: false,
      logger: silentLogger,
    });
    const config1 = fs.readFileSync(path.join(codexHomeDir, 'config.toml'), 'utf8');
    const agents1 = fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8');

    await installCodex({
      repoRoot: REPO_ROOT,
      projectDir,
      env,
      trustHooks: false,
      logger: silentLogger,
    });
    const config2 = fs.readFileSync(path.join(codexHomeDir, 'config.toml'), 'utf8');
    const agents2 = fs.readFileSync(path.join(projectDir, 'AGENTS.md'), 'utf8');

    assert.equal(config1, config2);
    assert.equal(agents1, agents2);
  });
});

// -----------------------------------------------------------------------------
// Regression coverage for the 2026-08-14 config.toml-corrupting incident
// (commit b10d7798): duplicate manual [mcp_servers.dashclaw] tables and
// duplicate root keys made TOML unparseable, breaking every `codex`
// invocation. These tests cover neutralizeManualDashclawTables,
// neutralizeManualRootKeys, assertParseableToml, and the pre-write refusal
// guard in mergeConfigToml that keeps a bad merge from ever touching disk.
// -----------------------------------------------------------------------------

describe('neutralizeManualDashclawTables', () => {
  it('comments out a single hand-written [mcp_servers.dashclaw] table', () => {
    const source = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.dashclaw]',
      'command = "python"',
      'args = ["hand-rolled.py"]',
      '',
      '[profiles.work]',
      'model = "gpt-5.1-codex"',
    ].join('\n');

    const { source: out, neutralized } = neutralizeManualDashclawTables(source);
    assert.equal(neutralized, true);
    // Unrelated content survives untouched.
    assert.match(out, /^model = "gpt-5"$/m);
    assert.match(out, /\[profiles\.work\]/);
    assert.match(out, /model = "gpt-5\.1-codex"/);
    // The manual table is commented out, not deleted.
    assert.match(out, /^# \[mcp_servers\.dashclaw\]$/m);
    assert.match(out, /^# command = "python"$/m);
    assert.match(out, /^# args = \["hand-rolled\.py"\]$/m);
  });

  it('neutralizes duplicate manual dashclaw tables without corrupting content between them', () => {
    const source = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.dashclaw]',
      'command = "python"',
      '',
      '[profiles.work]',
      'model = "gpt-5.1-codex"',
      '',
      '[mcp_servers.dashclaw]',
      'command = "node"',
      'args = ["second-copy.js"]',
    ].join('\n');

    const { source: out, neutralized } = neutralizeManualDashclawTables(source);
    assert.equal(neutralized, true);
    // Both duplicate definitions get commented out.
    const commentedHeaders = out.split('\n').filter((l) => l.trim() === '# [mcp_servers.dashclaw]');
    assert.equal(commentedHeaders.length, 2);
    assert.match(out, /^# command = "node"$/m);
    assert.match(out, /^# args = \["second-copy\.js"\]$/m);
    // The unrelated table sitting between the two duplicates is untouched.
    assert.match(out, /^\[profiles\.work\]$/m);
    assert.match(out, /^model = "gpt-5\.1-codex"$/m);
  });

  it('leaves managed-block content alone even if it looks like a dashclaw table', () => {
    const source = [
      MANAGED_START,
      '[mcp_servers.dashclaw]',
      'command = "node"',
      MANAGED_END,
    ].join('\n');
    const { source: out, neutralized } = neutralizeManualDashclawTables(source);
    assert.equal(neutralized, false);
    assert.match(out, /^\[mcp_servers\.dashclaw\]$/m);
  });

  it('reports no neutralization when there is nothing to neutralize', () => {
    const source = 'model = "gpt-5"\n\n[profiles.work]\nmodel = "gpt-5.1-codex"\n';
    const { source: out, neutralized } = neutralizeManualDashclawTables(source);
    assert.equal(neutralized, false);
    assert.equal(out, source);
  });
});

describe('neutralizeManualRootKeys', () => {
  it('comments out a hand-written root-level approval_policy', () => {
    const source = [
      'approval_policy = "never"',
      'model = "gpt-5"',
      '',
      '[profiles.work]',
      'model = "gpt-5.1-codex"',
    ].join('\n');
    const { source: out, neutralized } = neutralizeManualRootKeys(source);
    assert.equal(neutralized, true);
    assert.match(out, /^# approval_policy = "never"$/m);
    assert.match(out, /^model = "gpt-5"$/m);
    assert.match(out, /\[profiles\.work\]/);
  });

  it('does not touch a same-named key inside a [table]', () => {
    // A key nested under a table header is not a root key — neutralizing it
    // would corrupt the table's own config, not just dedupe a root clash.
    const source = [
      '[profiles.work]',
      'approval_policy = "never"',
    ].join('\n');
    const { source: out, neutralized } = neutralizeManualRootKeys(source);
    assert.equal(neutralized, false);
    assert.equal(out, source);
  });

  it('leaves notify alone by default (includeNotify=false)', () => {
    const source = 'notify = ["node", "custom-notify.js"]\napproval_policy = "never"\n';
    const { source: out, neutralized } = neutralizeManualRootKeys(source, { includeNotify: false });
    assert.equal(neutralized, true);
    assert.match(out, /^notify = \["node", "custom-notify\.js"\]$/m);
    assert.match(out, /^# approval_policy = "never"$/m);
  });

  it('neutralizes notify too when includeNotify=true', () => {
    const source = 'notify = ["node", "custom-notify.js"]\napproval_policy = "never"\n';
    const { source: out, neutralized } = neutralizeManualRootKeys(source, { includeNotify: true });
    assert.equal(neutralized, true);
    assert.match(out, /^# notify = \["node", "custom-notify\.js"\]$/m);
    assert.match(out, /^# approval_policy = "never"$/m);
  });
});

describe('assertParseableToml', () => {
  it('does not throw for valid TOML', () => {
    assert.doesNotThrow(() =>
      assertParseableToml('model = "gpt-5"\n\n[profiles.work]\nmodel = "gpt-5.1"\n', {
        path: '/fake/config.toml',
        phase: 'merged',
      }),
    );
  });

  it('rejects text that does not round-trip through the TOML parser', () => {
    // Unterminated table header — not valid TOML.
    const broken = 'model = "gpt-5"\n\n[unterminated\nmodel = "gpt-5.1"\n';
    assert.throws(
      () => assertParseableToml(broken, { path: '/fake/config.toml', phase: 'merged' }),
      /merged config for \/fake\/config\.toml is not valid TOML/,
    );
  });
});

describe('mergeConfigToml — refuses to write an unparseable merge', () => {
  it('leaves the original file byte-for-byte untouched when the merge would be unparseable', () => {
    const dir = makeTempDir('dc-codex-badtoml-');
    const configPath = path.join(dir, 'config.toml');
    // Malformed content that neutralization does not touch (not a manual
    // dashclaw table, not a root approval_policy/notify key) so it survives
    // into the merged text and breaks the overall parse.
    const original = 'model = "gpt-5"\n\n[unterminated\nmodel = "gpt-5.1"\n';
    fs.writeFileSync(configPath, original);

    assert.throws(
      () =>
        mergeConfigToml({
          configPath,
          mcpServerPath: '/tmp/mcp.js',
          hooksDir: '/tmp/hooks',
        }),
      /is not valid TOML/,
    );

    // The guard fires before any write — original bytes are untouched and no
    // backup was created (backup only happens after the guard passes).
    assert.equal(fs.readFileSync(configPath, 'utf8'), original);
    assert.equal(fs.existsSync(configPath + '.dashclaw-bak'), false);
  });
});

describe('mergeConfigToml — end-to-end neutralization stays parseable', () => {
  it('dedupes duplicate manual dashclaw tables and produces parseable TOML', () => {
    const dir = makeTempDir('dc-codex-dedupe-');
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(
      configPath,
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.dashclaw]',
        'command = "python"',
        '',
        '[profiles.work]',
        'model = "gpt-5.1-codex"',
        '',
        '[mcp_servers.dashclaw]',
        'command = "node"',
        '',
      ].join('\n'),
    );

    const result = mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
    });
    assert.equal(result.neutralizedManualTables, true);

    const text = fs.readFileSync(configPath, 'utf8');
    assert.doesNotThrow(() => parseToml(text), 'merged config must be valid TOML');
    // Unrelated content preserved.
    assert.match(text, /model = "gpt-5\.1-codex"/);
    assert.match(text, /\[profiles\.work\]/);
    // Only the managed table registers mcp_servers.dashclaw.
    const parsed = parseToml(text);
    assert.equal(parsed.mcp_servers.dashclaw.command, 'node');
  });

  it('neutralizes a manual root approval_policy and produces parseable TOML with one value', () => {
    const dir = makeTempDir('dc-codex-rootdedupe-');
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, 'approval_policy = "never"\nmodel = "gpt-5"\n');

    const result = mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
      approvalPolicy: 'on-request',
    });
    assert.equal(result.neutralizedRootKeys, true);

    const text = fs.readFileSync(configPath, 'utf8');
    const parsed = parseToml(text);
    assert.equal(parsed.approval_policy, 'on-request');
    assert.match(text, /^model = "gpt-5"$/m);
  });
});

describe('mergeConfigToml — clean install leaves parseable config.toml', () => {
  it('produces a config.toml that parses cleanly on a fresh install', () => {
    const dir = makeTempDir('dc-codex-clean-');
    const configPath = path.join(dir, 'config.toml');

    const result = mergeConfigToml({
      configPath,
      mcpServerPath: '/tmp/mcp.js',
      hooksDir: '/tmp/hooks',
      approvalPolicy: 'on-request',
    });
    assert.equal(result.changed, true);

    const text = fs.readFileSync(configPath, 'utf8');
    const parsed = parseToml(text);
    assert.equal(parsed.approval_policy, 'on-request');
    assert.equal(parsed.mcp_servers.dashclaw.command, 'node');
    assert.equal(Array.isArray(parsed.hooks.PreToolUse), true);
  });

  it('installCodex end-to-end produces a config.toml that parses cleanly', async () => {
    const codexHomeDir = makeTempDir('dc-codex-clean-home-');
    const projectDir = makeTempDir('dc-codex-clean-proj-');
    const env = { CODEX_HOME: codexHomeDir };

    await installCodex({
      repoRoot: REPO_ROOT,
      projectDir,
      env,
      trustHooks: false,
      logger: silentLogger,
    });

    const text = fs.readFileSync(path.join(codexHomeDir, 'config.toml'), 'utf8');
    const parsed = parseToml(text);
    assert.equal(parsed.mcp_servers.dashclaw.command, 'node');
  });
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
