// cli/lib/up/run.js
//
// Build, start, health-wait, and open-browser primitives for `npx dashclaw up`.

import { spawn, spawnSync } from 'node:child_process';

const shell = process.platform === 'win32';

// npm/npx are .cmd files on Windows, which node refuses to spawn without a
// shell — but shell:true + an args ARRAY is deprecated (DEP0190, and the
// warning prints mid-flow for first-run users). So on Windows the command is
// joined into ONE string (quoting any arg with shell-special characters) and
// handed to the shell whole; elsewhere args pass through verbatim, no shell.
// The COMMAND is quoted by the same rule as the args: bare words like npm/npx/
// node are unaffected, but an explicit interpreter path (`dashclaw install
// openclaw --openclaw-bin "C:\Program Files\...\openclaw.cmd"`) is only
// launchable by the shell if it survives with its spaces intact.
const quoteArg = (a) => (/^[\w\-.:/@=]+$/.test(String(a)) ? String(a) : `"${a}"`);
export function winSafeSpawnArgs(cmd, args) {
  return shell
    ? { cmd: [cmd, ...args].map(quoteArg).join(' '), args: [], opts: { shell: true } }
    : { cmd, args, opts: {} };
}

/** spawnSync that takes LOGICAL (cmd, args) and win-joins only at the edge. */
export function winSafeSpawnSync(cmd, args, opts) {
  const safe = winSafeSpawnArgs(cmd, args);
  return spawnSync(safe.cmd, safe.args, { ...opts, ...safe.opts });
}

function npm(args, cwd, logger, runner = winSafeSpawnSync) {
  logger.error(`-> npm ${args.join(' ')}`);
  const res = runner('npm', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  if (res.status !== 0) throw new Error(`npm ${args[0]} failed (exit ${res.status}). Re-run \`npx dashclaw up\` to resume from this step.`);
}

export function installDeps(appDir, logger = console, runner = winSafeSpawnSync) {
  try { npm(['ci', '--no-audit', '--no-fund'], appDir, logger, runner); }
  catch { npm(['install', '--no-audit', '--no-fund'], appDir, logger, runner); } // lockfile mismatch fallback
}

export function buildApp(appDir, logger = console, runner = winSafeSpawnSync) {
  npm(['run', 'build'], appDir, logger, runner);
}

/** Start `next start` as a child; .env.local in appDir is loaded by Next itself. */
export function startServer({ appDir, port, logger = console }) {
  logger.error(`-> Starting server on :${port}`);
  const safe = winSafeSpawnArgs('npx', ['next', 'start', '-p', String(port)]);
  const child = spawn(safe.cmd, safe.args, {
    cwd: appDir, stdio: ['ignore', 'inherit', 'inherit'], ...safe.opts,
  });
  return child;
}

export async function probeServerHealth({ baseUrl, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/api/health`);
  let body = null;
  try { body = await res.json(); } catch { /* version verification reports the missing body */ }
  return { status: res.status, body };
}

export async function waitForHealth({
  baseUrl,
  expectedVersion,
  fetchImpl = fetch,
  timeoutMs = 60_000,
  intervalMs = 1000,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const health = await probeServerHealth({ baseUrl, fetchImpl });
      if (health.status === 200) {
        if (!expectedVersion) return health.body;
        const servedVersion = health.body?.version;
        if (servedVersion === expectedVersion) return health.body;
        lastStatus = `served version ${servedVersion ?? 'unknown'}; expected ${expectedVersion}`;
      } else {
        lastStatus = health.status;
      }
    } catch { lastStatus = 'connection refused'; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server health check failed: /api/health last answered ${lastStatus}. Check the server output above.`);
}

export function openBrowser(url, logger = console) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); }
  catch { logger.error(`Open ${url} in your browser.`); }
}
