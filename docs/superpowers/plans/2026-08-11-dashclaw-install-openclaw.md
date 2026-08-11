# `dashclaw install openclaw` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third `dashclaw install` target that wires DashClaw governance into an OpenClaw agent correctly, so nobody runs `dashclaw install codex` against an OpenClaw workspace and gets a protocol describing machinery OpenClaw does not have.

**Architecture:** New `cli/lib/openclaw/install.js` mirroring the existing installers — pure exported builders plus one async orchestrator. Schema-shaped risk (`openclaw.json`) is delegated to `openclaw config patch`, which validates. Everything else (`.env`, `AGENTS.md`) is a pure string transform with file IO in the orchestrator only.

**Tech Stack:** Node ESM, vitest, the `openclaw` CLI as a subprocess, `@dashclaw/openclaw-plugin` from npm.

**Spec:** `docs/superpowers/specs/2026-08-11-dashclaw-install-openclaw-design.md`

## Global Constraints

- Test runner is **vitest**. Tests live in `__tests__/unit/`, imported as `import { describe, expect, it } from 'vitest'`. Run with `npx vitest run <path>`.
- Lint is `npm run lint` (`eslint .`) and must pass with zero errors.
- Node ESM only — `import`, not `require`. No new runtime dependencies.
- Reuse, do not re-declare: `replaceManagedBlock`, `AGENTS_MANAGED_START`, `AGENTS_MANAGED_END` from `cli/lib/codex/install.js`; `preflight` from `cli/lib/claude/install.js`.
- Managed markers stay **byte-identical** to the codex installer's. `replaceManagedBlock` matches by `indexOf` and appends when markers are absent, so a renamed marker produces two blocks.
- Pinned plugin version is `1.6.2`. Bumped deliberately, never floated.
- **Never patch `plugins.allow`.** It is an array, and `openclaw config patch` replaces arrays rather than merging them — patching it would wipe every other enabled plugin. Use `openclaw plugins enable` for the allowlist.
- The API key never enters `openclaw.json` unless `--write-config` is passed.
- AGENTS.md target comes from `agents.defaults.workspace`, never from the cwd. This is the bug being fixed.

---

### Task 1: `upsertEnvVar` — .env merge

**Files:**
- Create: `cli/lib/openclaw/install.js`
- Test: `__tests__/unit/cli-openclaw-install.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `upsertEnvVar(source: string, key: string, value: string) => string`

Pure string transform. The spec listed this as `upsertEnvVar(path, key, value)` and marked it pure, which is contradictory; it takes and returns content, and the orchestrator owns file IO.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import { upsertEnvVar } from '../../cli/lib/openclaw/install.js';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: FAIL — cannot find module `cli/lib/openclaw/install.js`

- [ ] **Step 3: Write minimal implementation**

```js
// cli/lib/openclaw/install.js

/**
 * Upsert KEY=value in .env content. Replaces an existing assignment in place so
 * the file never grows a second definition of the same key (the last one would
 * silently win). A commented-out line is not an assignment and is left alone.
 */
export function upsertEnvVar(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(source)) {
    return ensureTrailingNewline(source.replace(pattern, line));
  }
  const base = source.length === 0 || source.endsWith('\n') ? source : `${source}\n`;
  return ensureTrailingNewline(base + line);
}

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add cli/lib/openclaw/install.js __tests__/unit/cli-openclaw-install.test.js
git commit -m "feat(cli): add upsertEnvVar for the openclaw install target"
```

---

### Task 2: The AGENTS.md block and codex-block detection

**Files:**
- Modify: `cli/lib/openclaw/install.js`
- Test: `__tests__/unit/cli-openclaw-install.test.js`

**Interfaces:**
- Consumes: `AGENTS_MANAGED_START`, `AGENTS_MANAGED_END` from `cli/lib/codex/install.js`
- Produces: `buildAgentsMdBlock({ baseUrl, agentId }) => string`, `isCodexAuthoredBlock(source: string) => boolean`

The first test here is the regression guard for the bug that motivated the whole feature.

- [ ] **Step 1: Write the failing test**

```js
import { buildAgentsMdBlock, isCodexAuthoredBlock } from '../../cli/lib/openclaw/install.js';
import { AGENTS_MANAGED_START, AGENTS_MANAGED_END } from '../../cli/lib/codex/install.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: FAIL — `buildAgentsMdBlock is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
import { AGENTS_MANAGED_START, AGENTS_MANAGED_END } from '../codex/install.js';

