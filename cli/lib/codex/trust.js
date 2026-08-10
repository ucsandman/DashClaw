// cli/lib/codex/trust.js
//
// Hook trust automation for `dashclaw install codex`.
//
// codex-cli >= 0.142 refuses to run hooks it has not been told to trust —
// SILENTLY (no prompt, no log line; the hook just never fires). Trust lives
// in config.toml as tables of the form
//
//     [hooks.state.'<config-path>:<event>:0:0']
//     enabled = true
//     trusted_hash = "sha256:..."
//
// There is no codex CLI or RPC method that writes these entries. The
// supported source of truth for the hash is the app-server `hooks/list`
// response: each hook reports its `key` (exactly the hooks.state table key)
// and `currentHash`. So we spawn `codex app-server`, run
// initialize -> hooks/list over newline-delimited JSON-RPC on stdio, and
// upsert one state table per hook that our config file defines. The hash
// covers only the hook definition (command/timeout/matcher), not the config
// path, so writing `currentHash` back is always the correct trust value.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

// -----------------------------------------------------------------------------
// codex binary discovery
// -----------------------------------------------------------------------------

// First codex version whose hook engine both runs config-table hooks and
// enforces the trust gate. Older binaries either run no hooks at all (0.13x)
// or predate the trust model.
export const MIN_HOOK_VERSION = '0.142.0';

export function parseCodexVersion(stdout) {
  const m = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(String(stdout || ''));
  return m ? m[1] : null;
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function versionOf(bin) {
  try {
    const out = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (out.error || out.status !== 0) return null;
    return parseCodexVersion(out.stdout);
  } catch {
    return null;
  }
}

// OpenClaw vendors codex inside its plugin trees. Two known layouts:
//   <root>/node_modules/@openclaw/codex/node_modules/@openai/codex-<plat>/vendor/<target>/bin/codex(.exe)
//   <root>/node_modules/@openclaw/codex/node_modules/@openai/codex-<plat>/vendor/<target>/codex/codex(.exe)
function openclawVendoredCandidates(env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const roots = [];
  const projectsDir = join(home, '.openclaw', 'npm', 'projects');
  if (existsSync(projectsDir)) {
    for (const name of safeReaddir(projectsDir)) roots.push(join(projectsDir, name));
  }
  roots.push(join(home, '.openclaw', 'npm'));

  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const found = [];
  for (const root of roots) {
    const openaiDir = join(root, 'node_modules', '@openclaw', 'codex', 'node_modules', '@openai');
    for (const pkg of safeReaddir(openaiDir)) {
      const vendorDir = join(openaiDir, pkg, 'vendor');
      for (const target of safeReaddir(vendorDir)) {
        for (const sub of ['bin', 'codex']) {
          const candidate = join(vendorDir, target, sub, exe);
          if (existsSync(candidate)) found.push(candidate);
        }
      }
    }
  }
  return found;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function pathCodexCandidate() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = spawnSync(finder, ['codex'], { encoding: 'utf8', timeout: 10000 });
    if (out.status !== 0) return null;
    const first = String(out.stdout || '').split(/\r?\n/).find((l) => l.trim());
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

// Find the newest hook-capable codex binary. Vendored OpenClaw copies are
// checked first (that lane is why this module exists), then PATH. Returns
// { bin, version } or null when nothing >= MIN_HOOK_VERSION exists.
export function findCodexBin({ env = process.env, explicit = null } = {}) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  candidates.push(...openclawVendoredCandidates(env));
  const onPath = pathCodexCandidate();
  if (onPath) candidates.push(onPath);

  let best = null;
  for (const bin of candidates) {
    const version = versionOf(bin);
    if (!version) continue;
    if (compareVersions(version, MIN_HOOK_VERSION) < 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { bin, version };
    // An explicit bin that qualifies always wins.
    if (explicit && bin === explicit) return { bin, version };
  }
  return best;
}

// -----------------------------------------------------------------------------
// app-server hooks/list client
// -----------------------------------------------------------------------------

export function listCodexHooks({ codexBin, codexHome, cwd, timeoutMs = 30000 }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(codexBin, ['app-server'], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    let settled = false;
    const pending = new Map();
    let nextId = 1;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // already dead
      }
      if (err) rejectPromise(err);
      else resolvePromise(value);
    };

    const timer = setTimeout(
      () => finish(new Error(`codex app-server did not answer hooks/list within ${timeoutMs}ms`)),
      timeoutMs,
    );

    const send = (method, params) => {
      const id = nextId++;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise((res, rej) => pending.set(id, { res, rej }));
    };

    child.on('error', (err) => finish(new Error(`failed to spawn ${codexBin}: ${err.message}`)));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`codex app-server exited early (code ${code})`));
    });

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // stray non-JSON output (warnings etc.)
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) p.rej(new Error(`${msg.error.code || ''} ${msg.error.message || JSON.stringify(msg.error)}`));
          else p.res(msg.result);
        }
        // Server notifications are ignored.
      }
    });

    (async () => {
      await send('initialize', {
        clientInfo: { name: 'dashclaw-install', version: '1.0.0' },
      });
      const result = await send('hooks/list', { cwds: cwd ? [cwd] : [] });
      const hooks = [];
      for (const entry of result.data || []) {
        for (const h of entry.hooks || []) hooks.push(h);
      }
      finish(null, hooks);
    })().catch((err) => finish(err));
  });
}

