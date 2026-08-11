import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upsertEnvVar, buildAgentsMdBlock, isCodexAuthoredBlock, buildPluginConfigPatch, openclawBin, resolveConfigPath, resolveWorkspace, mergeAgentsMd, installOpenclaw, runOpenclaw, lastLine, expandHome, redactKey, isVersionAtLeast, resolveApiKey, installedPluginVersion } from '../../cli/lib/openclaw/install.js';
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

describe('lastLine', () => {
  // openclaw prints its "Config warnings" banner to STDOUT ahead of the value.
  // Trimming the whole stream returns the banner as the config path.
  it('returns the value, not the banner openclaw printed above it', () => {
    const contaminated = [
      '│',
      '◇  Config warnings ───╮',
      '│  - plugins.allow: plugin not found: ghost  │',
      '├─╯',
      '~\\.openclaw-x\\openclaw.json',
      '',
    ].join('\n');
    expect(lastLine(contaminated)).toBe('~\\.openclaw-x\\openclaw.json');
  });

  it('handles clean output and empty output', () => {
    expect(lastLine('/home/u/.openclaw/openclaw.json\n')).toBe('/home/u/.openclaw/openclaw.json');
    expect(lastLine('')).toBe('');
  });
});

describe('expandHome', () => {
  it('expands a leading tilde, which node itself never does', () => {
    expect(expandHome('~/x/openclaw.json', '/home/u')).toBe(join('/home/u', 'x/openclaw.json'));
    expect(expandHome('~\\x\\openclaw.json', '/home/u')).toBe(join('/home/u', 'x\\openclaw.json'));
    expect(expandHome('~', '/home/u')).toBe('/home/u');
  });

  it('leaves an absolute path and a tilde-prefixed name alone', () => {
    expect(expandHome('/abs/openclaw.json', '/home/u')).toBe('/abs/openclaw.json');
    expect(expandHome('~notahome/x', '/home/u')).toBe('~notahome/x');
  });
});

describe('redactKey', () => {
  it('removes the key from anything built out of subprocess output', () => {
    expect(redactKey('parse failed near "dc_live_abcdef123"', 'dc_live_abcdef123')).not.toContain('dc_live_abcdef123');
  });

  it('leaves text alone when there is no key worth redacting', () => {
    expect(redactKey('boom', null)).toBe('boom');
    expect(redactKey('a short k here', 'k')).toBe('a short k here'); // too short to redact safely
  });
});

