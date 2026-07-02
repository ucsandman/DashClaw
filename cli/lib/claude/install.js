// cli/lib/claude/install.js
//
// `dashclaw install claude [--trial]` — provisions DashClaw governance into
// Claude Code without cloning the repo.
//
// Flow (ordering matters — nothing is written until the preflight passes, so
// a failed install never leaves a half-written config):
//   1. Resolve endpoint + API key: flags → env → (--trial: open the hosted
//      signup page in a browser and accept the pasted key — Turnstile cannot
//      be driven headlessly) → interactive prompts.
//   2. Preflight: GET /api/health (reachability) and an authenticated read
//      (key validity). Failure exits non-zero with an actionable message.
//   3. Acquire the hook scripts: copied from a repo checkout when the CLI is
//      running inside one, otherwise downloaded from the instance's own
//      /downloads/dashclaw-claude-code-hooks.zip bundle (version-matched).
//   4. Resolve the Python command (python3, then python) and write the hook
//      entries into ~/.claude/settings.json (managed entries, replaced on
//      re-install; backup created once).
//   5. Write hook credentials to <hooksDir>/.env (mode 600 — the hooks load
//      .env beside the script, so no secret lands in ~/.claude/settings.json)
//      with HOOK_MODE=observe by default, and save ~/.dashclaw/config.json
//      for the CLI itself.
//   6. Print next steps (flip to enforce, dashboard URL).

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readConfigFile, writeConfigFile } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOOK_FILES = [
  'dashclaw_pretool.py',
  'dashclaw_posttool.py',
  'dashclaw_stop.py',
  'dashclaw_code_session_reporter.py',
];
const HOOK_INTEL_DIR = 'dashclaw_agent_intel';
const HOOKS_BUNDLE_PATH = '/downloads/dashclaw-claude-code-hooks.zip';

export const DEFAULT_AGENT_ID = 'claude-code';

// ---------------------------------------------------------------------------
// Python resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a working Python command: python3 first, then python. The Windows
 * Store `python3` alias exits non-zero without running anything, so we
 * require a successful `--version`, not just spawnability.
 * @param {(cmd: string, args: string[]) => {error?: Error, status?: number}} probe
 */
