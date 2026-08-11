import { describe, expect, it } from 'vitest';
import { upsertEnvVar, buildAgentsMdBlock, isCodexAuthoredBlock, buildPluginConfigPatch, openclawBin, resolveConfigPath, resolveWorkspace } from '../../cli/lib/openclaw/install.js';
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
