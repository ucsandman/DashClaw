// cli/lib/codex/install.js
//
// `dashclaw install codex` — provisions DashClaw governance into Codex CLI.
//
// What it does, idempotently:
//   1. Copies the Python governance hooks (pretool, posttool, stop, session
//      digest) and the vendored `dashclaw_agent_intel` module into
//      ~/.codex/hooks/dashclaw/.
//   2. Merges a managed block into ~/.codex/config.toml that registers:
//        - the DashClaw MCP server (stdio)
//        - PreToolUse / PostToolUse / Stop / SessionStart hooks pointing at
//          the copied scripts
//        - approval_policy = "on-request" so Codex surfaces require_approval
//          decisions from DashClaw guard
//   3. Drops a managed block into <project>/AGENTS.md (or creates the file)
//      that teaches the Codex agent the DashClaw governance protocol.
//
// Idempotency is implemented with sentinel markers:
//
//     # >>> dashclaw start — managed block, do not edit by hand
//     ...
//     # <<< dashclaw end
//
// Re-running replaces only the block between the markers. Anything else in
// the file is left untouched.
//
// Safety: every file we mutate gets a `.dashclaw-bak` sibling on first write
// so the user always has an escape hatch.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const CODEX_HOME_DIRNAME = '.codex';
export const DASHCLAW_HOOKS_SUBDIR = 'hooks/dashclaw';

export const MANAGED_START = '# >>> dashclaw start — managed block, do not edit by hand';
export const MANAGED_END = '# <<< dashclaw end';

export const AGENTS_MANAGED_START =
  '<!-- >>> dashclaw start — managed block, do not edit by hand -->';
export const AGENTS_MANAGED_END = '<!-- <<< dashclaw end -->';

// Hook filenames we ship from `hooks/`. The agent_intel module is a directory
// and is handled separately.
const HOOK_FILES = [
  'dashclaw_pretool.py',
  'dashclaw_posttool.py',
  'dashclaw_stop.py',
  // dashclaw_stop.py imports this for Code Sessions ingest; without it the
  // import fails inside a try/except and ingest silently no-ops (v2.7 fix).
  'dashclaw_code_session_reporter.py',
  // SessionStart enforcement-liveness probe (v8.2) — the SessionStart hook
  // (wired once codex-cli 0.139.0's SessionStart event was confirmed to fire;
  // see PLUGIN_PARITY.md). Replaced the retired session-digest hook.
  'enforcement_liveness_probe.py',
];
const HOOK_INTEL_DIR = 'dashclaw_agent_intel';

// -----------------------------------------------------------------------------
// Path resolution
// -----------------------------------------------------------------------------

export function codexHome(env = process.env) {
  if (env.CODEX_HOME) return resolve(env.CODEX_HOME);
  return resolve(homedir(), CODEX_HOME_DIRNAME);
}

export function codexConfigPath(env = process.env) {
  return join(codexHome(env), 'config.toml');
}

export function codexHooksDir(env = process.env) {
  return join(codexHome(env), DASHCLAW_HOOKS_SUBDIR);
}

// -----------------------------------------------------------------------------
// Hook copy
// -----------------------------------------------------------------------------

function copyDirRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const sp = join(src, entry.name);
    const dp = join(dst, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__pycache__') continue;
      copyDirRecursive(sp, dp);
    } else if (entry.isFile()) {
      copyFileSync(sp, dp);
    }
  }
}

export function copyHooks({ hooksSrc, hooksDst }) {
  if (!existsSync(hooksSrc)) {
    throw new Error(`Hook source directory not found: ${hooksSrc}`);
  }
  mkdirSync(hooksDst, { recursive: true });

  for (const name of HOOK_FILES) {
    const sp = join(hooksSrc, name);
    if (!existsSync(sp)) {
      throw new Error(`Required hook script missing: ${sp}`);
    }
    copyFileSync(sp, join(hooksDst, name));
  }

  const intelSrc = join(hooksSrc, HOOK_INTEL_DIR);
  if (existsSync(intelSrc) && statSync(intelSrc).isDirectory()) {
    copyDirRecursive(intelSrc, join(hooksDst, HOOK_INTEL_DIR));
  } else {
    throw new Error(`Required intel module missing: ${intelSrc}`);
  }

  return { hooksDst, files: HOOK_FILES, intelDir: HOOK_INTEL_DIR };
}

// -----------------------------------------------------------------------------
// TOML managed-block merge
// -----------------------------------------------------------------------------

// We do NOT parse TOML. Instead we maintain a single contiguous block
// delimited by MANAGED_START / MANAGED_END comment markers and rewrite that
// block on every install. This avoids depending on a third-party TOML
// library and keeps user-authored content outside the block 100% intact.