describe('isVersionAtLeast', () => {
  it('is true at or above the wanted version', () => {
    expect(isVersionAtLeast('1.6.2', '1.6.2')).toBe(true);
    expect(isVersionAtLeast('1.7.0', '1.6.2')).toBe(true);
    expect(isVersionAtLeast('2.0.0', '1.6.2')).toBe(true);
    expect(isVersionAtLeast('1.6.10', '1.6.2')).toBe(true); // numeric, not lexical
  });

  it('is false below it, or when the version is unreadable', () => {
    expect(isVersionAtLeast('1.6.1', '1.6.2')).toBe(false);
    expect(isVersionAtLeast('1.5.0', '1.6.2')).toBe(false);
    expect(isVersionAtLeast(null, '1.6.2')).toBe(false);
    expect(isVersionAtLeast('unknown', '1.6.2')).toBe(false);
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

  it('skips the warnings banner openclaw prints to stdout above the path', async () => {
    const banner = '│\n◇  Config warnings ──╮\n│  - plugins.allow: plugin not found: ghost  │\n├──╯\n';
    await expect(resolveConfigPath({ run: runOk(`${banner}/home/u/.openclaw/openclaw.json\n`) }))
      .resolves.toBe('/home/u/.openclaw/openclaw.json');
  });

  it('expands the literal tilde `config file` actually prints', async () => {
    await expect(resolveConfigPath({ run: runOk('~/.openclaw-x/openclaw.json\n') }))
      .resolves.toBe(join(homedir(), '.openclaw-x/openclaw.json'));
  });

  // M1: joining the STRING 'null' against the cwd is exactly the cwd-resolution
  // that put a Codex protocol in an OpenClaw workspace.
  it.each(['null', 'undefined', '""', ''])('refuses the unresolved workspace %j', async (raw) => {
    await expect(resolveWorkspace({ run: runOk(`${raw}\n`) })).rejects.toThrow(/workspace/);
  });
});

const opts = { baseUrl: 'https://dc.example.com', agentId: 'forge-openclaw' };

// Long enough to exercise redactKey's minimum length, assembled rather than
// written out so it can never be mistaken for a real credential.
const SAMPLE_KEY = ['sample', 'not', 'a', 'credential'].join('-');

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
  const stdin = [];
  const run = async (argv, opts) => {
    calls.push(argv.join(' '));
    stdin.push(opts?.input ?? null);
    if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
    if (argv[0] === 'config' && argv[1] === 'get' && argv[2].endsWith('.enabled')) {
      return { ok: true, stdout: 'true', stderr: '' };
    }
    if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  };
  const preflightImpl = async () => { if (preflightThrows) throw new Error('unreachable'); };
  const inputFor = (prefix) => stdin[calls.findIndex((c) => c.startsWith(prefix))];
  return { calls, stdin, inputFor, run, preflightImpl };
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

  // REWRITTEN (was: "throws when plugins enable fails, before the config patch
  // lands"). That test asserted the OLD sequence — enable, then patch — which is
  // the ordering that bricks an agent: a patch that fails behind a successful
  // enable leaves a live plugin with failClosed:true and no dashclawUrl, so the
  // agent refuses every tool call. The sequence is now patch-then-enable, and
  // this asserts the property that actually matters.
  it('never enables the plugin when the config patch fails', async () => {
    const calls = [];
    const run = async (argv) => {
      calls.push(argv.join(' '));
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'patch') return { ok: false, stdout: '', stderr: 'patch boom' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const preflightImpl = async () => {};
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await expect(installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      envPath, run, preflightImpl, logger: { info() {}, warn() {} },
    })).rejects.toThrow(/config patch/);
    expect(calls.some((c) => c.startsWith('plugins enable'))).toBe(false);
    expect(existsSync(envPath)).toBe(false); // no key written behind a failed patch either
  });

  it('patches BEFORE enabling, so a failure cannot leave a live unconfigured plugin', async () => {
    const h = harness();
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    });
    const patchAt = h.calls.findIndex((c) => c.startsWith('config patch'));
    const enableAt = h.calls.findIndex((c) => c.startsWith('plugins enable'));
    expect(patchAt).toBeGreaterThanOrEqual(0);
    expect(enableAt).toBeGreaterThan(patchAt);
  });

  // The defect this whole pass exists for: `openclaw config patch` takes NO
  // positional argument ("Too many arguments for this command."), so the patch
  // must arrive on stdin.
  it('sends the patch over stdin and never as an argv element', async () => {
    const h = harness();
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: SAMPLE_KEY, agentId: 'a',
      writeConfig: true, envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    });
    const patchCall = h.calls.find((c) => c.startsWith('config patch'));
    expect(patchCall).toBe('config patch --stdin');
    expect(patchCall).not.toContain('{');

    const payload = h.inputFor('config patch');
    expect(JSON.parse(payload).plugins.entries['dashclaw-governance'].config.dashclawUrl)
      .toBe('https://dc.example.com');
    // --write-config puts the key IN the payload; the point is that the payload
    // is stdin, so the key is in no argv and no process-table entry.
    expect(payload).toContain(SAMPLE_KEY);
    expect(h.calls.join('\n')).not.toContain(SAMPLE_KEY);
  });

  it('backs up openclaw.json before patching it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-cfg-'));
    const cfg = join(dir, 'openclaw.json');
    writeFileSync(cfg, '{"original":true}');
    const run = async (argv) => {
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: cfg, stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get' && argv[2].endsWith('.enabled')) return { ok: true, stdout: 'true', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const res = await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      run, preflightImpl: async () => {}, logger: { info() {}, warn() {} },
    });
    expect(res.configBackup).toBe(`${cfg}.dashclaw-bak`);
    expect(readFileSync(res.configBackup, 'utf8')).toBe('{"original":true}');
  });

  // The old default was a hardcoded join(homedir(), '.openclaw', '.env'), which
  // writes the key into the DEFAULT profile no matter which profile the rest of
  // the install just configured.
  it('derives the .env from the config path, so it follows --profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-profile-'));
    const cfg = join(dir, 'openclaw.json');
    const run = async (argv) => {
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: cfg, stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get' && argv[2].endsWith('.enabled')) return { ok: true, stdout: 'true', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const res = await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: SAMPLE_KEY, agentId: 'a',
      run, preflightImpl: async () => {}, logger: { info() {}, warn() {} },
    });
    expect(res.envPath).toBe(join(dir, '.env'));
    expect(readFileSync(res.envPath, 'utf8')).toContain(`DASHCLAW_API_KEY=${SAMPLE_KEY}`);
  });

  it('creates a missing .env parent instead of throwing a raw ENOENT', async () => {
    const h = harness();
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), 'never', 'made', '.env');
    await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    });
    expect(existsSync(envPath)).toBe(true);
  });

  it('creates a missing AGENTS.md parent instead of throwing a raw ENOENT', async () => {
    const h = harness();
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    const ws = join(mkdtempSync(join(tmpdir(), 'oc-ws2-')), 'not', 'created', 'yet');
    const res = await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      workspace: ws, envPath, run: h.run, preflightImpl: h.preflightImpl, logger: { info() {}, warn() {} },
    });
    expect(existsSync(res.agentsMd.path)).toBe(true);
  });

  it('skips the plugin install when an equal-or-newer version is already there', async () => {
    const calls = [];
    const listing = JSON.stringify({ plugins: [{ id: 'dashclaw-governance', version: '1.9.0' }] }, null, 2);
    const run = async (argv) => {
      calls.push(argv.join(' '));
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
      if (argv[0] === 'plugins' && argv[1] === 'list') return { ok: true, stdout: listing, stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get' && argv[2].endsWith('.enabled')) return { ok: true, stdout: 'true', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    const res = await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a', pluginVersion: '1.6.2',
      envPath, run, preflightImpl: async () => {}, logger: { info() {}, warn() {} },
    });
    expect(calls.some((c) => c.startsWith('plugins install'))).toBe(false);
    expect(res.pluginVersion).toBe('1.9.0');
  });

  it('installs the pinned version when the installed one is older', async () => {
    const calls = [];
    const listing = JSON.stringify({ plugins: [{ id: 'dashclaw-governance', version: '1.5.0' }] }, null, 2);
    const run = async (argv) => {
      calls.push(argv.join(' '));
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
      if (argv[0] === 'plugins' && argv[1] === 'list') return { ok: true, stdout: listing, stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get' && argv[2].endsWith('.enabled')) return { ok: true, stdout: 'true', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a', pluginVersion: '1.6.2',
      envPath, run, preflightImpl: async () => {}, logger: { info() {}, warn() {} },
    });
    expect(calls).toContain('plugins install @dashclaw/openclaw-plugin@1.6.2');
  });

  it('fails verification when plugins enable exited 0 without enabling anything', async () => {
    const warnings = [];
    const run = async (argv) => {
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get' && argv[2].endsWith('.enabled')) {
        return { ok: false, stdout: '', stderr: 'Config path not found' };
      }
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    const res = await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: 'k', agentId: 'a',
      envPath, run, preflightImpl: async () => {}, logger: { info() {}, warn(m) { warnings.push(m); } },
    });
    expect(res.verified.enabled).toBe(false);
    expect(warnings.join('\n')).toMatch(/verification failed/);
  });

  it('keeps the api key out of a thrown message even when openclaw echoes it back', async () => {
    const run = async (argv, opts) => {
      if (argv[0] === 'config' && argv[1] === 'file') return { ok: true, stdout: '/tmp/openclaw.json', stderr: '' };
      if (argv[0] === 'config' && argv[1] === 'get') return { ok: true, stdout: JSON.stringify(workspaceDir), stderr: '' };
      // openclaw quotes the payload it could not parse — including the key.
      if (argv[0] === 'config' && argv[1] === 'patch') {
        return { ok: false, stdout: '', stderr: `JSON5 parse failed near ${opts?.input}` };
      }
      return { ok: true, stdout: '', stderr: '' };
    };
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-env-')), '.env');
    const err = await installOpenclaw({
      baseUrl: 'https://dc.example.com', apiKey: SAMPLE_KEY, agentId: 'a', writeConfig: true,
      envPath, run, preflightImpl: async () => {}, logger: { info() {}, warn() {} },
    }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(SAMPLE_KEY);
    expect(err.message).toContain('***');
  });
});

