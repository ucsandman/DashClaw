// cli/lib/up/run.js
//
// Build, start, health-wait, and open-browser primitives for `npx dashclaw up`.

import { spawn, spawnSync } from 'node:child_process';

const shell = process.platform === 'win32';

function npm(args, cwd, logger) {
  logger.error(`-> npm ${args.join(' ')}`);
  const res = spawnSync('npm', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], shell });
  if (res.status !== 0) throw new Error(`npm ${args[0]} failed (exit ${res.status}). Re-run \`npx dashclaw up\` to resume from this step.`);
}

export function installDeps(appDir, logger = console) {
  try { npm(['ci', '--no-audit', '--no-fund'], appDir, logger); }
  catch { npm(['install', '--no-audit', '--no-fund'], appDir, logger); } // lockfile mismatch fallback
}

export function buildApp(appDir, logger = console) {
  npm(['run', 'build'], appDir, logger);
}

/** Start `next start` as a child; .env.local in appDir is loaded by Next itself. */
export function startServer({ appDir, port, logger = console }) {
  logger.error(`-> Starting server on :${port}`);
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: appDir, stdio: ['ignore', 'inherit', 'inherit'], shell,
  });
  return child;
}

export async function waitForHealth({ baseUrl, fetchImpl = fetch, timeoutMs = 60_000, intervalMs = 1000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/health`);
      if (res.status === 200) return;
      lastStatus = res.status;
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
