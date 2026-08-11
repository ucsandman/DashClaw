import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upsertEnvVar, buildAgentsMdBlock, isCodexAuthoredBlock, buildPluginConfigPatch, openclawBin, resolveConfigPath, resolveWorkspace, mergeAgentsMd, installOpenclaw } from '../../cli/lib/openclaw/install.js';
import { AGENTS_MANAGED_START, AGENTS_MANAGED_END } from '../../cli/lib/codex/install.js';

describe('upsertEnvVar', () => {
  it('appends when the key is absent, preserving neighbours', () => {
    const out = upsertEnvVar('OPENAI_API_KEY=sk-a\nGEMINI_API_KEY=g-b\n', 'DASHCLAW_API_KEY', 'dc-1');
    expect(out).toBe('OPENAI_API_KEY=sk-a\nGEMINI_API_KEY=g-b\nDASHCLAW_API_KEY=dc-1\n');
  });

  it('replaces in place without duplicating', () => {
    const out = upsertEnvVar('A=1\nDASHCLAW_API_KEY=old\nB=2\n', 'DASHCLAW_API_KEY', 'new');
    expect(out).toBe('A=1\nDASHCLAW_API_KEY=new\nB=2\n');
    expect(out.match(/DASHCLAW_API_KEY=/g)).toHaveLength(1);
  });

  it('survives a missing trailing newline', () => {
    expect(upsertEnvVar('A=1', 'B', '2')).toBe('A=1\nB=2\n');
  });

  it('handles empty content', () => {
    expect(upsertEnvVar('', 'B', '2')).toBe('B=2\n');
  });

  it('ignores a commented-out key rather than treating it as a match', () => {
    const out = upsertEnvVar('# DASHCLAW_API_KEY=nope\n', 'DASHCLAW_API_KEY', 'dc-1');
    expect(out).toBe('# DASHCLAW_API_KEY=nope\nDASHCLAW_API_KEY=dc-1\n');
  });

  it('treats the value as a literal, not a replacement pattern', () => {
    expect(upsertEnvVar('A=1\n', 'A', '$&')).toBe('A=$&\n');
    expect(upsertEnvVar('A=1\n', 'A', "x$'y")).toBe("A=x$'y\n");
    expect(upsertEnvVar('A=1\n', 'A', 'p$$q')).toBe('A=p$$q\n');
  });
});

const CODEX_BLOCK = `${AGENTS_MANAGED_START}
## DashClaw Governance Protocol

1. Call \`dashclaw_session_start\` via the \`dashclaw\` MCP server with your
   agent id (\`codex\`).

The PreToolUse hook installed by \`dashclaw install codex\` will guard
Bash, Edit, Write, and MultiEdit automatically.
${AGENTS_MANAGED_END}`;

describe('buildAgentsMdBlock', () => {
  const block = buildAgentsMdBlock({ baseUrl: 'https://dc.example.com', agentId: 'forge-openclaw' });

  // Regression guard: an OpenClaw agent told to call these fail-closed and
  // refused to work, because no dashclaw MCP server exists in that runtime.
  it('never instructs the agent to call DashClaw tools itself', () => {
    for (const banned of [
      'dashclaw_guard',
      'dashclaw_session_start',
      'dashclaw_record',
      'dashclaw_wait_for_approval',
      'install codex',
      'PreToolUse',
      'dashclaw://',
    ]) {
      expect(block).not.toContain(banned);
    }
  });

  it('carries the managed markers byte-identically', () => {
    expect(block.startsWith(AGENTS_MANAGED_START)).toBe(true);
    expect(block.trimEnd().endsWith(AGENTS_MANAGED_END)).toBe(true);
  });

  it('states the instance url and agent id', () => {
    expect(block).toContain('https://dc.example.com');
    expect(block).toContain('forge-openclaw');
  });

  it('keeps the load-bearing rule that a block is final', () => {
    expect(block.toLowerCase()).toContain('block is final');
  });
});