describe('resolveApiKey', () => {
  const writeConfigFixture = (config) => {
    const p = join(mkdtempSync(join(tmpdir(), 'oc-key-')), 'openclaw.json');
    writeFileSync(p, typeof config === 'string' ? config : JSON.stringify(config, null, 2));
    return p;
  };
  const stored = (dashclawApiKey) => ({
    plugins: { entries: { 'dashclaw-governance': { config: { dashclawApiKey } } } },
  });

  it('prefers the explicit argument over everything', () => {
    const configPath = writeConfigFixture(stored('from-config'));
    expect(resolveApiKey({ apiKey: 'from-flag', configPath }))
      .toMatchObject({ apiKey: 'from-flag', source: 'argument', migrate: false });
  });

  it('falls back to DASHCLAW_API_KEY in the profile .env before the config', () => {
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-key-')), '.env');
    writeFileSync(envPath, `OTHER=1\nDASHCLAW_API_KEY=${SAMPLE_KEY}\n`);
    const configPath = writeConfigFixture(stored('from-config'));
    const res = resolveApiKey({ envPath, configPath });
    expect(res.apiKey).toBe(SAMPLE_KEY);
    expect(res.migrate).toBe(false);
  });

  // I7: the documented migration of a plaintext key out of openclaw.json can
  // only happen if this last link in the chain exists.
  it('falls back to a plaintext key in openclaw.json and marks it for migration', () => {
    const configPath = writeConfigFixture(stored(SAMPLE_KEY));
    expect(resolveApiKey({ envPath: null, configPath }))
      .toMatchObject({ apiKey: SAMPLE_KEY, source: 'openclaw.json', migrate: true });
  });

  // Verified against openclaw 2026.7.1-2: `config get ...dashclawApiKey` prints
  // __OPENCLAW_REDACTED__, never the key. Accepting that string would write it
  // to .env as the key and break a working install — hence reading the file.
  it('never accepts openclaw\'s redaction marker as a key', () => {
    const configPath = writeConfigFixture(stored('__OPENCLAW_REDACTED__'));
    expect(resolveApiKey({ envPath: null, configPath }).apiKey).toBeNull();

    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-key-')), '.env');
    writeFileSync(envPath, 'DASHCLAW_API_KEY=__OPENCLAW_REDACTED__\n');
    expect(resolveApiKey({ envPath, configPath: null }).apiKey).toBeNull();
  });

  it('returns nothing when every source is empty, missing, or unparseable', () => {
    const envPath = join(mkdtempSync(join(tmpdir(), 'oc-key-')), '.env');
    writeFileSync(envPath, '# DASHCLAW_API_KEY=commented\n');
    expect(resolveApiKey({ envPath, configPath: null }).apiKey).toBeNull();
    expect(resolveApiKey({ envPath: null, configPath: writeConfigFixture({}) }).apiKey).toBeNull();
    expect(resolveApiKey({ envPath: null, configPath: writeConfigFixture(stored(null)) }).apiKey).toBeNull();
    expect(resolveApiKey({ envPath: null, configPath: writeConfigFixture('{not json') }).apiKey).toBeNull();
    expect(resolveApiKey({ envPath: null, configPath: '/no/such/openclaw.json' }).apiKey).toBeNull();
  });
});

