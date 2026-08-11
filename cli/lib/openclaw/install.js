// cli/lib/openclaw/install.js

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { replaceManagedBlock, AGENTS_MANAGED_START, AGENTS_MANAGED_END } from '../codex/install.js';

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

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}

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