describe('isCodexAuthoredBlock', () => {
  it('detects a codex-authored block', () => {
    expect(isCodexAuthoredBlock(CODEX_BLOCK)).toBe(true);
  });

  it('does not flag our own block', () => {
    expect(isCodexAuthoredBlock(buildAgentsMdBlock({ baseUrl: 'https://x', agentId: 'a' }))).toBe(false);
  });

  it('does not flag unrelated prose that merely mentions codex', () => {
    expect(isCodexAuthoredBlock('We also run codex here.')).toBe(false);
  });
});

describe('buildPluginConfigPatch', () => {
  const base = { agentId: 'forge-openclaw', baseUrl: 'https://dc.example.com', apiKey: 'dc-secret' };

  it('omits the api key by default and clears any stored one', () => {
    const patch = buildPluginConfigPatch(base);
    const cfg = patch.plugins.entries['dashclaw-governance'].config;
    expect(cfg.dashclawApiKey).toBeNull();   // null deletes the path on config patch
    expect(JSON.stringify(patch)).not.toContain('dc-secret');
  });

  it('includes the api key only under writeConfig', () => {
    const cfg = buildPluginConfigPatch({ ...base, writeConfig: true })
      .plugins.entries['dashclaw-governance'].config;
    expect(cfg.dashclawApiKey).toBe('dc-secret');
  });

  it('sets identity, url, enabled and failClosed', () => {
    const entry = buildPluginConfigPatch(base).plugins.entries['dashclaw-governance'];
    expect(entry.enabled).toBe(true);
    expect(entry.config.agentId).toBe('forge-openclaw');
    expect(entry.config.dashclawUrl).toBe('https://dc.example.com');
    expect(entry.config.failClosed).toBe(true);
  });

  it('never touches plugins.allow, which config patch would replace wholesale', () => {
    expect(buildPluginConfigPatch(base).plugins.allow).toBeUndefined();
  });
});

describe('openclawBin', () => {
  it('prefers an explicit override', () => {
    expect(openclawBin({}, 'C:/tools/openclaw.mjs')).toBe('C:/tools/openclaw.mjs');
  });

  it('falls back to OPENCLAW_BIN then the bare command', () => {
    expect(openclawBin({ OPENCLAW_BIN: '/opt/openclaw' })).toBe('/opt/openclaw');
    expect(openclawBin({})).toBe('openclaw');
  });
});

describe('resolveConfigPath / resolveWorkspace', () => {
  const runOk = (out) => async () => ({ ok: true, stdout: out, stderr: '' });

  it('reads the config path from `config file`', async () => {
    await expect(resolveConfigPath({ run: runOk('  /home/u/.openclaw/openclaw.json \n') }))
      .resolves.toBe('/home/u/.openclaw/openclaw.json');
  });

  it('reads the workspace from `config get`, unquoting a JSON string', async () => {
    await expect(resolveWorkspace({ run: runOk('"C:\\\\Users\\\\sandm\\\\clawd"\n') }))
      .resolves.toBe('C:\\Users\\sandm\\clawd');
  });

  it('throws a directive error when openclaw fails', async () => {
    const runFail = async () => ({ ok: false, stdout: '', stderr: 'not found' });
    await expect(resolveConfigPath({ run: runFail })).rejects.toThrow(/openclaw config file failed/);
  });
});

const opts = { baseUrl: 'https://dc.example.com', agentId: 'forge-openclaw' };

function tmpAgents(initial) {
  const dir = mkdtempSync(join(tmpdir(), 'oc-agents-'));
  const p = join(dir, 'AGENTS.md');
  if (initial !== undefined) writeFileSync(p, initial);
  return p;
}