describe('installedPluginVersion', () => {
  it('reads the version out of plugins list --json past a stdout banner', async () => {
    const banner = '│\n◇  Config warnings ──╮\n├──╯\n';
    const body = JSON.stringify({ plugins: [{ id: 'other', version: '9.9.9' }, { id: 'dashclaw-governance', version: '1.6.2' }] }, null, 2);
    const run = async () => ({ ok: true, stdout: banner + body, stderr: '' });
    await expect(installedPluginVersion({ run })).resolves.toBe('1.6.2');
  });

  it('returns null when absent, when the command fails, or when output is not JSON', async () => {
    await expect(installedPluginVersion({ run: async () => ({ ok: true, stdout: '{"plugins":[]}', stderr: '' }) })).resolves.toBeNull();
    await expect(installedPluginVersion({ run: async () => ({ ok: false, stdout: '', stderr: 'boom' }) })).resolves.toBeNull();
    await expect(installedPluginVersion({ run: async () => ({ ok: true, stdout: 'not json', stderr: '' }) })).resolves.toBeNull();
  });
});

// Both Criticals in this feature lived behind runOpenclaw, and no test ever
// called it — every installOpenclaw test injected a `run` that returned
// {ok:true} for any argv, so neither the command shape nor the spawn was ever
// observed. These drive the real function against real child processes.
describe('runOpenclaw', () => {
  const node = process.execPath;

  // Child behaviour lives in script FILES, not `node -e '...'`. On Windows the
  // argv is joined into one shell string (see winSafeSpawnArgs), and that
  // quoting cannot carry an argument containing its own double quotes. Real
  // openclaw argv never does — `config`, `patch`, `--stdin`, a plugin id, an
  // npm spec — so this is a constraint on the test, not on the caller.
  let scripts;
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-run-'));
    const write = (name, body) => {
      const p = join(dir, name);
      writeFileSync(p, body);
      return p;
    };
    scripts = {
      echo: write('echo.mjs', 'process.stdout.write("hello");\n'),
      fail: write('fail.mjs', 'process.stderr.write("nope");\nprocess.exit(3);\n'),
      cat: write('cat.mjs', 'let b = "";\nprocess.stdin.on("data", (d) => { b += d; }).on("end", () => process.stdout.write(b));\n'),
      // resume() first: a paused stdin never emits "end", which would look like
      // runOpenclaw failing to close it.
      endOnly: write('end-only.mjs', 'process.stdin.resume();\nprocess.stdin.on("end", () => process.stdout.write("closed"));\n'),
    };
  });

  it('resolves ok:true with stdout for a command that succeeds', async () => {
    const res = await runOpenclaw([scripts.echo], { bin: node });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain('hello');
  });

  it('resolves ok:false with stderr for a non-zero exit, and never rejects', async () => {
    const res = await runOpenclaw([scripts.fail], { bin: node });
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain('nope');
  });

  it('writes `input` to the child stdin — the only way to feed `config patch`', async () => {
    const payload = JSON.stringify({ plugins: { entries: { 'dashclaw-governance': { enabled: true } } } });
    const res = await runOpenclaw([scripts.cat], { bin: node, input: payload });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.stdout)).toEqual(JSON.parse(payload));
  });

  it('closes stdin when there is no input, so the child never hangs', async () => {
    const res = await runOpenclaw([scripts.endOnly], { bin: node });
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe('closed');
  });

  it('resolves ok:false instead of throwing when the binary does not exist', async () => {
    const res = await runOpenclaw(['config', 'file'], { bin: 'definitely-not-a-real-binary-xyz' });
    expect(res.ok).toBe(false);
    expect(res.stderr.length).toBeGreaterThan(0);
  });

  // Windows regression: openclaw ships as openclaw.cmd/.ps1 with no .exe, and
  // node refuses to spawn a .cmd without a shell — bare `openclaw` died with
  // ENOENT and an explicit --openclaw-bin path with EINVAL. winSafeSpawnArgs is
  // what makes this work; the space in the directory name guards the quoting.
  const itWin = process.platform === 'win32' ? it : it.skip;
  itWin('spawns a .cmd on Windows, including from a path containing a space', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc bin '));
    const cmd = join(dir, 'fake-openclaw.cmd');
    writeFileSync(cmd, '@echo off\r\necho spawned-ok\r\n');
    const res = await runOpenclaw(['config', 'file'], { bin: cmd });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain('spawned-ok');
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