// -----------------------------------------------------------------------------
// hooks.state TOML upsert
// -----------------------------------------------------------------------------

// The state-table key embeds an absolute config path (backslashes on
// Windows), so it must be a quoted TOML key. Prefer a literal (single-quoted)
// string — no escaping — and fall back to a basic string when the key itself
// contains a single quote.
export function tomlKeyString(key) {
  if (!key.includes("'")) return `'${key}'`;
  return '"' + key.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function buildHookStateEntry({ key, hash }) {
  return [
    `[hooks.state.${tomlKeyString(key)}]`,
    'enabled = true',
    `trusted_hash = "${hash}"`,
  ].join('\n');
}

// Upsert [hooks.state.'<key>'] tables in a config.toml source string. Each
// entry replaces any existing table for the same key (whichever quoting form
// it used); new entries append at the end of the file, outside any managed
// block. Pure function so it is unit-testable.
export function upsertHooksState(source, entries) {
  let out = source;
  for (const entry of entries) {
    out = removeHookStateTable(out, entry.key);
    const sep = out.length === 0 || out.endsWith('\n\n') ? '' : out.endsWith('\n') ? '\n' : '\n\n';
    out = out + sep + buildHookStateEntry(entry) + '\n';
  }
  return out;
}

function removeHookStateTable(source, key) {
  const literalHeader = `[hooks.state.'${key}']`;
  const basicHeader = `[hooks.state."${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  const lines = source.split('\n');
  const outLines = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (skipping) {
      // A table ends at the next table header.
      if (trimmed.startsWith('[')) skipping = false;
      else continue;
    }
    if (trimmed === literalHeader || trimmed === basicHeader) {
      skipping = true;
      // Drop a preceding blank line so removal doesn't leave double gaps.
      if (outLines.length > 0 && outLines[outLines.length - 1].trim() === '') outLines.pop();
      continue;
    }
    outLines.push(line);
  }
  return outLines.join('\n');
}

// -----------------------------------------------------------------------------
// top-level trust step
// -----------------------------------------------------------------------------

export function samePath(a, b) {
  if (!a || !b) return false;
  const na = resolve(String(a));
  const nb = resolve(String(b));
  if (process.platform === 'win32') return na.toLowerCase() === nb.toLowerCase();
  return na === nb;
}

// Trust every hook that `configPath` defines. Returns a result object; never
// throws for the expected failure modes (no binary, RPC failure) — the
// caller decides how loudly to surface them.
export async function autoTrustHooks({
  configPath,
  codexHome,
  cwd = process.cwd(),
  explicitBin = null,
  env = process.env,
  logger = console,
  listHooks = listCodexHooks, // injectable for tests
  findBin = findCodexBin, // injectable for tests
}) {
  const found = findBin({ env, explicit: explicitBin });
  if (!found) {
    return {
      ok: false,
      reason: 'no-codex-binary',
      detail: `No codex binary >= ${MIN_HOOK_VERSION} found (checked --codex-bin, OpenClaw vendored copies, PATH).`,
    };
  }

  let hooks;
  try {
    hooks = await listHooks({ codexBin: found.bin, codexHome, cwd });
  } catch (err) {
    return { ok: false, reason: 'rpc-failed', detail: err.message, bin: found.bin, version: found.version };
  }

  const mine = hooks.filter((h) => samePath(h.sourcePath, configPath));
  if (mine.length === 0) {
    return {
      ok: false,
      reason: 'no-hooks-found',
      detail: `hooks/list returned no hooks sourced from ${configPath}`,
      bin: found.bin,
      version: found.version,
    };
  }

  const entries = mine.map((h) => ({ key: h.key, hash: h.currentHash }));
  const before = readFileSync(configPath, 'utf8');
  const after = upsertHooksState(before, entries);
  if (after !== before) writeFileSync(configPath, after);

  // Verify: re-list and require every one of our hooks to report trusted.
  let verified = null;
  try {
    const recheck = await listHooks({ codexBin: found.bin, codexHome, cwd });
    const still = recheck.filter((h) => samePath(h.sourcePath, configPath));
    verified = still.length > 0 && still.every((h) => h.trustStatus === 'trusted');
  } catch (err) {
    logger.warn(`Trust verification re-list failed: ${err.message}`);
  }

  return {
    ok: verified !== false,
    reason: verified === false ? 'verify-failed' : 'trusted',
    trusted: entries.length,
    verified,
    bin: found.bin,
    version: found.version,
  };
}