describe('mergeAgentsMd', () => {
  it('creates the file when absent', () => {
    const p = tmpAgents();
    const res = mergeAgentsMd({ agentsMdPath: p, ...opts });
    expect(readFileSync(p, 'utf8')).toContain('DashClaw Governance Protocol');
    expect(res.migrated).toBe(false);
  });

  it('preserves surrounding content', () => {
    const p = tmpAgents('# House rules\n\nBe kind.\n');
    mergeAgentsMd({ agentsMdPath: p, ...opts });
    const out = readFileSync(p, 'utf8');
    expect(out).toContain('# House rules');
    expect(out).toContain('Be kind.');
  });

  it('replaces a codex block and reports the migration, leaving a backup', () => {
    const p = tmpAgents(
      '# Rules\n\n<!-- >>> dashclaw start — managed block, do not edit by hand -->\n' +
      'Call `dashclaw_session_start` via the `dashclaw` MCP server.\n' +
      'The PreToolUse hook installed by `dashclaw install codex` guards Bash.\n' +
      '<!-- <<< dashclaw end -->\n',
    );
    const res = mergeAgentsMd({ agentsMdPath: p, ...opts });
    const out = readFileSync(p, 'utf8');
    expect(res.migrated).toBe(true);
    expect(existsSync(res.backup)).toBe(true);
    expect(out).not.toContain('dashclaw_session_start');
    expect(out).toContain('# Rules');
    expect(out.match(/dashclaw start/g)).toHaveLength(1); // exactly one block
  });

  it('is idempotent', () => {
    const p = tmpAgents('# Rules\n');
    mergeAgentsMd({ agentsMdPath: p, ...opts });
    const first = readFileSync(p, 'utf8');
    mergeAgentsMd({ agentsMdPath: p, ...opts });
    expect(readFileSync(p, 'utf8')).toBe(first);
  });

  it('never overwrites an existing backup, so the true original survives a re-run', () => {
    const p = tmpAgents('# Original\n\n<!-- >>> dashclaw start — managed block, do not edit by hand -->\n' +
      'Call `dashclaw_session_start` via the `dashclaw` MCP server.\n' +
      'The PreToolUse hook installed by `dashclaw install codex` guards Bash.\n' +
      '<!-- <<< dashclaw end -->\n');
    const first = mergeAgentsMd({ agentsMdPath: p, ...opts });
    const originalBackup = readFileSync(first.backup, 'utf8');
    expect(originalBackup).toContain('dashclaw_session_start');

    mergeAgentsMd({ agentsMdPath: p, ...opts });
    expect(readFileSync(first.backup, 'utf8')).toBe(originalBackup);
  });
});

function harness({ preflightThrows = false } = {}) {
  const calls = [];
  const run = async (argv) => {
    calls.push(argv.join(' '));
    if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
    if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  };
  const preflightImpl = async () => { if (preflightThrows) throw new Error('unreachable'); };
  return { calls, run, preflightImpl };
}

let workspaceDir;
beforeEach(() => { workspaceDir = mkdtempSync(join(tmpdir(), 'oc-ws-')); });

describe('installOpenclaw', () => {
  it('aborts before any write when preflight fails', async () => {
    const h = harness({ preflightThrows: true });
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await expect(installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    })).rejects.toThrow('unreachable');
    expect(existsSync(envPath)).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it('enables via plugins enable and never patches plugins.allow', async () => {
    const h = harness();
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'forge-openclaw',
      envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    });
    expect(h.calls.some((c) => c.startsWith('plugins enable'))).toBe(true);
    const patchCall = h.calls.find((c) => c.startsWith('config patch'));
    expect(patchCall).toBeDefined();
    expect(patchCall).not.toContain('allow');
  });

  it('writes the key to .env, not into the config patch', async () => {
    const h = harness();
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'super-secret', agentId: 'a',
      envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    });
    expect(readFileSync(envPath, 'utf8')).toContain('DASHCLAW_API_KEY=super-secret');
    expect(h.calls.find((c) => c.startsWith('config patch'))).not.toContain('super-secret');
  });

  it('writes AGENTS.md into the resolved workspace, not the cwd', async () => {
    const h = harness();
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    const res = await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    });
    expect(res.agentsMd.path).toBe(join(workspaceDir, 'AGENTS.md'));
    expect(existsSync(res.agentsMd.path)).toBe(true);
  });

  it('throws when plugins enable fails, before the config patch lands', async () => {
    const calls = [];
    const run = async (argv) => {
      calls.push(argv.join(' '));
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      if (argv[0] === 'plugins' && argv[1] === 'enable') return { ok: false, stdout: '', stderr: 'enable boom' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const preflightImpl = async () => {};
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await expect(installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      envPath, run, preflightImpl, logger: { info() {}, warn() {} },
    })).rejects.toThrow(/plugins enable/);
    expect(calls.some((c) => c.startsWith('config patch'))).toBe(false);
  });
});