export function resolvePythonCommand(probe = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' })) {
  for (const cmd of ['python3', 'python']) {
    const result = probe(cmd, ['--version']);
    if (!result.error && result.status === 0) return cmd;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export async function preflight(endpoint, apiKey, { fetchImpl = fetch } = {}) {
  let health;
  try {
    health = await fetchImpl(`${endpoint}/api/health`, { signal: AbortSignal.timeout(8000) });
  } catch (err) {
    throw new Error(
      `Could not reach ${endpoint}/api/health (${err.cause?.code || err.name}). ` +
      'Check the URL, that the instance is running, and your network.',
    );
  }
  if (!health.ok) {
    throw new Error(`${endpoint}/api/health returned HTTP ${health.status} — the instance is unhealthy.`);
  }

  const authed = await fetchImpl(`${endpoint}/api/actions?limit=1`, {
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(8000),
  }).catch((err) => {
    throw new Error(`Authenticated preflight to ${endpoint} failed (${err.name}).`);
  });
  if (authed.status === 401 || authed.status === 403) {
    throw new Error('API key was rejected (401/403). Paste the key exactly as issued (oc_live_...).');
  }
  if (!authed.ok) {
    throw new Error(`Authenticated preflight returned HTTP ${authed.status} — expected 200.`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hook acquisition
// ---------------------------------------------------------------------------

/** Repo checkout containing hooks/, when the CLI runs from inside one. */
export function findRepoHooksDir() {
  const candidate = resolve(__dirname, '..', '..', '..', 'hooks');
  return existsSync(join(candidate, 'dashclaw_pretool.py')) ? candidate : null;
}

function copyDirRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '__pycache__') continue;
    const sp = join(src, entry.name);
    const dp = join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(sp, dp);
    else if (entry.isFile()) copyFileSync(sp, dp);
  }
}

function copyHooksFromRepo(hooksSrc, hooksDst) {
  mkdirSync(hooksDst, { recursive: true });
  for (const name of [...HOOK_FILES, 'run_hook.cjs']) {
    const sp = join(hooksSrc, name);
    if (!existsSync(sp)) throw new Error(`Required hook script missing: ${sp}`);
    copyFileSync(sp, join(hooksDst, name));
  }
  const intelSrc = join(hooksSrc, HOOK_INTEL_DIR);
  if (!existsSync(intelSrc) || !statSync(intelSrc).isDirectory()) {
    throw new Error(`Required intel module missing: ${intelSrc}`);
  }
  copyDirRecursive(intelSrc, join(hooksDst, HOOK_INTEL_DIR));
}

function extractZip(zipPath, destDir) {
  // tar on Windows 10+ and macOS is bsdtar (handles zip); GNU tar on most
  // Linux does not, so try unzip there first. Whatever works first wins.
  const attempts = process.platform === 'linux'
    ? [['unzip', ['-o', zipPath, '-d', destDir]], ['tar', ['-xf', zipPath, '-C', destDir]]]
    : [['tar', ['-xf', zipPath, '-C', destDir]], ['unzip', ['-o', zipPath, '-d', destDir]]];
  for (const [cmd, args] of attempts) {
    const result = spawnSync(cmd, args, { stdio: 'ignore' });
    if (!result.error && result.status === 0) return true;
  }
  throw new Error(
    'Could not extract the hooks bundle (need `tar` with zip support or `unzip` on PATH). ' +
    'Alternative: clone https://github.com/ucsandman/DashClaw and re-run from the checkout.',
  );
}

async function downloadHooksBundle(endpoint, hooksDst, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${endpoint}${HOOKS_BUNDLE_PATH}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`Hook bundle download failed (HTTP ${res.status} from ${HOOKS_BUNDLE_PATH}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const workDir = join(tmpdir(), `dashclaw-hooks-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  try {
    const zipPath = join(workDir, 'hooks.zip');
    writeFileSync(zipPath, buf);
    extractZip(zipPath, workDir);
    const extracted = join(workDir, 'hooks');
    if (!existsSync(join(extracted, 'dashclaw_pretool.py'))) {
      throw new Error('Hook bundle had an unexpected layout (no hooks/dashclaw_pretool.py).');
    }
    mkdirSync(hooksDst, { recursive: true });
    cpSync(extracted, hooksDst, { recursive: true });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Claude Code settings.json merge
// ---------------------------------------------------------------------------

const HOOK_EVENTS = {
  PreToolUse: { matcher: 'Agent|Task|Bash|Edit|Write|MultiEdit|Skill|mcp__.*', script: 'dashclaw_pretool.py', timeout: 3600000 },
  PostToolUse: { matcher: 'Agent|Task|Bash|Edit|Write|MultiEdit|mcp__.*', script: 'dashclaw_posttool.py' },
  Stop: { script: 'dashclaw_stop.py' },
};

export function isManagedHookEntry(entry) {
  return (entry?.hooks || []).some((h) => typeof h?.command === 'string' && h.command.includes('dashclaw_'));
}

/** Build the managed hook entries pointing at <hooksDir> via <python>. */
export function buildHookEntries(hooksDir, python, agentId = DEFAULT_AGENT_ID) {
  const entries = {};
  for (const [event, spec] of Object.entries(HOOK_EVENTS)) {
    const hook = {
      type: 'command',
      // --agent-id is the per-harness identity declaration (roadmap v2.2):
      // argv beats the machine-ambient DASHCLAW_AGENT_ID env var, so this
      // install keeps its identity even when another harness exports one.
      command: `${python} "${join(hooksDir, spec.script)}" --agent-id "${agentId}"`,
      ...(spec.timeout ? { timeout: spec.timeout } : {}),
    };
    entries[event] = [{ ...(spec.matcher ? { matcher: spec.matcher } : {}), hooks: [hook] }];
  }
  return entries;
}

/**
 * Merge the managed hook entries into a Claude Code settings.json file:
 * previous dashclaw-managed entries are replaced, everything else preserved.
 */
export function mergeClaudeSettings(settingsPath, hooksDir, python, agentId = DEFAULT_AGENT_ID) {
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      throw new Error(`${settingsPath} is not valid JSON — fix or remove it, then re-run.`);
    }
    const bak = settingsPath + '.dashclaw-bak';
    if (!existsSync(bak)) copyFileSync(settingsPath, bak);
  }
  settings.hooks = settings.hooks || {};
  const managed = buildHookEntries(hooksDir, python, agentId);
  for (const [event, entries] of Object.entries(managed)) {
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    settings.hooks[event] = [...existing.filter((e) => !isManagedHookEntry(e)), ...entries];
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return settings;
}

// ---------------------------------------------------------------------------
// Hook credentials (.env beside the scripts — never in settings.json)
// ---------------------------------------------------------------------------

export function buildHookEnv({ endpoint, apiKey, agentId, hookMode = 'observe' }) {
  return [
    '# Written by `dashclaw install claude` — credentials for the governance hooks.',
    '# The hooks load this file from beside their scripts; env vars override it.',
    `DASHCLAW_BASE_URL=${endpoint}`,
    `DASHCLAW_API_KEY=${apiKey}`,
    `DASHCLAW_AGENT_ID=${agentId}`,
    `DASHCLAW_HOOK_MODE=${hookMode}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Top-level install
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} [opts.endpoint]  Instance URL (flag/env resolved by caller)
 * @param {string} [opts.apiKey]
 * @param {string} [opts.agentId]
 * @param {boolean} [opts.trial]
 * @param {string} [opts.homeDir]   Injectable for tests
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.pythonProbe]   Injected probe for resolvePythonCommand
 * @param {Function} [opts.prompt]        (question) => Promise<string>
 * @param {Function} [opts.promptSecret]  (question) => Promise<string>
 * @param {Function} [opts.openUrl]       Best-effort browser open
 * @param {object} [opts.logger]
 */
export async function installClaude({
  endpoint,
  apiKey,
  agentId = DEFAULT_AGENT_ID,
  trial = false,
  homeDir = homedir(),
  env = process.env,
  fetchImpl = fetch,
  pythonProbe,
  prompt,
  promptSecret,
  openUrl = defaultOpenUrl,
  logger = console,
} = {}) {
  // 1. Resolve endpoint + key -------------------------------------------------
  endpoint = (endpoint || env.DASHCLAW_BASE_URL || '').replace(/\/+$/, '');
  apiKey = apiKey || env.DASHCLAW_API_KEY || '';

  if (trial && !apiKey) {
    const hostedBase = (endpoint || env.DASHCLAW_HOSTED_URL || '').replace(/\/+$/, '')
      || (await mustPrompt(prompt, 'Hosted DashClaw URL (where you signed up / will sign up): '));
    const signupUrl = `${hostedBase.replace(/\/+$/, '')}/connect`;
    logger.log('');
    logger.log(`  Opening the trial signup page: ${signupUrl}`);
    logger.log('  Sign in there, copy your trial API key, and paste it below.');
    openUrl(signupUrl);
    endpoint = endpoint || hostedBase.replace(/\/+$/, '');
    apiKey = await mustPrompt(promptSecret || prompt, 'Paste your trial API key (oc_live_...): ');
  }

  if (!endpoint) endpoint = await mustPrompt(prompt, 'DashClaw instance URL (e.g. https://your-dashclaw.vercel.app): ');
  endpoint = endpoint.replace(/\/+$/, '');
  if (!apiKey) apiKey = await mustPrompt(promptSecret || prompt, 'API key (oc_live_...): ');

  // 2. Preflight (nothing is written before this passes) ----------------------
  logger.log(`  Preflight: ${endpoint}/api/health ...`);
  await preflight(endpoint, apiKey, { fetchImpl });
  logger.log('  Preflight OK — instance reachable, key accepted.');

  // 3. Hooks ------------------------------------------------------------------
  const hooksDir = join(homeDir, '.dashclaw', 'claude-hooks');
  const repoHooks = findRepoHooksDir();
  if (repoHooks) {
    logger.log(`  Installing hooks from repo checkout → ${hooksDir}`);
    copyHooksFromRepo(repoHooks, hooksDir);
  } else {
    logger.log(`  Downloading hooks bundle from ${endpoint} → ${hooksDir}`);
    await downloadHooksBundle(endpoint, hooksDir, { fetchImpl });
  }

  // 4. Python + Claude Code settings -------------------------------------------
  const python = resolvePythonCommand(pythonProbe);
  if (!python) {
    throw new Error('No python3 or python found on PATH. Install Python 3.10+ and re-run.');
  }
  const settingsPath = join(homeDir, '.claude', 'settings.json');
  logger.log(`  Wiring hooks into ${settingsPath} (python: ${python}, agent: ${agentId})`);
  mergeClaudeSettings(settingsPath, hooksDir, python, agentId);

  // 5. Credentials -------------------------------------------------------------
  const hookEnvPath = join(hooksDir, '.env');
  writeFileSync(hookEnvPath, buildHookEnv({ endpoint, apiKey, agentId }), { mode: 0o600 });
  const existing = readConfigForHome(homeDir);
  writeConfigForHome(homeDir, { ...existing, baseUrl: endpoint, apiKey, agentId });

  // 6. Next steps ---------------------------------------------------------------
  logger.log('');
  logger.log('  Done. Claude Code is governed by DashClaw (observe mode).');
  logger.log(`  Hooks:     ${hooksDir}`);
  logger.log(`  Settings:  ${settingsPath}`);
  logger.log(`  Config:    ${join(homeDir, '.dashclaw', 'config.json')}`);
  logger.log('');
  logger.log('  Next steps:');
  logger.log('  1. Restart Claude Code (hooks load at session start).');
  logger.log('  2. Run any tool call and watch it appear in your dashboard:');
  logger.log(`     ${endpoint}/mission-control`);
  logger.log(`  3. Observe mode logs decisions without blocking. To enforce, set`);
  logger.log(`     DASHCLAW_HOOK_MODE=enforce in ${hookEnvPath}`);

  return { hooksDir, settingsPath, hookEnvPath, python, endpoint, agentId, hookMode: 'observe' };
}

async function mustPrompt(promptFn, question) {
  if (!promptFn) {
    throw new Error(`Missing required value (${question.trim()}) and no interactive prompt available.`);
  }
  const answer = (await promptFn(question)).trim();
  if (!answer) throw new Error('Aborted — a value is required.');
  return answer;
}

function defaultOpenUrl(url) {
  try {
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    else if (process.platform === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
    else spawnSync('xdg-open', [url], { stdio: 'ignore' });
  } catch {
    // best-effort — the URL is printed either way
  }
}

// config.js hardcodes homedir(); these wrappers honor the injectable homeDir
// (tests) while production passes the real one and shares the same file.
function readConfigForHome(homeDir) {
  const path = join(homeDir, '.dashclaw', 'config.json');
  if (homeDir === homedir()) return readConfigFile();
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function writeConfigForHome(homeDir, config) {
  if (homeDir === homedir()) {
    writeConfigFile(config);
    return;
  }
  const dir = join(homeDir, '.dashclaw');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
