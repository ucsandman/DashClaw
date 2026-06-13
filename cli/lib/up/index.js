// cli/lib/up/index.js
//
// Orchestrator for `npx dashclaw up` — composes the up/ primitives into the
// full pipeline (fetch → deps → db → setup → build → start → connect → open),
// checkpointed and resumable via instance.json.
//
// Three operating modes fall out of the same loop:
//   fresh   — no instance.json: run every step.
//   resume  — partial completed[]: skip done steps, continue from the first gap.
//   boot    — all six steps done: skip everything up to start, then start+open.
//
// Every effect is injectable via `deps` so the orchestrator is unit-testable
// without touching the network, Docker, or a real Next server.

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { STEPS, loadInstance, saveInstance, checkpoint } from './instance.js';
import { resolveAppVersion, downloadAndExtract } from './fetch-app.js';
import { dockerAvailableSync, chooseDbMode, provisionDatabase } from './db.js';
import { installDeps, buildApp, startServer, waitForHealth, openBrowser } from './run.js';
import { installClaude } from '../claude/install.js';
import { parseUpArgs } from './args.js';
import { ask } from '../config.js';

/**
 * Kill a process and its entire child tree. On Windows, `process.kill` only
 * terminates the cmd.exe shell wrapper that `shell:true` spawns — taskkill /T
 * reaches the actual Next server underneath.
 */
export function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    process.kill(pid);
  }
}

/**
 * Resolve the base state directory from parsed args.
 * Exported so upCommand + cmdDown can unit-test the wiring without spawning.
 */
export function resolveBaseDir(args) {
  return args.dir ?? join(homedir(), '.dashclaw');
}

/**
 * Run the app's setup script in-process via spawnSync, contract:
 *   node --import tsx scripts/setup.mjs --yes --json --database-url <url>
 * prints EXACTLY ONE JSON line: {ok:true, apiKey, adminPassword} or
 * {ok:false, error} with a non-zero exit. We parse the LAST stdout line.
 *
 * @param {object} opts
 * @param {string} opts.appDir
 * @param {string} opts.databaseUrl
 * @param {object} [opts.logger]
 * @param {Function} [opts.spawn]  injectable spawnSync for testing (default: spawnSync)
 */