// Behavioral, not textual: these spawn the real CLI instead of grepping the
// source for "case 'openclaw':", which would pass even if that string sat in
// a comment. Both invocations are inherently safe against running a real
// install: `install bogus` never matches a switch case, and `install --help`
// is caught by the isHelpInvocation guard in main() (dashclaw.js) BEFORE
// config is loaded or cmdInstall runs at all — before that guard existed,
// `dashclaw install codex --help` silently ignored the flag and ran the
// install for real. Resolved from import.meta.url, not process.cwd(), so
// this doesn't depend on which directory vitest was invoked from.
describe('cli wiring', () => {
  // NOT `new URL('../../cli/bin/dashclaw.js', import.meta.url)`: under this
  // project's vitest config (environment: 'jsdom'), the global `URL` is
  // jsdom's polyfill, not Node's — the resulting object's .protocol reads
  // wrong to node:url's fileURLToPath ("The URL must be of scheme file")
  // even though import.meta.url itself is a normal file: string. Resolving
  // via node:path instead avoids the global URL class entirely.
  const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'bin', 'dashclaw.js');

  function runCli(argv, { home } = {}) {
    // Strip any DASHCLAW_* the host machine/operator may have set so the
    // spawned process never touches a real saved config or key. Neither of
    // the first two invocations below reaches an install regardless (see
    // comment above), so this is defense in depth for those; the third
    // invocation (`install openclaw`) does reach installOpenclaw's own
    // guards, and this machine has a real ~/.dashclaw/config.json, so for
    // that one it's load-bearing.
    const env = { ...process.env };
    delete env.DASHCLAW_BASE_URL;
    delete env.DASHCLAW_API_KEY;
    delete env.DASHCLAW_AGENT_ID;
    // `home`: redirect os.homedir() (verified empirically — Node reads
    // USERPROFILE on Windows and HOME elsewhere for this) so
    // resolveConfig() finds no config.json and cannot hand installOpenclaw
    // a real baseUrl/apiKey that would carry it past its own arg guards.
    if (home) {
      env.HOME = home;
      env.USERPROFILE = home;
    }
    return spawnSync(process.execPath, [cliPath, ...argv], {
      encoding: 'utf8',
      env,
      timeout: 10_000,
    });
  }

  it('install --help exits 0 and documents the openclaw target', () => {
    const { status, stdout } = runCli(['install', '--help']);
    expect(status).toBe(0);
    expect(stdout).toContain('dashclaw install openclaw');
    expect(stdout).toContain('--write-config');
  });

  it('install bogus exits non-zero and names openclaw among the valid targets', () => {
    const { status, stderr } = runCli(['install', 'bogus']);
    expect(status).toBe(1);
    expect(stderr).toContain('openclaw');
  });

  // Neither test above actually exercises `case 'openclaw':` — --help
  // short-circuits in main() before cmdInstall() runs, and `bogus` only
  // ever reaches the `default:` branch. This one proves the dispatch
  // itself: `install openclaw` is spawned for real. That's safe —
  // installOpenclaw (cli/lib/openclaw/install.js:223-224) throws on its own
  // `if (!baseUrl)` / `if (!apiKey)` guards BEFORE the preflight network
  // call at line 227, so nothing is written and no network call happens —
  // AS LONG AS resolveConfig() can't hand it a real baseUrl/apiKey, which
  // is what the `home` override in runCli is for.
  it('install openclaw dispatches to the real handler, not the unknown-target fallback', () => {
    const home = mkdtempSync(join(tmpdir(), 'oc-cli-home-'));
    const { stderr } = runCli(['install', 'openclaw'], { home });
    // This is the assertion that actually proves the dispatch: if
    // `case 'openclaw':` were deleted, mistyped, or moved to the wrong
    // branch, this is the string that would appear instead.
    expect(stderr).not.toContain('Unknown install target');
    // And this proves it actually reached installOpenclaw's own guards,
    // not just "didn't say unknown target" for some unrelated reason.
    // Deliberately not asserting which of the two guards fired (baseUrl
    // vs apiKey) — that depends on whether main() supplies a default
    // baseUrl, which isn't this test's concern.
    expect(stderr).toMatch(/is required/);
  });
});
