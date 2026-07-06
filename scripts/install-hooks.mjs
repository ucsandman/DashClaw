#!/usr/bin/env node
/**
 * install-hooks.mjs — One-command Claude Code hook installer.
 *
 * Copies the three governance hooks (pretool, posttool, stop) plus the
 * vendored `dashclaw_agent_intel` Python module into the project's
 * `.claude/hooks/` directory, then merges the hook entries into
 * `.claude/settings.json` (creating the file if missing).
 *
 * Run from the DashClaw repo root:
 *   node scripts/install-hooks.mjs
 *
 * Or from any project that has DashClaw checked out alongside it by passing
 * --target=<path-to-project-root> (defaults to cwd):
 *   node scripts/install-hooks.mjs --target=/path/to/my-project
 *
 * Multi-project code-session capture (capture-only):
 *   node scripts/install-hooks.mjs --global
 * Installs ONLY a Stop hook into ~/.claude/settings.json that points at THIS
 * repo's hooks/dashclaw_stop.py by absolute path. Because the hook walks up to
 * its own .env.local for config, credentials resolve from this repo — no secret
 * is ever written into global config. Every Claude Code session, in any project,
 * then ships its transcript to your DashClaw instance. Add --dry-run to preview
 * or --uninstall to remove.
 *
 * Idempotent. Safe to re-run after a `git pull` to refresh hooks.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOKS_SRC = join(REPO_ROOT, 'hooks');

function printHelpAndExit() {
  console.log('Usage: node scripts/install-hooks.mjs [options]');
  console.log('');
  console.log('  (no args)                Install governance + capture hooks into ./.claude');
  console.log('  --target=<project-root>  Install into another project checked out alongside DashClaw');
  console.log('  --global, -g             Install a CAPTURE-ONLY Stop hook into ~/.claude/settings.json');
  console.log('                           so every project ships its Claude Code sessions to DashClaw.');
  console.log("                           Points at this repo's hooks/dashclaw_stop.py by absolute path;");
  console.log("                           credentials resolve from this repo's .env.local, so NO secret");
  console.log('                           is written into global config.');
  console.log('  --global --governance    Install the FULL governance set (PreToolUse + PostToolUse +');
  console.log('                           Stop) into ~/.claude/settings.json. Fires in EVERY project and');
  console.log('                           in fresh/Docker/headless environments — user settings are not');
  console.log("                           gated by Claude Code's folder-trust prompt the way a project");
  console.log('                           .claude/settings.json is. Absolute paths into this repo; NO');
  console.log('                           secret written (hooks read DASHCLAW_BASE_URL/DASHCLAW_URL +');
  console.log('                           DASHCLAW_API_KEY from the env or this repo\'s .env.local).');
  console.log('  --uninstall              With --global[ --governance], remove the global hook(s).');
  console.log('  --dry-run                With --global, print the change without writing.');
  process.exit(0);
}

const ARG_FLAGS = {
  '--global': (args) => { args.global = true; },
  '-g': (args) => { args.global = true; },
  '--governance': (args) => { args.governance = true; },
  '--dry-run': (args) => { args.dryRun = true; },
  '--uninstall': (args) => { args.uninstall = true; },
  '--help': () => printHelpAndExit(),
  '-h': () => printHelpAndExit(),
};

function applyArg(args, argv, index) {
  const a = argv[index];
  if (a.startsWith('--target=')) {
    args.target = resolve(a.slice('--target='.length));
    return index;
  }
  if (a === '--target' && index + 1 < argv.length) {
    args.target = resolve(argv[index + 1]);
    return index + 1;
  }
  ARG_FLAGS[a]?.(args);
  return index;
}

function parseArgs(argv) {
  const args = { target: process.cwd(), global: false, governance: false, dryRun: false, uninstall: false };
  for (let i = 2; i < argv.length; i++) {
    i = applyArg(args, argv, i);
  }
  return args;
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function copyTree(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of readdirSync(srcDir)) {
    if (entry === '__pycache__') continue;
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      copyTree(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// The interpreter baked into the hook commands. Debian/Ubuntu base images ship
// only `python3` (no `python` shim unless python-is-python3 is installed), so a
// hardcoded `python` silently disables every governance hook there. The installer
// runs on the target machine, so we resolve the interpreter at install time.
// Mirrors cli/lib/codex/install.js, which already branches the same way.
export function detectPythonCommand() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

// Hook commands use $CLAUDE_PROJECT_DIR so they resolve correctly regardless
// of what subdirectory an agent has cd'd into. Relative paths like
// `.claude/hooks/dashclaw_pretool.py` break the moment any tool changes cwd
// mid-session, which silently disables every governance hook.
//
// `python` defaults to the literal "python" so the pure render stays deterministic
// for tests; the install paths below inject detectPythonCommand() for the real machine.
export function hookBlocks(python = 'python') {
  // --agent-id: per-harness identity via argv (roadmap v2.2) — these are
  // Claude Code hook wirings, so they declare claude-code explicitly.
  return {
    PreToolUse: [
      {
        matcher: 'Agent|Task|Workflow|Bash|Edit|Write|MultiEdit|mcp__.*',
        hooks: [
          {
            type: 'command',
            command: `${python} "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_pretool.py" --agent-id claude-code`,
            // Seconds, not ms. 3600000 (a ms value pasted into a seconds field)
            // overflows the harness's 32-bit timer, which cancels the hook
            // instantly and FAILS OPEN — blocks and approval waits are skipped.
            // 3660 > the hook's max 3600s approval wait, so exit-2 fires first.
            timeout: 3660,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Agent|Task|Workflow|Bash|Edit|Write|MultiEdit|mcp__.*',
        hooks: [
          {
            type: 'command',
            command: `${python} "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_posttool.py" --agent-id claude-code`,
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: `${python} "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_stop.py" --agent-id claude-code`,
          },
        ],
      },
    ],
    // SessionStart hook: spawns the enforcement-liveness probe (v8.2) detached.
    // Read-only and fail-silent (see the hook's docstring), so a down API costs
    // at most its internal ~3s budget. SessionStart entries take no matcher.
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: `${python} "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_session_digest.py" --agent-id claude-code`,
            timeout: 10,
          },
        ],
      },
    ],
  };
}

// Only these exact filenames are considered managed. We match on
// path-separator-bounded occurrences so user-authored wrappers with similar
// names (e.g. `my_dashclaw_pretool.py`, `dashclaw_metrics.py`) are NOT
// silently removed on re-install.
export const MANAGED_HOOK_FILES = ['dashclaw_pretool.py', 'dashclaw_posttool.py', 'dashclaw_stop.py', 'dashclaw_session_digest.py', 'enforcement_liveness_probe.py'];
// Full regex-escape (every metacharacter incl. backslash), not just '.', so the
// alternation is always well-formed regardless of the filename contents.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MANAGED_HOOK_RE = new RegExp(
  '(^|[\\\\/])(' + MANAGED_HOOK_FILES.map(escapeRe).join('|') + ')(["\'\\s]|$)'
);

export function isManagedHookCommand(cmd) {
  return MANAGED_HOOK_RE.test(cmd);
}

function mergeSettings(targetRoot, python = detectPythonCommand()) {
  const settingsPath = join(targetRoot, '.claude', 'settings.json');
  let settings = { hooks: {} };
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      console.error(`✗ ${settingsPath} exists but isn't valid JSON: ${err.message}`);
      console.error('  Fix the file by hand or delete it, then re-run.');
      process.exit(1);
    }
  }
  settings.hooks ??= {};

  for (const [event, blocks] of Object.entries(hookBlocks(python))) {
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    // Drop any prior dashclaw entries (matcher-by-matcher) so re-running
    // upgrades commands cleanly without duplicating. Matches only our exact
    // managed filenames — user-authored hooks referencing `dashclaw_` elsewhere
    // survive re-install.
    const kept = existing.filter((entry) => {
      const cmds = (entry.hooks || []).map((h) => h.command || '');
      return !cmds.some(isManagedHookCommand);
    });
    settings.hooks[event] = [...kept, ...blocks];
  }

  ensureDir(dirname(settingsPath));
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return settingsPath;
}

// ---------------------------------------------------------------------------
// Global capture-only install (multi-project)
// ---------------------------------------------------------------------------

// Forward-slash an absolute path so the command works in both PowerShell and
// POSIX shells (`python "C:/.../dashclaw_stop.py"`).
const toPosixPath = (p) => p.replace(/\\/g, '/');

// The global Stop hook command. References THIS repo's dashclaw_stop.py by
// absolute path (not a copy). The hook's own _load_dotenv() then walks one
// parent up to this repo's .env.local for DASHCLAW_BASE_URL / DASHCLAW_API_KEY /
// DASHCLAW_CODE_SESSIONS_ENABLED — which is why no secret is written into the
// global settings file, and why `git pull` upgrades the hook automatically.
export function globalStopCommand(repoRoot, python = 'python') {
  // --agent-id: the user-level install is by definition the Claude Code
  // harness; the argv declaration beats any machine-ambient
  // DASHCLAW_AGENT_ID export (roadmap v2.2 per-harness identity).
  return `${python} "${toPosixPath(join(repoRoot, 'hooks', 'dashclaw_stop.py'))}" --agent-id claude-code`;
}

// Capture-only: a single Stop entry, no PreToolUse/PostToolUse. Other projects
// get code-session capture without governance (the Stop hook's _apply() no-ops
// when there are no pretool action_ids to attribute tokens against).
export function globalStopBlock(repoRoot, python = 'python') {
  return [{ hooks: [{ type: 'command', command: globalStopCommand(repoRoot, python) }] }];
}

// Pure merge (no FS). Drops prior managed Stop entries first so re-running
// upgrades cleanly, then appends the capture hook — or, with { remove: true },
// strips it for uninstall. User-authored Stop hooks and all other events are
// left untouched.
export function mergeGlobalStopHook(settings, repoRoot, { remove = false, python = 'python' } = {}) {
  const next = { ...(settings || {}), hooks: { ...((settings && settings.hooks) || {}) } };
  mergeHookEvent(next, 'Stop', globalStopBlock(repoRoot, python), remove);
  return next;
}

// Full governance hook set for a USER-level (~/.claude) install. Unlike the
// per-project install (which copies scripts into <project>/.claude/hooks and
// uses $CLAUDE_PROJECT_DIR), these reference THIS repo's hooks/ by absolute
// path — so a `git pull` upgrades them and no copy goes stale. Crucially,
// user-level hooks are NOT gated by Claude Code's folder-trust prompt, so they
// fire in fresh / Docker / headless environments where a project
// .claude/settings.json would silently never load. No secret is written; the
// hooks read creds from the env or this repo's .env.local at runtime.
export function globalGovernanceBlocks(repoRoot, python = 'python') {
  // --agent-id: see globalStopCommand — per-harness identity via argv.
  const cmd = (name) => `${python} "${toPosixPath(join(repoRoot, 'hooks', name))}" --agent-id claude-code`;
  const matcher = 'Agent|Task|Workflow|Bash|Edit|Write|MultiEdit|mcp__.*';
  return {
    PreToolUse: [{ matcher, hooks: [{ type: 'command', command: cmd('dashclaw_pretool.py'), timeout: 3660 }] }],
    PostToolUse: [{ matcher, hooks: [{ type: 'command', command: cmd('dashclaw_posttool.py') }] }],
    Stop: [{ hooks: [{ type: 'command', command: cmd('dashclaw_stop.py') }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: cmd('dashclaw_session_digest.py'), timeout: 10 }] }],
  };
}

// Pure merge (no FS). For each governed event, drop prior managed entries first
// (so re-running upgrades cleanly) then append — or, with { remove: true }, strip
// them for uninstall. User-authored hooks on the same events are left untouched.
export function mergeGlobalGovernanceHooks(settings, repoRoot, { remove = false, python = 'python' } = {}) {
  const next = { ...(settings || {}), hooks: { ...((settings && settings.hooks) || {}) } };
  const blocks = globalGovernanceBlocks(repoRoot, python);
  for (const event of Object.keys(blocks)) {
    mergeHookEvent(next, event, blocks[event], remove);
  }
  return next;
}

function managedHookCommands(entry) {
  return (entry.hooks || []).map((h) => h.command || '');
}

function withoutManagedHooks(entries) {
  return entries.filter((entry) => !managedHookCommands(entry).some(isManagedHookCommand));
}

function mergeHookEvent(settings, event, blocks, remove) {
  const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const kept = withoutManagedHooks(existing);
  settings.hooks[event] = remove ? kept : [...kept, ...blocks];
  if (settings.hooks[event].length === 0) delete settings.hooks[event];
}

function globalSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

function readSettingsOrExit(settingsPath) {
  if (existsSync(settingsPath)) {
    try {
      return JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (err) {
      console.error(`✗ ${settingsPath} exists but isn't valid JSON: ${err.message}`);
      console.error('  Fix the file by hand or delete it, then re-run.');
      process.exit(1);
    }
  }
  return {};
}

function writeSettings(settingsPath, rendered) {
  ensureDir(dirname(settingsPath));
  writeFileSync(settingsPath, rendered);
}

function logGlobalHeader(settingsPath) {
  console.log(`Global settings: ${settingsPath}`);
  console.log(`Repo root:       ${REPO_ROOT}`);
  console.log('');
}

function runGlobalGovernance({ settingsPath, settings, python, dryRun, uninstall }) {
  const mergedGov = mergeGlobalGovernanceHooks(settings, REPO_ROOT, { remove: uninstall, python });
  const renderedGov = JSON.stringify(mergedGov, null, 2) + '\n';
  logGlobalHeader(settingsPath);
  if (uninstall) {
    if (dryRun) {
      console.log('[dry-run] Would remove the DashClaw global governance hooks. No file written.');
      return;
    }
    writeSettings(settingsPath, renderedGov);
    console.log('✓ Removed the DashClaw global governance hooks.');
    return;
  }
  console.log('Full governance: installs PreToolUse + PostToolUse + Stop into your USER');
  console.log('settings, so every Claude Code session in ANY project is governed — and it');
  console.log("fires in fresh/Docker/headless environments (user settings skip Claude Code's");
  console.log('folder-trust gate that a project .claude/settings.json must pass first).');
  console.log('');
  console.log('No secret is written here — the hooks read creds from the environment or this');
  console.log("repo's .env.local: DASHCLAW_BASE_URL (or DASHCLAW_URL) + DASHCLAW_API_KEY.");
  console.log('');
  if (dryRun) {
    console.log('[dry-run] Would set these hook events:');
    console.log(JSON.stringify(mergedGov.hooks, null, 2));
    console.log('');
    console.log('[dry-run] No file written. Re-run without --dry-run to apply.');
    return;
  }
  writeSettings(settingsPath, renderedGov);
  console.log(`✓ Global governance hooks merged into ${settingsPath}`);
  console.log('');
  console.log('Set DASHCLAW_BASE_URL + DASHCLAW_API_KEY in the session env, open a new Claude');
  console.log('Code session in ANY project, and tool calls are governed. Remove anytime with:');
  console.log('  node scripts/install-hooks.mjs --global --governance --uninstall');
}

function runGlobalCapture({ settingsPath, settings, python, dryRun, uninstall }) {
  const merged = mergeGlobalStopHook(settings, REPO_ROOT, { remove: uninstall, python });
  const rendered = JSON.stringify(merged, null, 2) + '\n';
  logGlobalHeader(settingsPath);

  if (uninstall) {
    if (dryRun) {
      console.log('[dry-run] Would remove the DashClaw global Stop capture hook. No file written.');
      return;
    }
    writeSettings(settingsPath, rendered);
    console.log('✓ Removed the DashClaw global Stop capture hook.');
    return;
  }

  console.log('Capture-only: installs ONLY a Stop hook (no PreToolUse/PostToolUse),');
  console.log('so every project ships its Claude Code sessions without governance noise.');
  console.log('');
  console.log('Stop hook command:');
  console.log('  ' + globalStopCommand(REPO_ROOT, python));
  console.log('');
  console.log('No secret is written here — the hook reads this repo\'s .env.local:');
  console.log('  ' + join(REPO_ROOT, '.env.local'));
  console.log('  (DASHCLAW_BASE_URL, DASHCLAW_API_KEY, DASHCLAW_CODE_SESSIONS_ENABLED)');
  console.log('');

  if (dryRun) {
    console.log('[dry-run] Would set hooks.Stop to:');
    console.log(JSON.stringify(merged.hooks.Stop, null, 2));
    console.log('');
    console.log('[dry-run] No file written. Re-run without --dry-run to apply.');
    return;
  }

  writeSettings(settingsPath, rendered);
  console.log(`✓ Global Stop capture hook merged into ${settingsPath}`);
  console.log('');
  console.log('Open a new Claude Code session in ANY project and that session will');
  console.log('ship to your DashClaw instance on Stop. Remove anytime with:');
  console.log('  node scripts/install-hooks.mjs --global --uninstall');
}

function runGlobal({ dryRun, uninstall, governance }) {
  const settingsPath = globalSettingsPath();
  const python = detectPythonCommand();
  const settings = readSettingsOrExit(settingsPath);
  const runner = governance ? runGlobalGovernance : runGlobalCapture;
  runner({ settingsPath, settings, python, dryRun, uninstall });
}

function main() {
  const args = parseArgs(process.argv);
  if (args.global) {
    runGlobal(args);
    return;
  }
  const { target } = args;
  const hooksDest = join(target, '.claude', 'hooks');

  console.log(`Source:  ${HOOKS_SRC}`);
  console.log(`Target:  ${hooksDest}`);

  if (!existsSync(HOOKS_SRC)) {
    console.error(`✗ Source hooks dir not found: ${HOOKS_SRC}`);
    process.exit(1);
  }

  ensureDir(hooksDest);

  // Copy the Python hook scripts. dashclaw_code_session_reporter.py is copied
  // for backward compatibility with older installs (the hooks no longer import
  // it after the v5 governance-core cull); it is removed with the code-sessions
  // subsystem. enforcement_liveness_probe.py: spawned detached by the SessionStart
  // hook (v8.2); copied so the probe travels with the hooks it exercises.
  for (const name of ['dashclaw_pretool.py', 'dashclaw_posttool.py', 'dashclaw_stop.py', 'dashclaw_code_session_reporter.py', 'dashclaw_session_digest.py', 'enforcement_liveness_probe.py']) {
    const src = join(HOOKS_SRC, name);
    if (!existsSync(src)) {
      console.error(`✗ Missing hook script: ${src}`);
      process.exit(1);
    }
    copyFileSync(src, join(hooksDest, name));
    console.log(`✓ ${name}`);
  }

  // Copy the vendored intel module (required by the v2 pretool).
  const intelSrc = join(HOOKS_SRC, 'dashclaw_agent_intel');
  if (existsSync(intelSrc)) {
    copyTree(intelSrc, join(hooksDest, 'dashclaw_agent_intel'));
    console.log('✓ dashclaw_agent_intel/ (intel module)');
  } else {
    console.error(`✗ Missing intel module: ${intelSrc}`);
    process.exit(1);
  }

  // Merge hook entries into .claude/settings.json.
  const settingsPath = mergeSettings(target);
  console.log(`✓ settings merged: ${settingsPath}`);

  console.log('');
  console.log('Done. Restart Claude Code (or open a new session) and ensure');
  console.log('these env vars are set in your shell or .env file:');
  console.log('  DASHCLAW_BASE_URL  (e.g. https://my-dashclaw.vercel.app)');
  console.log('  DASHCLAW_API_KEY   (oc_live_...)');
  console.log('  DASHCLAW_AGENT_ID  (optional, default: claude-code)');
  console.log('  DASHCLAW_HOOK_MODE (optional: enforce | observe, default: enforce)');
  console.log('  DASHCLAW_DIGEST_DISABLED (optional: 1 disables the SessionStart digest)');
}

// Only run main() when executed directly via `node install-hooks.mjs`.
// Guards against accidental execution when the module is imported for testing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
