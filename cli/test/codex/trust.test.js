// cli/test/codex/trust.test.js
//
// Tests for the hook auto-trust step. The app-server RPC and binary
// discovery are injected so no real codex binary is needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseCodexVersion,
  compareVersions,
  tomlKeyString,
  buildHookStateEntry,
  upsertHooksState,
  samePath,
  autoTrustHooks,
  MIN_HOOK_VERSION,
} from '../../lib/codex/trust.js';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const silentLogger = { info() {}, warn() {} };

const KEY_A = 'C:\\Users\\u\\codex-home\\config.toml:pre_tool_use:0:0';
const KEY_B = 'C:\\Users\\u\\codex-home\\config.toml:stop:0:0';

describe('parseCodexVersion / compareVersions', () => {
  it('parses codex --version output', () => {
    assert.equal(parseCodexVersion('codex-cli 0.144.3\n'), '0.144.3');
    assert.equal(parseCodexVersion('garbage'), null);
  });

  it('compares semver-ish versions', () => {
    assert.ok(compareVersions('0.144.3', MIN_HOOK_VERSION) > 0);
    assert.ok(compareVersions('0.139.0', MIN_HOOK_VERSION) < 0);
    assert.equal(compareVersions('0.142.0', MIN_HOOK_VERSION), 0);
  });
});

describe('tomlKeyString / buildHookStateEntry', () => {
  it('uses a literal string for keys without single quotes', () => {
    assert.equal(tomlKeyString(KEY_A), `'${KEY_A}'`);
  });

  it('falls back to an escaped basic string when the key has a single quote', () => {
    const key = "C:\\Users\\o'brien\\config.toml:stop:0:0";
    assert.equal(
      tomlKeyString(key),
      '"C:\\\\Users\\\\o\'brien\\\\config.toml:stop:0:0"',
    );
  });

  it('builds a state table with enabled + trusted_hash', () => {
    const entry = buildHookStateEntry({ key: KEY_A, hash: 'sha256:abc' });
    assert.equal(
      entry,
      `[hooks.state.'${KEY_A}']\nenabled = true\ntrusted_hash = "sha256:abc"`,
    );
  });
});