export function runSetupScriptReal({ appDir, databaseUrl, logger = console, spawn: spawnFn = spawnSync }) {
  logger.error('-> Running setup (migrations + first admin) ...');
  const res = spawnFn(
    'node',
    ['--import', 'tsx', 'scripts/setup.mjs', '--yes', '--json', '--database-url', databaseUrl],
    // stdin MUST be 'ignore': the default open pipe makes any stray readline
    // prompt in the child hang forever (observed: 12-minute silent hang).
    { cwd: appDir, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stdout = res.stdout || '';
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  let parsed = null;
  if (lines.length) {
    try { parsed = JSON.parse(lines[lines.length - 1]); } catch {
      throw new Error(`Setup output was not parseable JSON. Last line: ${lines[lines.length - 1]}`);
    }
  }
  if (res.status !== 0 || parsed?.ok === false) {
    const detail = parsed?.error
      || (res.stderr || '').slice(-2000).trim()
      || `setup exited ${res.status}`;
    throw new Error(`Setup failed: ${detail}`);
  }
  if (!parsed) throw new Error('Setup produced no parseable JSON output.');
  return parsed;
}

/** The real effect wiring — swapped wholesale by tests. */
export function realDeps() {
  return {
    resolveAppVersion,
    downloadAndExtract,
    installDeps,
    chooseDbMode,
    provisionDatabase,
    runSetupScript: runSetupScriptReal,
    buildApp,
    startServer,
    waitForHealth,
    installClaude,
    openBrowser,
    promptFn: ask,
    logger: console,
    dockerAvailable: dockerAvailableSync(),
  };
}

/**
 * Run (or resume, or boot) a local DashClaw instance.
 *
 * @param {object} opts
 * @param {object} opts.args      parsed up args (yes, noBrowser, db, port, sourceDir, update)
 * @param {string} [opts.baseDir] state + data dir (default ~/.dashclaw)
 * @param {object} [opts.deps]    injected effects (default realDeps())
 * @returns {Promise<{ child, stopDb, baseUrl }>}
 */
export async function runUp({ args, baseDir = join(homedir(), '.dashclaw'), deps = realDeps() }) {
  const { logger } = deps;

  let inst = loadInstance(baseDir) ?? { completed: [] };
  if (args.update) {
    inst = saveInstance(baseDir, { completed: [] });
  }
  const done = (step) => inst.completed.includes(step);

  const port = args.port ?? inst.port ?? 3000;
  const baseUrl = `http://localhost:${port}`;

  // 1. app_fetched ----------------------------------------------------------
  let appDir = inst.appDir;
  if (!done('app_fetched')) {
    const version = args.sourceDir ? 'source' : await deps.resolveAppVersion();
    appDir = args.sourceDir ?? await deps.downloadAndExtract({ version, baseDir, logger });
    inst = saveInstance(baseDir, { version, appDir, port });
    inst = checkpoint(baseDir, 'app_fetched');
  }

  // 2. deps_installed -------------------------------------------------------
  if (!done('deps_installed')) {
    deps.installDeps(appDir, logger);
    inst = checkpoint(baseDir, 'deps_installed');
  }

  // 3. db_ready -------------------------------------------------------------
  // provisionDatabase is idempotent and restarts a stopped DB, so we call it
  // every run (including boot) — but only choose the mode + checkpoint once.
  const dbMode = inst.dbMode ?? await deps.chooseDbMode({
    flagDb: args.db, dockerAvailable: deps.dockerAvailable, yes: args.yes, promptFn: deps.promptFn,
  });
  const db = await deps.provisionDatabase({ mode: dbMode, baseDir, promptFn: deps.promptFn, logger });
  if (!done('db_ready')) {
    inst = saveInstance(baseDir, { dbMode, databaseUrl: db.databaseUrl });
    inst = checkpoint(baseDir, 'db_ready');
  }
  const databaseUrl = inst.databaseUrl ?? db.databaseUrl;

  // 4. setup_done -----------------------------------------------------------
  let apiKey = inst.apiKey;
  if (!done('setup_done')) {
    const out = await deps.runSetupScript({ appDir, databaseUrl, logger });
    if (out.ok === false) throw new Error(out.error || 'Setup failed.');
    apiKey = out.apiKey;
    inst = saveInstance(baseDir, { apiKey });
    // setup.mjs already prints the password once (to stderr) and writes it to
    // .env.local; we deliberately do NOT echo it again here — no secrets twice.
    if (out.adminPassword) {
      logger.error('[ok] First admin created — credentials written to .env.local (printed once).');
    }
    inst = checkpoint(baseDir, 'setup_done');
  }

  // 5. built ----------------------------------------------------------------
  if (!done('built')) {
    deps.buildApp(appDir, logger);
    inst = checkpoint(baseDir, 'built');
  }

  // 6. start (always — the server is not persistent across `up` invocations)
  const child = deps.startServer({ appDir, port, logger });
  inst = saveInstance(baseDir, { pid: child.pid });
  try {
    await deps.waitForHealth({ baseUrl });
  } catch (e) {
    // Health timeout: kill the orphaned server and clear the stale pid so the
    // next `dashclaw up` doesn't try to resume a dead process.
    try { killTree(child.pid); } catch { /* already gone */ }
    saveInstance(baseDir, { pid: null });
    throw e;
  }
  logger.log(`[ok] Server running at ${baseUrl}   (Ctrl+C stops it; \`dashclaw up\` restarts it)`);

  // 7. connected ------------------------------------------------------------
  if (!done('connected')) {
    let connect = true;
    if (!args.yes) {
      const answer = (await deps.promptFn('Connect Claude Code now? [Y/n] ')).trim().toLowerCase();
      connect = answer !== 'n' && answer !== 'no';
    }
    if (connect) {
      await deps.installClaude({ endpoint: baseUrl, apiKey });
    }
    inst = checkpoint(baseDir, 'connected'); // declining is still a completed decision
  }

  // 8. open -----------------------------------------------------------------
  if (!args.noBrowser) {
    deps.openBrowser(`${baseUrl}/setup`, logger);
  }
  logger.log(`Done. First steps: ${baseUrl}/connect`);

  return { child, stopDb: db.stop, baseUrl };
}

/**
 * Stop the local instance: kill the server child (if recorded) and stop the
 * Docker container if we started one. Embedded Postgres dies with the up
 * process, so there is nothing to stop for that mode.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseDir]     state dir (default ~/.dashclaw)
 * @param {object} [opts.logger]      logger (default console)
 * @param {Function} [opts.kill]      injectable kill fn for testing (default killTree)
 * @param {Function} [opts.dockerStop] injectable docker-stop fn for testing
 */
export async function runDown({
  baseDir = join(homedir(), '.dashclaw'),
  logger = console,
  kill = killTree,
  dockerStop = (container) => spawnSync('docker', ['stop', container], { stdio: 'ignore' }),
} = {}) {
  const inst = loadInstance(baseDir);
  if (!inst) {
    logger.log('No local DashClaw instance recorded — nothing to stop.');
    return;
  }
  if (inst.pid) {
    try {
      kill(inst.pid);
      logger.log(`[ok] Stopped server (pid ${inst.pid}).`);
    } catch {
      logger.log('Server was not running.');
    }
    saveInstance(baseDir, { pid: null });
  }
  if (inst.dbMode === 'docker') {
    // No shell — house decision (see db.js): docker args are passed directly.
    dockerStop('dashclaw-pg');
    logger.log('[ok] Stopped Docker Postgres (container dashclaw-pg).');
  }
}

/**
 * `dashclaw up` entry point: parse args, run the pipeline, and keep the process
 * alive until the server child exits or the user interrupts. SIGINT/SIGTERM
 * stop the DB cleanly before exiting.
 */
export async function upCommand(argv) {
  const args = parseUpArgs(argv);
  const baseDir = resolveBaseDir(args);
  const { child, stopDb } = await runUp({ args, baseDir });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    // Kill the server child first — on Windows the recorded pid is a cmd.exe
    // wrapper; killTree reaches the actual Next process via taskkill /T /F.
    try { killTree(child.pid); } catch { /* already gone */ }
    await stopDb();
    // Hard exit is intentional here: stopDb has resolved, and we need to
    // ensure the process doesn't linger on SIGINT (especially on Windows where
    // the event loop may keep running after the child exits).
    process.exit(0); // eslint-disable-line no-process-exit
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise((resolve) => child.on('exit', resolve));
  await stopDb();
}