/**
 * The protocol text for an OpenClaw agent. It describes what is actually true:
 * the plugin intercepts every tool call, so the agent calls nothing itself.
 * The codex block told agents to call an MCP server that OpenClaw never had.
 */
export function buildAgentsMdBlock({ baseUrl, agentId }) {
  return `${AGENTS_MANAGED_START}
## DashClaw Governance Protocol

You are governed by DashClaw through the \`dashclaw-governance\` OpenClaw
plugin. Governance is automatic: the plugin intercepts every tool call.
You call no DashClaw tools yourself — there is no \`dashclaw\` MCP server
in this runtime.

### What happens on every tool call

1. **Guard** — the tool, a risk score, and a parameter summary go to
   \`/api/guard\`. Policies return \`allow\`, \`warn\`, \`block\`, or
   \`require_approval\`.
2. **Record** — a governance record is opened for the action.
3. **Wait** — on \`require_approval\` the call blocks until a human approves
   from the DashClaw dashboard, CLI, or phone.
4. **Outcome** — success or failure is recorded afterward.

An Agent Session opens on your first tool call and closes at run end.
Session start, guard, and recording are therefore already satisfied. Do
not attempt them manually, and never treat their absence as a blocker.

### What you are still responsible for

- **A block is final.** If a call comes back blocked, stop and report the
  reason. Do not retry it via another tool, another path, or a shell
  equivalent.
- **Judge risk before acting.** Treat as risky: shell commands that write
  or delete, file edits outside the project root, network requests,
  package installs, deploys, and any external API new to this session.
- **State your intent** on anything irreversible or outward-facing, so the
  audit trail records why, not just what.

### If governance is unreachable

\`failClosed\` is on, so the plugin blocks the call itself. That is correct
behaviour: report it and wait. Never route around a governance failure by
disabling the plugin or choosing an unguarded path.

### This instance

DashClaw: ${baseUrl}
Your agent id is \`${agentId}\`, set in the plugin config — not something you
set per run.

${AGENTS_MANAGED_END}`;
}

/**
 * Was this block written by `dashclaw install codex`? Requires BOTH signals so
 * prose that merely mentions codex is never rewritten. Only a block that names
 * the MCP session call AND the codex installer is treated as the wrong one.
 */
