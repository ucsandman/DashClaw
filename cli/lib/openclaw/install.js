// cli/lib/openclaw/install.js

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { replaceManagedBlock, AGENTS_MANAGED_START, AGENTS_MANAGED_END } from '../codex/install.js';
import { preflight } from '../claude/install.js';
import { winSafeSpawnArgs } from '../up/run.js';

/**
 * Upsert KEY=value in .env content. Replaces an existing assignment in place so
 * the file never grows a second definition of the same key (the last one would
 * silently win). A commented-out line is not an assignment and is left alone.
 */
export function upsertEnvVar(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(source)) {
    return ensureTrailingNewline(source.replace(pattern, () => line));
  }
  const base = source.length === 0 || source.endsWith('\n') ? source : `${source}\n`;
  return ensureTrailingNewline(base + line);
}

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
 * Was this block written by \`dashclaw install codex\`? Requires BOTH signals so
 * prose that merely mentions codex is never rewritten. Only a block that names
 * the MCP session call AND the codex installer is treated as the wrong one.
 */
export function isCodexAuthoredBlock(source) {
  if (typeof source !== 'string') return false;
  return source.includes('dashclaw_session_start') && source.includes('install codex');
}

export const PLUGIN_ENTRY_KEY = 'dashclaw-governance';

/**
 * The object handed to `openclaw config patch`. Objects merge recursively and
 * null deletes a path, so omitting the key is not enough — we set it to null to
 * actively remove a previously stored plaintext key.
 *
 * plugins.allow is deliberately absent: it is an array, and config patch
 * REPLACES arrays, so patching it would drop every other enabled plugin.
 *
 * `openclaw plugins enable` owns the allowlist instead. Verified empirically
 * against openclaw 2026.7.1-2: with a NON-EMPTY plugins.allow that lacks the
 * id, `plugins enable` APPENDS the id to the array and exits 0 — it does not
 * refuse. It exits 1 ("Plugin not found") only when the plugin is not
 * installed, so it cannot exit 0 while leaving governance unenabled. The
 * post-install verify re-reads `plugins.entries.<id>.enabled` anyway, because
 * "reported success, nothing enforcing" is the one outcome that must never be
 * silent.
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

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}

export function openclawBin(env = process.env, override = null) {
  if (override) return override;
  if (env.OPENCLAW_BIN) return env.OPENCLAW_BIN;
  return 'openclaw';
}

/**
 * openclaw prints a "Config warnings" banner to STDOUT — not stderr — ahead of
 * the value a `config file` / `config get` caller asked for (verified against
 * 2026.7.1-2; a single stale plugins.allow entry is enough to trigger it). So
 * the value is the LAST non-empty line, never the whole stream: trimming the
 * stream instead hands the caller a box-drawn banner as its "config path".
 */
export function lastLine(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

/**
 * `openclaw config file` reports `~\.openclaw-x\openclaw.json` with a LITERAL
 * tilde. Node expands nothing, so joining that path writes into a directory
 * actually named "~" beside the cwd. Expand it before any fs call.
 */
export function expandHome(p, home = homedir()) {
  if (typeof p !== 'string' || p.length === 0) return p;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p;
}

/** Strip one layer of surrounding quotes from a CLI-printed scalar. */
function unquote(s) {
  const t = String(s ?? '').trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * The JSON document at the tail of a stdout stream that may open with a banner.
 * The FIRST line that opens an object is the document's own opening brace — the
 * banner is box-drawing characters and contains none. Searching from the end
 * instead lands on a nested object inside the document.
 */
function jsonTail(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trimStart().startsWith('{'));
  return start === -1 ? String(stdout ?? '') : lines.slice(start).join('\n');
}

/**
 * Keep a secret out of anything we throw or print. The key never reaches argv
 * any more, but `config patch --stdin` can quote the payload it failed to parse
 * back at us, so every message built from subprocess output goes through here.
 */
export function redactKey(text, key) {
  const s = String(text ?? '');
  const k = String(key ?? '');
  return k.length >= 6 ? s.split(k).join('***') : s;
}

/** true when `actual` is the same release as `wanted` or newer (prerelease ignored). */
export function isVersionAtLeast(actual, wanted) {
  const parts = (v) => String(v ?? '').trim().replace(/^v/, '').split('-')[0].split('.')
    .map((n) => (Number.isFinite(parseInt(n, 10)) ? parseInt(n, 10) : 0));
  const a = parts(actual);
  const b = parts(wanted);
  if (!/\d/.test(String(actual ?? ''))) return false;
  for (let i = 0; i < 3; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/**
 * Run the openclaw CLI and collect its output.
 *
 * Spawned through winSafeSpawnArgs (cli/lib/up/run.js): on Windows `openclaw`
 * ships as openclaw.cmd/.ps1 with no .exe, and node refuses to spawn a .cmd
 * without a shell — execFile there died with `spawn openclaw ENOENT`, or
 * `spawn EINVAL` when handed an explicit .cmd via --openclaw-bin. That helper
 * joins into ONE shell string rather than pairing shell:true with an args
 * array, which is deprecated (DEP0190) and prints a warning mid-install.
 *
 * `input` is written to the child's stdin — the only way to hand
 * `config patch` its payload, since that subcommand takes no positional
 * argument, and the only way to keep an API key out of argv and the process
 * table.
 */
export function runOpenclaw(argv, { bin = 'openclaw', input = null, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const safe = winSafeSpawnArgs(bin, argv);
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawnImpl(safe.cmd, safe.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...safe.opts });
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: String(err?.message || err) });
      return;
    }
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    // A spawn that never started still gets its stdin written to; swallow the
    // EPIPE so the real failure (the 'error' event) is what the caller sees.
    child.stdin?.on('error', () => {});
    child.on('error', (err) => resolve({ ok: false, stdout, stderr: stderr || String(err?.message || err) }));
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }));
    child.stdin?.end(input == null ? '' : String(input));
  });
}

export async function resolveConfigPath({ run }) {
  const res = await run(['config', 'file']);
  const value = lastLine(res.stdout);
  if (!res.ok || !value) {
    throw new Error(`openclaw config file failed: ${res.stderr.trim() || 'no output'}`);
  }
  return expandHome(value);
}

/**
 * The AGENTS.md target. Read from config, never from the cwd — resolving it
 * from the cwd is precisely how a Codex protocol landed in an OpenClaw
 * workspace and fail-closed the agent.
 */
export async function resolveWorkspace({ run }) {
  const res = await run(['config', 'get', 'agents.defaults.workspace']);
  const raw = lastLine(res.stdout);
  // 'null'/'undefined' are what `config get` prints for a configured-but-empty
  // workspace. Treating them as a path joins them against the cwd, which is
  // exactly the cwd-resolution this function exists to prevent.
  if (!res.ok || !raw || raw === 'null' || raw === 'undefined' || raw === '""') {
    throw new Error(
      `openclaw config get agents.defaults.workspace failed: ${res.stderr.trim() || raw || 'no output'}. ` +
      'Set a workspace in openclaw.json or pass --workspace <path>.',
    );
  }
  let value = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') value = parsed;
  } catch { /* not JSON-quoted — use as-is */ }
  if (!value || value === 'null' || value === 'undefined') {
    throw new Error(
      'openclaw config get agents.defaults.workspace returned an empty workspace. ' +
      'Set a workspace in openclaw.json or pass --workspace <path>.',
    );
  }
  return expandHome(value);
}

/**
 * What `openclaw config get` prints in place of a secret-shaped config value —
 * so `config get ...dashclawApiKey` can never return the key itself.
 */
export const OPENCLAW_REDACTED = '__OPENCLAW_REDACTED__';

/**
 * The API key, in the precedence the guide documents: explicit argument (which
 * already carries --api-key / DASHCLAW_API_KEY / saved config), then the
 * profile's .env, then a plaintext `dashclawApiKey` left in openclaw.json.
 * `migrate` marks that last case: the key is rewritten to .env and deleted from
 * the config by the patch, so a plaintext key does not survive a re-install.
 *
 * That last link reads openclaw.json (strict JSON) DIRECTLY. Asking the CLI
 * would return the literal string `__OPENCLAW_REDACTED__`, which then gets
 * written to .env as the key and destroys a working install.
 */
export function resolveApiKey({ apiKey = null, envPath = null, configPath = null }) {
  if (apiKey) return { apiKey, source: 'argument', migrate: false };

  if (envPath && existsSync(envPath)) {
    const match = readFileSync(envPath, 'utf8').match(/^DASHCLAW_API_KEY=(.*)$/m);
    const fromEnvFile = match ? unquote(match[1]) : '';
    if (fromEnvFile && fromEnvFile !== OPENCLAW_REDACTED) {
      return { apiKey: fromEnvFile, source: envPath, migrate: false };
    }
  }

  if (configPath && existsSync(configPath)) {
    try {
      const stored = JSON.parse(readFileSync(configPath, 'utf8'))
        ?.plugins?.entries?.[PLUGIN_ENTRY_KEY]?.config?.dashclawApiKey;
      if (typeof stored === 'string' && stored && stored !== OPENCLAW_REDACTED) {
        return { apiKey: stored, source: 'openclaw.json', migrate: true };
      }
    } catch { /* unreadable or not JSON — this link of the chain simply misses */ }
  }

  return { apiKey: null, source: null, migrate: false };
}

/** Version of the already-installed governance plugin, or null if absent. */
export async function installedPluginVersion({ run, id = PLUGIN_ENTRY_KEY }) {
  const res = await run(['plugins', 'list', '--json']);
  if (!res.ok) return null;
  try {
    const found = (JSON.parse(jsonTail(res.stdout))?.plugins || []).find((p) => p?.id === id);
    return typeof found?.version === 'string' ? found.version : null;
  } catch {
    return null;
  }
}

/**
 * Write the governance block into a project's AGENTS.md — creating the file if absent,
 * preserving surrounding content, and replacing a pre-existing wrong block (one authored
 * for a different runtime) while leaving a backup.
 */
export function mergeAgentsMd({ agentsMdPath, baseUrl, agentId }) {
  const existed = existsSync(agentsMdPath);
  const source = existed ? readFileSync(agentsMdPath, 'utf8') : '';
  const migrated = isCodexAuthoredBlock(source);

  const backup = backupOnce(agentsMdPath);

  const next = replaceManagedBlock(source, buildAgentsMdBlock({ baseUrl, agentId }), {
    startMarker: AGENTS_MANAGED_START,
    endMarker: AGENTS_MANAGED_END,
  });
  writeFileSync(agentsMdPath, next);
  return { path: agentsMdPath, backup, migrated };
}

function backupOnce(path) {
  if (!existsSync(path)) return null;
  const bak = path + '.dashclaw-bak';
  if (existsSync(bak)) return bak;
  copyFileSync(path, bak);
  return bak;
}

export const OPENCLAW_PLUGIN_SPEC = '@dashclaw/openclaw-plugin';
export const OPENCLAW_PLUGIN_VERSION = '1.6.2';

/**
 * `dashclaw install openclaw` orchestrator.
 *
 * NOTHING is written until preflight passes. Subprocesses run before it only
 * when they must: with no key supplied, the documented precedence chain has to
 * read the profile's .env and openclaw.json to find one, and both of those
 * lookups are read-only.
 */
export async function installOpenclaw({
  baseUrl,
  apiKey,
  agentId = 'openclaw',
  writeConfig = false,
  openclawBinPath = null,
  workspace = null,
  pluginVersion = OPENCLAW_PLUGIN_VERSION,
  verify = true,
  envPath = null,
  env = process.env,
  logger = console,
  run = null,
  preflightImpl = preflight,
}) {
  if (!baseUrl) throw new Error('baseUrl is required — pass --base-url or set DASHCLAW_BASE_URL');

  const bin = openclawBin(env, openclawBinPath);
  const exec = run || ((argv, opts) => runOpenclaw(argv, { ...opts, bin }));

  // The .env lives beside openclaw.json so it follows --profile. A hardcoded
  // ~/.openclaw/.env writes the key into the DEFAULT profile no matter which
  // profile the rest of the install just configured.
  let configPath = null;
  let resolvedEnvPath = envPath;
  const locate = async () => {
    if (!configPath) configPath = await resolveConfigPath({ run: exec });
    if (!resolvedEnvPath) resolvedEnvPath = join(dirname(configPath), '.env');
    return configPath;
  };

  let key = apiKey;
  let keySource = 'argument';
  let keyMigrated = false;
  if (!key) {
    await locate();
    const found = resolveApiKey({ apiKey, envPath: resolvedEnvPath, configPath });
    key = found.apiKey;
    keySource = found.source;
    keyMigrated = found.migrate;
  }
  if (!key) throw new Error('apiKey is required — pass --api-key or set DASHCLAW_API_KEY');

  // 1. Read-only. Fail before touching anything.
  await preflightImpl(baseUrl, key);

  // 2-3. Locate config.
  await locate();
  logger.info(`OpenClaw config: ${configPath}`);
  if (keySource && keySource !== 'argument') logger.info(`Using the API key found in ${keySource}`);

  // 4. Plugin. Skipped when an equal-or-newer build is already installed:
  // re-running this installer is the documented remedy for a broken agent, and
  // an unconditional pinned install silently DOWNGRADES a user on a newer one.
  const spec = `${OPENCLAW_PLUGIN_SPEC}@${pluginVersion}`;
  const present = await installedPluginVersion({ run: exec });
  let resolvedPluginVersion = present;
  if (present && isVersionAtLeast(present, pluginVersion)) {
    logger.info(`${PLUGIN_ENTRY_KEY} ${present} already installed (>= ${pluginVersion}) — keeping it.`);
  } else {
    const installed = await exec(['plugins', 'install', spec]);
    if (!installed.ok) throw new Error(`openclaw plugins install ${spec} failed: ${installed.stderr.trim()}`);
    resolvedPluginVersion = pluginVersion;
  }

  // 5. Back up, then ONE validated write — BEFORE the plugin goes live. The
  // reverse order is what bricks an agent: a failed patch behind a successful
  // enable leaves a live plugin with failClosed and no url, so it refuses every
  // tool call. Failing here instead leaves the plugin not-yet-enabled and exits
  // non-zero, which is loud and harmless.
  const configBackup = backupOnce(configPath);
  const patch = buildPluginConfigPatch({ agentId, baseUrl, apiKey: key, writeConfig });
  const patched = await exec(['config', 'patch', '--stdin'], { input: JSON.stringify(patch) });
  if (!patched.ok) throw new Error(`openclaw config patch failed: ${redactKey(patched.stderr.trim(), key)}`);

  // 6. Now make it live. `plugins enable` also owns plugins.allow (see
  // buildPluginConfigPatch) and does not overwrite the config just patched —
  // both verified against the real CLI.
  const enabled = await exec(['plugins', 'enable', PLUGIN_ENTRY_KEY]);
  if (!enabled.ok) throw new Error(`openclaw plugins enable ${PLUGIN_ENTRY_KEY} failed: ${enabled.stderr.trim()}`);

  // 7. Secret to .env unless explicitly told otherwise. The parent may not
  // exist yet on a profile whose state dir has never been written.
  if (!writeConfig) {
    mkdirSync(dirname(resolvedEnvPath), { recursive: true });
    const current = existsSync(resolvedEnvPath) ? readFileSync(resolvedEnvPath, 'utf8') : '';
    writeFileSync(resolvedEnvPath, upsertEnvVar(current, 'DASHCLAW_API_KEY', key));
    logger.info(`Wrote DASHCLAW_API_KEY to ${resolvedEnvPath}`);
    if (keyMigrated) logger.info(`Removed the plaintext key from ${configPath} (backup: ${configBackup}).`);
  }

  // 8. AGENTS.md in the RESOLVED workspace.
  const ws = expandHome(workspace || (await resolveWorkspace({ run: exec })));
  const agentsMdPath = join(ws, 'AGENTS.md');
  mkdirSync(dirname(agentsMdPath), { recursive: true });
  const agentsMd = mergeAgentsMd({ agentsMdPath, baseUrl, agentId });
  if (agentsMd.migrated) {
    logger.info(`Replaced a codex-authored governance block (backup: ${agentsMd.backup})`);
  }

  // 9. Prove it. An install that looks fine while governance is dead is the
  // worst outcome, so a failed doctor is loud — and the enabled flag is read
  // back rather than inferred from `plugins enable` exiting 0.
  let verified = null;
  if (verify) {
    const validated = await exec(['config', 'validate']);
    const doctor = await exec(['plugins', 'doctor']);
    const live = await exec(['config', 'get', `plugins.entries.${PLUGIN_ENTRY_KEY}.enabled`]);
    const isEnabled = live.ok && lastLine(live.stdout) === 'true';
    verified = { config: validated.ok, plugins: doctor.ok, enabled: isEnabled };
    if (!validated.ok || !doctor.ok || !isEnabled) {
      logger.warn(
        'WARNING: install completed but verification failed — governance may not be enforcing.\n' +
        `  config validate: ${validated.ok ? 'ok' : validated.stderr.trim()}\n` +
        `  plugins doctor:  ${doctor.ok ? 'ok' : doctor.stderr.trim()}\n` +
        `  plugin enabled:  ${isEnabled ? 'ok' : lastLine(live.stdout) || live.stderr.trim() || 'not enabled'}`,
      );
    }
  }

  return {
    configPath,
    configBackup,
    envPath: resolvedEnvPath,
    agentsMd,
    migrated: agentsMd.migrated,
    pluginVersion: resolvedPluginVersion,
    keySource,
    keyMigrated,
    verified,
  };
}