export function replaceManagedBlock(
  source,
  newBlock,
  { startMarker = MANAGED_START, endMarker = MANAGED_END } = {},
) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  if (start !== -1 && end !== -1 && end > start) {
    const before = source.slice(0, start);
    const after = source.slice(end + endMarker.length);
    return ensureTrailingNewline(
      stripTrailingBlankLines(before) +
        (before ? '\n\n' : '') +
        newBlock +
        (after.startsWith('\n') ? '' : '\n') +
        after,
    );
  }

  // No existing block — append.
  const sep = source.length === 0 || source.endsWith('\n') ? '\n' : '\n\n';
  return ensureTrailingNewline(
    source + (source.length === 0 ? '' : sep) + newBlock,
  );
}

function stripTrailingBlankLines(s) {
  return s.replace(/\n+$/, '');
}

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : s + '\n';
}

// -----------------------------------------------------------------------------
// Block builders
// -----------------------------------------------------------------------------

// Quote a path for inclusion in a TOML basic string. TOML basic strings
// require `\` and `"` to be escaped.
function tomlString(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function buildConfigTomlBlock({
  mcpServerPath,
  hooksDir,
  approvalPolicy = 'on-request',
  includeNotify = false,
  dashclawCliPath = null,
}) {
  const py = pythonCommand();
  const pre = join(hooksDir, 'dashclaw_pretool.py');
  const post = join(hooksDir, 'dashclaw_posttool.py');
  const stop = join(hooksDir, 'dashclaw_stop.py');
  const sessionStart = join(hooksDir, 'enforcement_liveness_probe.py');

  const lines = [
    MANAGED_START,
    '#',
    '# Re-run `dashclaw install codex` to refresh this block. Edits made',
    '# between these markers will be overwritten on next install.',
    '',
    `approval_policy = ${tomlString(approvalPolicy)}`,
  ];

  if (includeNotify) {
    if (!dashclawCliPath) {
      throw new Error('dashclawCliPath is required when includeNotify=true');
    }
    // Codex's notify config takes a list of strings: argv prefix. Codex
    // appends the JSON payload as the final argument when it fires.
    lines.push(
      `notify = ["node", ${tomlString(dashclawCliPath)}, "codex", "notify"]`,
    );
  }

  lines.push(
    '',
    '[mcp_servers.dashclaw]',
    `command = ${tomlString(py)}`,
    `args = [${tomlString(mcpServerPath)}, "--agent-id", "codex"]`,
    '',
    '[[hooks.PreToolUse]]',
    'matcher = "Bash|Edit|Write|MultiEdit"',
    '[[hooks.PreToolUse.hooks]]',
    'type = "command"',
    // --agent-id on the hook command line mirrors the MCP server args above:
    // the hooks' argv identity beats the machine-ambient DASHCLAW_AGENT_ID
    // env var, so Codex tool calls are never mis-attributed to another
    // harness (roadmap v2.2).
    `command = ${tomlString(`${py} ${pre} --agent-id codex`)}`,
    'timeoutSec = 3600',
    '',
    '[[hooks.PostToolUse]]',
    'matcher = "Bash|Edit|Write|MultiEdit"',
    '[[hooks.PostToolUse.hooks]]',
    'type = "command"',
    `command = ${tomlString(`${py} ${post} --agent-id codex`)}`,
    '',
    '[[hooks.Stop]]',
    '[[hooks.Stop.hooks]]',
    'type = "command"',
    `command = ${tomlString(`${py} ${stop} --agent-id codex`)}`,
    '',
    // Codex CLI 0.139.0's hook-event enum contains SessionStart alongside
    // Pre/Post/Stop; wired once that lifecycle was verified to fire
    // (roadmap v3.7 item 6 — see PLUGIN_PARITY.md). Runs the enforcement-
    // liveness probe (v8.2): `--source session-start` throttles it to once/12h
    // and detaches, so session start is never delayed. No --agent-id — the
    // probe forces its own synthetic identity internally.
    '[[hooks.SessionStart]]',
    '[[hooks.SessionStart.hooks]]',
    'type = "command"',
    `command = ${tomlString(`${py} ${sessionStart} --source session-start`)}`,
    MANAGED_END,
  );

  return lines.join('\n');
}

function pythonCommand() {
  // Use `python` on Windows, `python3` elsewhere. The hook scripts work with
  // either; we just pick the canonical name for the OS so the spawn succeeds
  // without PATH gymnastics. Users can override by editing config.toml after
  // install (the managed block warns about overwrites — but the python
  // command is the only path-dependent piece).
  return process.platform === 'win32' ? 'python' : 'python3';
}

// -----------------------------------------------------------------------------
// AGENTS.md template
// -----------------------------------------------------------------------------

export function buildAgentsMdBlock({ baseUrl } = {}) {
  const lines = [
    AGENTS_MANAGED_START,
    '',
    '## DashClaw Governance Protocol',
    '',
    'You are governed by DashClaw. Before any non-trivial action, follow this',
    'protocol so a human reviewer (and the audit log) can trust your work.',
    '',
    '### Session start',
    '',
    '1. Call `dashclaw_session_start` via the `dashclaw` MCP server with your',
    '   agent id (`codex`) and a one-sentence workspace description. This',
    '   groups all your actions for tracking in Mission Control.',
    '2. Read the `dashclaw://policies` and `dashclaw://capabilities` MCP',
    '   resources to learn what rules govern you and what capabilities are',
    '   registered. Treat unknown action types as high-risk by default.',
    '',
    '### Before each risky action',
    '',
    "Call `dashclaw_guard` with the action you intend to take. You will get",
    'back one of four decisions:',
    '',
    '- `allow` — proceed; call `dashclaw_record` afterward with the outcome.',
    '- `warn` — proceed with caution; include the warning context in your',
    '  `dashclaw_record` call.',
    '- `block` — stop. Report the block reason to the user and do not attempt',
    '  the action through another path.',
    "- `require_approval` — call `dashclaw_wait_for_approval` and wait. Don't",
    '  poll faster than the tool already does.',
    '',
    'Risky actions include: shell commands that write or delete, file edits',
    'outside the project root, network requests, package installs, deploys,',
    'and any external API call you have not used in this session before.',
    '',
    "The PreToolUse hook installed by `dashclaw install codex` will guard",
    'Bash, Edit, Write, and MultiEdit automatically. The guidance above is',
    'still required for tool calls that fall outside that matcher (MCP tool',
    "invocations, agent-internal capabilities) so DashClaw's audit trail",
    'covers them too.',
    '',
    '### After each action',
    '',
    'Call `dashclaw_record` with the action id (from `dashclaw_guard` or from',
    'a PostToolUse-emitted breadcrumb) and the outcome (`success`,',
    '`failure`, or `partial`). This is what makes the decision replayable.',
    '',
    baseUrl ? `### This instance\n\nDashClaw: ${baseUrl}` : '',
    '',
    AGENTS_MANAGED_END,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

// -----------------------------------------------------------------------------
// File mutation helpers
// -----------------------------------------------------------------------------

function backupOnce(path) {
  if (!existsSync(path)) return null;
  const bak = path + '.dashclaw-bak';
  if (existsSync(bak)) return bak;
  copyFileSync(path, bak);
  return bak;
}

export function mergeConfigToml({
  configPath,
  mcpServerPath,
  hooksDir,
  approvalPolicy,
  includeNotify = false,
  dashclawCliPath = null,
}) {
  const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const block = buildConfigTomlBlock({
    mcpServerPath,
    hooksDir,
    approvalPolicy,
    includeNotify,
    dashclawCliPath,
  });
  const after = replaceManagedBlock(before, block);
  mkdirSync(dirname(configPath), { recursive: true });
  const backup = backupOnce(configPath);
  writeFileSync(configPath, after);
  return { changed: before !== after, backup };
}

export function mergeAgentsMd({ agentsMdPath, baseUrl }) {
  const before = existsSync(agentsMdPath) ? readFileSync(agentsMdPath, 'utf8') : '';
  const block = buildAgentsMdBlock({ baseUrl });
  const after = replaceManagedBlock(before, block, {
    startMarker: AGENTS_MANAGED_START,
    endMarker: AGENTS_MANAGED_END,
  });
  mkdirSync(dirname(agentsMdPath), { recursive: true });
  const backup = backupOnce(agentsMdPath);
  writeFileSync(agentsMdPath, after);
  return { changed: before !== after, backup };
}

// -----------------------------------------------------------------------------
// Top-level install
// -----------------------------------------------------------------------------

export async function installCodex({
  repoRoot,
  projectDir = process.cwd(),
  baseUrl,
  approvalPolicy = 'on-request',
  includeNotify = false,
  env = process.env,
  logger = console,
}) {
  if (!repoRoot) {
    throw new Error('repoRoot is required (path to the DashClaw checkout)');
  }

  const hooksSrc = join(repoRoot, 'hooks');
  const mcpServerPath = join(repoRoot, 'mcp-server', 'bin', 'dashclaw-mcp.js');
  const dashclawCliPath = join(repoRoot, 'cli', 'bin', 'dashclaw.js');

  if (!existsSync(mcpServerPath)) {
    throw new Error(`MCP server entrypoint missing: ${mcpServerPath}`);
  }
  if (includeNotify && !existsSync(dashclawCliPath)) {
    throw new Error(`dashclaw CLI not found at ${dashclawCliPath} — can't wire notify`);
  }

  const hooksDst = codexHooksDir(env);
  const configPath = codexConfigPath(env);
  const agentsMdPath = join(projectDir, 'AGENTS.md');

  logger.info(`Installing DashClaw hooks → ${hooksDst}`);
  const hookResult = copyHooks({ hooksSrc, hooksDst });

  logger.info(`Merging Codex config → ${configPath}`);
  const configResult = mergeConfigToml({
    configPath,
    mcpServerPath,
    hooksDir: hooksDst,
    approvalPolicy,
    includeNotify,
    dashclawCliPath: includeNotify ? dashclawCliPath : null,
  });

  logger.info(`Merging governance protocol → ${agentsMdPath}`);
  const agentsResult = mergeAgentsMd({ agentsMdPath, baseUrl });

  return {
    hooks: hookResult,
    config: { path: configPath, ...configResult },
    agentsMd: { path: agentsMdPath, ...agentsResult },
  };
}