describe('upsertHooksState', () => {
  it('appends new state tables at the end', () => {
    const src = 'approval_policy = "never"\n\n[mcp_servers.dashclaw]\ncommand = "node"\n';
    const out = upsertHooksState(src, [
      { key: KEY_A, hash: 'sha256:one' },
      { key: KEY_B, hash: 'sha256:two' },
    ]);
    assert.ok(out.startsWith(src.trimEnd()));
    assert.match(out, /\[hooks\.state\.'[^']*pre_tool_use:0:0'\]\nenabled = true\ntrusted_hash = "sha256:one"/);
    assert.match(out, /\[hooks\.state\.'[^']*stop:0:0'\]\nenabled = true\ntrusted_hash = "sha256:two"/);
  });

  it('replaces an existing table for the same key without duplicating it', () => {
    const src = [
      '[mcp_servers.dashclaw]',
      'command = "node"',
      '',
      `[hooks.state.'${KEY_A}']`,
      'enabled = true',
      'trusted_hash = "sha256:stale"',
      '',
      '[other.table]',
      'k = 1',
      '',
    ].join('\n');
    const out = upsertHooksState(src, [{ key: KEY_A, hash: 'sha256:fresh' }]);
    assert.equal(out.match(/pre_tool_use:0:0/g).length, 1);
    assert.ok(!out.includes('sha256:stale'));
    assert.ok(out.includes('trusted_hash = "sha256:fresh"'));
    // Non-state content survives.
    assert.ok(out.includes('[mcp_servers.dashclaw]'));
    assert.ok(out.includes('[other.table]'));
  });

  it('is idempotent for identical entries', () => {
    const once = upsertHooksState('', [{ key: KEY_A, hash: 'sha256:x' }]);
    const twice = upsertHooksState(once, [{ key: KEY_A, hash: 'sha256:x' }]);
    assert.equal(once.trim(), twice.trim());
  });
});

describe('samePath', () => {
  it('matches identical paths and (on win32) ignores case', () => {
    assert.ok(samePath('C:\\a\\b', 'C:\\a\\b'));
    if (process.platform === 'win32') {
      assert.ok(samePath('C:\\A\\B', 'c:\\a\\b'));
    }
    assert.ok(!samePath('C:\\a', 'C:\\b'));
  });
});

describe('autoTrustHooks', () => {
  function writeConfig(dir) {
    const configPath = path.join(dir, 'config.toml');
    fs.writeFileSync(configPath, 'approval_policy = "never"\n');
    return configPath;
  }

  const fakeBin = { bin: 'C:\\fake\\codex.exe', version: '0.144.3' };

  it('writes state entries and verifies trusted on the happy path', async () => {
    const dir = makeTempDir('dashclaw-trust-');
    const configPath = writeConfig(dir);
    let calls = 0;
    const hook = (trustStatus) => ({
      key: `${configPath}:pre_tool_use:0:0`,
      currentHash: 'sha256:h1',
      sourcePath: configPath,
      trustStatus,
    });
    const result = await autoTrustHooks({
      configPath,
      codexHome: dir,
      logger: silentLogger,
      findBin: () => fakeBin,
      listHooks: async () => {
        calls++;
        return [hook(calls === 1 ? 'untrusted' : 'trusted')];
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'trusted');
    assert.equal(result.trusted, 1);
    assert.equal(result.verified, true);
    const config = fs.readFileSync(configPath, 'utf8');
    assert.ok(config.includes(`[hooks.state.'${configPath}:pre_tool_use:0:0']`));
    assert.ok(config.includes('trusted_hash = "sha256:h1"'));
  });

  it('reports no-codex-binary without touching the config', async () => {
    const dir = makeTempDir('dashclaw-trust-');
    const configPath = writeConfig(dir);
    const before = fs.readFileSync(configPath, 'utf8');
    const result = await autoTrustHooks({
      configPath,
      codexHome: dir,
      logger: silentLogger,
      findBin: () => null,
      listHooks: async () => {
        throw new Error('must not be called');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-codex-binary');
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
  });

  it('reports rpc-failed when hooks/list dies', async () => {
    const dir = makeTempDir('dashclaw-trust-');
    const configPath = writeConfig(dir);
    const result = await autoTrustHooks({
      configPath,
      codexHome: dir,
      logger: silentLogger,
      findBin: () => fakeBin,
      listHooks: async () => {
        throw new Error('spawn blew up');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'rpc-failed');
    assert.match(result.detail, /spawn blew up/);
  });

  it('reports no-hooks-found when the config defines no hooks', async () => {
    const dir = makeTempDir('dashclaw-trust-');
    const configPath = writeConfig(dir);
    const result = await autoTrustHooks({
      configPath,
      codexHome: dir,
      logger: silentLogger,
      findBin: () => fakeBin,
      listHooks: async () => [
        {
          key: 'elsewhere:stop:0:0',
          currentHash: 'sha256:zzz',
          sourcePath: path.join(dir, 'other.toml'),
          trustStatus: 'untrusted',
        },
      ],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-hooks-found');
  });

  it('flags verify-failed when hooks stay untrusted after the write', async () => {
    const dir = makeTempDir('dashclaw-trust-');
    const configPath = writeConfig(dir);
    const result = await autoTrustHooks({
      configPath,
      codexHome: dir,
      logger: silentLogger,
      findBin: () => fakeBin,
      listHooks: async () => [
        {
          key: `${configPath}:stop:0:0`,
          currentHash: 'sha256:h2',
          sourcePath: configPath,
          trustStatus: 'untrusted',
        },
      ],
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'verify-failed');
  });

  it('reports verify-unavailable (not trusted) when the re-list throws', async () => {
    const dir = makeTempDir('dashclaw-trust-');
    const configPath = writeConfig(dir);
    let calls = 0;
    const result = await autoTrustHooks({
      configPath,
      codexHome: dir,
      logger: silentLogger,
      findBin: () => fakeBin,
      listHooks: async () => {
        calls++;
        if (calls === 1) {
          return [
            {
              key: `${configPath}:pre_tool_use:0:0`,
              currentHash: 'sha256:h3',
              sourcePath: configPath,
              trustStatus: 'untrusted',
            },
          ];
        }
        throw new Error('app-server hung up');
      },
    });
    // Verification never ran to completion, so this must NOT be reported as
    // trusted/ok — that would be a false "governance is enforcing" claim.
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'verify-unavailable');
    assert.equal(result.verified, null);
    assert.match(result.detail, /app-server hung up/);
  });
});