export function isCodexAuthoredBlock(source) {
  if (typeof source !== 'string') return false;
  return source.includes('dashclaw_session_start') && source.includes('install codex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add cli/lib/openclaw/install.js __tests__/unit/cli-openclaw-install.test.js
git commit -m "feat(cli): openclaw AGENTS.md block + codex-block detection"
```

---

### Task 3: `buildPluginConfigPatch`

**Files:**
- Modify: `cli/lib/openclaw/install.js`
- Test: `__tests__/unit/cli-openclaw-install.test.js`

**Interfaces:**
- Produces: `buildPluginConfigPatch({ agentId, baseUrl, apiKey = null, failClosed = true, writeConfig = false }) => object`

Emits only `plugins.entries['dashclaw-governance']`. Never `plugins.allow` — see Global Constraints.

- [ ] **Step 1: Write the failing test**

```js
import { buildPluginConfigPatch } from '../../cli/lib/openclaw/install.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: FAIL — `buildPluginConfigPatch is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
export const PLUGIN_ENTRY_KEY = 'dashclaw-governance';

/**
 * The object handed to `openclaw config patch`. Objects merge recursively and
 * null deletes a path, so omitting the key is not enough — we set it to null to
 * actively remove a previously stored plaintext key.
 *
 * plugins.allow is deliberately absent: it is an array, and config patch
 * REPLACES arrays, so patching it would drop every other enabled plugin. The
 * allowlist is handled by `openclaw plugins enable`.
 */
export function buildPluginConfigPatch({
  agentId,
  baseUrl,
  apiKey = null,
  failClosed = true,
  writeConfig = false,
}) {
  return {
    plugins: {
      entries: {
        [PLUGIN_ENTRY_KEY]: {
          enabled: true,
          config: {
            agentId,
            dashclawUrl: baseUrl,
            failClosed,
            dashclawApiKey: writeConfig ? apiKey : null,
          },
        },
      },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: PASS, 16 tests

- [ ] **Step 5: Commit**

```bash
git add cli/lib/openclaw/install.js __tests__/unit/cli-openclaw-install.test.js
git commit -m "feat(cli): openclaw plugin config patch builder"
```

---

### Task 4: Subprocess layer

**Files:**
- Modify: `cli/lib/openclaw/install.js`
- Test: `__tests__/unit/cli-openclaw-install.test.js`

**Interfaces:**
- Produces:
  - `openclawBin(env = process.env, override = null) => string`
  - `runOpenclaw(argv: string[], { bin, execFileImpl }) => Promise<{ok, stdout, stderr}>`
  - `resolveConfigPath({ run }) => Promise<string>`
  - `resolveWorkspace({ run }) => Promise<string>`

`run` is injected so every consumer is testable without spawning anything.

- [ ] **Step 1: Write the failing test**

```js
import { openclawBin, resolveConfigPath, resolveWorkspace } from '../../cli/lib/openclaw/install.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: FAIL — `openclawBin is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
import { execFile } from 'node:child_process';

export function openclawBin(env = process.env, override = null) {
  if (override) return override;
  if (env.OPENCLAW_BIN) return env.OPENCLAW_BIN;
  return 'openclaw';
}

/**
 * Run the openclaw CLI. Never through a shell: an argv array keeps a message
 * or JSON5 payload from being mangled by shell/MSYS quoting.
 */
export function runOpenclaw(argv, { bin = 'openclaw', execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    execFileImpl(bin, argv, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

export async function resolveConfigPath({ run }) {
  const res = await run(['config', 'file']);
  if (!res.ok || !res.stdout.trim()) {
    throw new Error(`openclaw config file failed: ${res.stderr.trim() || 'no output'}`);
  }
  return res.stdout.trim();
}

/**
 * The AGENTS.md target. Read from config, never from the cwd — resolving it
 * from the cwd is precisely how a Codex protocol landed in an OpenClaw
 * workspace and fail-closed the agent.
 */
export async function resolveWorkspace({ run }) {
  const res = await run(['config', 'get', 'agents.defaults.workspace']);
  if (!res.ok || !res.stdout.trim()) {
    throw new Error(`openclaw config get agents.defaults.workspace failed: ${res.stderr.trim() || 'no output'}`);
  }
  const raw = res.stdout.trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
  } catch { /* not JSON-quoted — use as-is */ }
  return raw;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
git add cli/lib/openclaw/install.js __tests__/unit/cli-openclaw-install.test.js
git commit -m "feat(cli): openclaw subprocess layer with injected runner"
```

---

### Task 5: `mergeAgentsMd`

**Files:**
- Modify: `cli/lib/openclaw/install.js`
- Test: `__tests__/unit/cli-openclaw-install.test.js`

**Interfaces:**
- Consumes: `buildAgentsMdBlock`, `isCodexAuthoredBlock` (Task 2); `replaceManagedBlock`, `AGENTS_MANAGED_START`, `AGENTS_MANAGED_END` from `cli/lib/codex/install.js`
- Produces: `mergeAgentsMd({ agentsMdPath, baseUrl, agentId }) => { path, backup, migrated }`

- [ ] **Step 1: Write the failing test**

```js
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeAgentsMd } from '../../cli/lib/openclaw/install.js';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: FAIL — `mergeAgentsMd is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { replaceManagedBlock, AGENTS_MANAGED_START, AGENTS_MANAGED_END } from '../codex/install.js';

export function mergeAgentsMd({ agentsMdPath, baseUrl, agentId }) {
  const existed = existsSync(agentsMdPath);
  const source = existed ? readFileSync(agentsMdPath, 'utf8') : '';
  const migrated = isCodexAuthoredBlock(source);

  let backup = null;
  if (existed && source.length > 0) {
    backup = `${agentsMdPath}.dashclaw-backup`;
    copyFileSync(agentsMdPath, backup);
  }

  const next = replaceManagedBlock(source, buildAgentsMdBlock({ baseUrl, agentId }), {
    startMarker: AGENTS_MANAGED_START,
    endMarker: AGENTS_MANAGED_END,
  });
  writeFileSync(agentsMdPath, next);
  return { path: agentsMdPath, backup, migrated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: PASS, 25 tests

- [ ] **Step 5: Commit**

```bash
git add cli/lib/openclaw/install.js __tests__/unit/cli-openclaw-install.test.js
git commit -m "feat(cli): merge the openclaw AGENTS.md block, migrating codex blocks"
```

---

### Task 6: `installOpenclaw` orchestrator

**Files:**
- Modify: `cli/lib/openclaw/install.js`
- Test: `__tests__/unit/cli-openclaw-install.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5; `preflight` from `cli/lib/claude/install.js`
- Produces: `installOpenclaw({ baseUrl, apiKey, agentId, writeConfig, openclawBinPath, workspace, pluginVersion, verify, envPath, env, logger, run, preflightImpl }) => Promise<{configPath, envPath, agentsMd, migrated, verified}>`

Read-only until step 3. Nothing is written until success is known to be possible.

- [ ] **Step 1: Write the failing test**

```js
import { installOpenclaw } from '../../cli/lib/openclaw/install.js';

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
});
```

Add these imports at the top of the test file: `beforeEach` from `vitest`, and `mkdtempSync`, `existsSync`, `readFileSync` from `node:fs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: FAIL — `installOpenclaw is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
import { join } from 'node:path';
import { homedir } from 'node:os';
import { preflight } from '../claude/install.js';

export const OPENCLAW_PLUGIN_SPEC = '@dashclaw/openclaw-plugin';
export const OPENCLAW_PLUGIN_VERSION = '1.6.2';

export async function installOpenclaw({
  baseUrl,
  apiKey,
  agentId = 'openclaw',
  writeConfig = false,
  openclawBinPath = null,
  workspace = null,
  pluginVersion = OPENCLAW_PLUGIN_VERSION,
  verify = true,
  envPath = join(homedir(), '.openclaw', '.env'),
  env = process.env,
  logger = console,
  run = null,
  preflightImpl = preflight,
}) {
  if (!baseUrl) throw new Error('baseUrl is required');
  if (!apiKey) throw new Error('apiKey is required — pass --api-key or set DASHCLAW_API_KEY');

  // 1. Read-only. Fail before touching anything.
  await preflightImpl(baseUrl, apiKey);

  const bin = openclawBin(env, openclawBinPath);
  const exec = run || ((argv) => runOpenclaw(argv, { bin }));

  // 2-3. Locate config.
  const configPath = await resolveConfigPath({ run: exec });
  logger.info(`OpenClaw config: ${configPath}`);

  // 4. Plugin, then allowlist. `plugins enable` owns plugins.allow because
  // config patch replaces arrays.
  const spec = `${OPENCLAW_PLUGIN_SPEC}@${pluginVersion}`;
  const installed = await exec(['plugins', 'install', spec]);
  if (!installed.ok) throw new Error(`openclaw plugins install ${spec} failed: ${installed.stderr.trim()}`);
  await exec(['plugins', 'enable', PLUGIN_ENTRY_KEY]);

  // 5. One validated write.
  const patch = buildPluginConfigPatch({ agentId, baseUrl, apiKey, writeConfig });
  const patched = await exec(['config', 'patch', JSON.stringify(patch)]);
  if (!patched.ok) throw new Error(`openclaw config patch failed: ${patched.stderr.trim()}`);

  // 6. Secret to .env unless explicitly told otherwise.
  if (!writeConfig) {
    const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    writeFileSync(envPath, upsertEnvVar(current, 'DASHCLAW_API_KEY', apiKey));
    logger.info(`Wrote DASHCLAW_API_KEY to ${envPath}`);
  }

  // 7. AGENTS.md in the RESOLVED workspace.
  const ws = workspace || (await resolveWorkspace({ run: exec }));
  const agentsMd = mergeAgentsMd({ agentsMdPath: join(ws, 'AGENTS.md'), baseUrl, agentId });
  if (agentsMd.migrated) {
    logger.info(`Replaced a codex-authored governance block (backup: ${agentsMd.backup})`);
  }

  // 8. Prove it. An install that looks fine while governance is dead is the
  // worst outcome, so a failed doctor is loud.
  let verified = null;
  if (verify) {
    const validated = await exec(['config', 'validate']);
    const doctor = await exec(['plugins', 'doctor']);
    verified = { config: validated.ok, plugins: doctor.ok };
    if (!validated.ok || !doctor.ok) {
      logger.warn(
        'WARNING: install completed but verification failed — governance may not be enforcing.\n' +
        `  config validate: ${validated.ok ? 'ok' : validated.stderr.trim()}\n` +
        `  plugins doctor:  ${doctor.ok ? 'ok' : doctor.stderr.trim()}`,
      );
    }
  }

  return { configPath, envPath, agentsMd, migrated: agentsMd.migrated, verified };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: PASS, 29 tests

- [ ] **Step 5: Run lint and commit**

```bash
npm run lint
git add cli/lib/openclaw/install.js __tests__/unit/cli-openclaw-install.test.js
git commit -m "feat(cli): installOpenclaw orchestrator"
```

---

### Task 7: CLI wiring

**Files:**
- Modify: `cli/bin/dashclaw.js` (import block ~line 15; `cmdInstall` switch at 505-517; help text ~line 91-103)
- Test: `__tests__/unit/cli-openclaw-install.test.js`

**Interfaces:**
- Consumes: `installOpenclaw` (Task 6)
- Produces: `dashclaw install openclaw` command

- [ ] **Step 1: Write the failing test**

```js
import { readFileSync as rf } from 'node:fs';

describe('cli wiring', () => {
  const cli = rf(new URL('../../cli/bin/dashclaw.js', import.meta.url), 'utf8');

  it('routes the openclaw install target', () => {
    expect(cli).toContain("case 'openclaw':");
    expect(cli).toContain('cmdInstallOpenclaw');
  });

  it('documents the target and the key-storage default in help', () => {
    expect(cli).toContain('dashclaw install openclaw');
    expect(cli).toContain('--write-config');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/cli-openclaw-install.test.js`
Expected: FAIL — `expected ... to contain "case 'openclaw':"`

- [ ] **Step 3: Write minimal implementation**

Add to the import block near line 15:

```js
import { installOpenclaw } from '../lib/openclaw/install.js';
```

Add the command function next to `cmdInstallCodex`:

```js
async function cmdInstallOpenclaw() {
  const agentId = getFlag('--agent-id') || 'openclaw';
  const apiKey = getFlag('--api-key') || process.env.DASHCLAW_API_KEY;
  const writeConfig = args.includes('--write-config');
  const openclawBinPath = getFlag('--openclaw-bin') || null;
  const workspace = getFlag('--workspace') || null;
  const pluginVersion = getFlag('--plugin-version') || undefined;
  const verify = !args.includes('--no-verify');

  try {
    const result = await installOpenclaw({
      baseUrl, apiKey, agentId, writeConfig, openclawBinPath, workspace,
      pluginVersion, verify, logger: console,
    });

    console.log();
    console.log(`  ${green('Done.')} DashClaw governance is wired into OpenClaw.`);
    console.log(`  ${dim('Agent id:')} ${agentId}`);
    console.log(`  ${dim('Config:')}   ${result.configPath}`);
    console.log(`  ${dim('AGENTS:')}   ${result.agentsMd.path}${result.agentsMd.backup ? dim(' (backup: ' + result.agentsMd.backup + ')') : ''}`);
    if (!writeConfig) console.log(`  ${dim('Key:')}      ${result.envPath} (DASHCLAW_API_KEY)`);
    if (result.migrated) {
      console.log(`  ${yellow('Replaced a codex-authored governance block.')} That block told the`);
      console.log(`  agent to call an MCP server OpenClaw does not have.`);
    }
    console.log();
    console.log(`  Next: restart the OpenClaw gateway so the plugin loads.`);
  } catch (err) {
    console.error(red(`Error: ${err.message}`));
    process.exit(1);
  }
}
```

Add the case to `cmdInstall`:

```js
    case 'openclaw':
      return cmdInstallOpenclaw();
```

and extend its `default:` hint to mention `| dashclaw install openclaw`.

Add to the help text block:

```
dashclaw install openclaw              Provision DashClaw governance into OpenClaw
--agent-id <id>                      Ledger identity (default: openclaw; set one per machine)
--write-config                       Store the API key in openclaw.json instead of ~/.openclaw/.env
--openclaw-bin <path>                openclaw executable, if not on PATH
--workspace <path>                   Override the workspace resolved from config
--plugin-version <v>                 Plugin version to install (default: 1.6.2)
--no-verify                          Skip config validate + plugins doctor
```

- [ ] **Step 4: Run test and a real invocation**

```bash
npx vitest run __tests__/unit/cli-openclaw-install.test.js
node cli/bin/dashclaw.js install --help
node cli/bin/dashclaw.js install bogus   # expect: unknown target, mentions openclaw
```
Expected: tests PASS (31); help lists the openclaw target; unknown target exits non-zero.

- [ ] **Step 5: Run lint and commit**

```bash
npm run lint
git add cli/bin/dashclaw.js __tests__/unit/cli-openclaw-install.test.js
git commit -m "feat(cli): wire dashclaw install openclaw"
```

---

### Task 8: `/guides/openclaw` page

**Files:**
- Create: `app/guides/openclaw/page.tsx`
- Read first: `app/guides/codex/page.tsx` (copy its structure, metadata export, and component imports exactly)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: a route at `/guides/openclaw`

- [ ] **Step 1: Read the codex guide to match house structure**

```bash
sed -n '1,60p' app/guides/codex/page.tsx
```
Note its `export const metadata`, layout components, and heading rhythm. Mirror them; do not invent a new page shape.

- [ ] **Step 2: Write the page**

Content, in this order:
1. **What this does** — one command wires DashClaw governance into OpenClaw via the `dashclaw-governance` plugin.
2. **Prerequisites** — OpenClaw installed and on PATH, a DashClaw instance URL, an API key.
3. **Install** — `dashclaw install openclaw --agent-id <your-agent-id>`.
4. **Set a distinct agent id per machine** — e.g. `moltfire-openclaw`, `forge-openclaw`, so the audit trail attributes correctly.
5. **Where the key lives** — `~/.openclaw/.env` as `DASHCLAW_API_KEY`; `--write-config` opts into `openclaw.json` instead.
6. **What governance does for you** — the four-step loop (guard → record → wait → outcome) and the automatic Agent Session; the agent calls no DashClaw tools itself.
7. **Restart the gateway.**
8. **Verify** — `openclaw plugins doctor`, then confirm decisions appear in the Decisions ledger.
9. **Troubleshooting** — "my agent says it cannot reach the dashclaw MCP server": OpenClaw has no DashClaw MCP server; if the agent's AGENTS.md says otherwise it holds a stale codex block, and re-running `dashclaw install openclaw` replaces it.

- [ ] **Step 3: Verify it builds and renders**

```bash
npx next build 2>&1 | tail -5
```
Expected: build succeeds and `/guides/openclaw` appears in the route list.

- [ ] **Step 4: Commit**

```bash
npm run lint
git add app/guides/openclaw/page.tsx
git commit -m "docs(guides): add the OpenClaw governance install guide"
```

---

### Task 9: Release surface

**Files:**
- Modify: `README.md`, `CHANGELOG.md`
- Modify: version via the repo's own script

**Interfaces:**
- Consumes: everything above
- Produces: a releasable version

- [ ] **Step 1: Add the target to README**

Find the section listing `dashclaw install claude` / `dashclaw install codex` and add `dashclaw install openclaw` with a one-line description and a link to `/guides/openclaw`.

- [ ] **Step 2: Add the CHANGELOG entry**

Under a new version heading, matching the file's existing style:

```markdown
### Added
- `dashclaw install openclaw` — provisions DashClaw governance into an OpenClaw
  agent: installs and enables `@dashclaw/openclaw-plugin`, writes the plugin
  config through a validated `openclaw config patch`, stores the API key in
  `~/.openclaw/.env`, and writes the governance block into the workspace
  resolved from `agents.defaults.workspace`.

### Fixed
- An OpenClaw workspace provisioned with `dashclaw install codex` received a
  protocol instructing the agent to call `dashclaw_session_start` and
  `dashclaw_guard` through a `dashclaw` MCP server that OpenClaw does not have.
  Agents following it fail-closed and refuse to act while governance is in fact
  operating normally. `dashclaw install openclaw` detects and replaces such a
  block.
```

- [ ] **Step 3: Bump the version**

```bash
node -p "Object.keys(require('./package.json').scripts).filter(k=>/version/.test(k)).join('\n')"
```
Use the repo's own `version:set` script with the next patch version, then:
```bash
npm run version:sync:check
npm run version:check
```
Expected: both pass.

- [ ] **Step 4: Full verification**

```bash
npm run lint
npx vitest run __tests__/unit/cli-openclaw-install.test.js
npx vitest run __tests__/unit/cli-codex-install.test.js
```
Expected: lint clean; both suites pass. The codex suite must still pass — Task 5 imports from that module and must not have changed its behaviour.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md package.json sdk/package.json sdk-python/pyproject.toml
git commit -m "chore(release): ship the openclaw install target"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Hybrid approach (config patch / plugins CLI / direct writes) | 4, 6 |
| Secret handling → `.env`, `--write-config` escape | 1, 3, 6 |
| Migrate plaintext key out of config | 3 (null deletes) |
| Components table | 1–6 |
| Workspace resolution, not cwd | 4 (`resolveWorkspace`), 6, tested in 6 |
| Data flow ordering, read-only until step 3 | 6 (preflight-abort test) |
| Codex block migration, automatic, backup | 5 |
| Markers byte-identical | 2 (test), 5 (reuses constants) |
| AGENTS.md block content | 2 |
| Error handling, loud verification failure | 6 |
| Testing list | 1–6 |
| Flags | 7 |
| Ship surface | 8, 9 |

No spec requirement is unimplemented. Out-of-scope items (the `dashclaw doctor` check) are correctly absent.

**Placeholder scan:** No TBD/TODO. Every code step carries real code. Task 8 describes page *content* rather than pasting TSX because the house structure must be copied from the existing guide — Step 1 makes reading it mandatory.

**Type consistency:** `upsertEnvVar(source, key, value)` is string→string in Task 1 and used that way in Task 6. `mergeAgentsMd` returns `{path, backup, migrated}` in Task 5, consumed as `result.agentsMd.path` / `.backup` / `.migrated` in Tasks 6–7. `run`/`exec` returns `{ok, stdout, stderr}` everywhere. `PLUGIN_ENTRY_KEY` is defined in Task 3 and used in Task 6.

**One deviation from the spec, deliberate:** the spec's component table lists `upsertEnvVar(path, key, value)` as pure, which cannot both be true. The plan makes it a pure string transform and moves file IO into the orchestrator.
