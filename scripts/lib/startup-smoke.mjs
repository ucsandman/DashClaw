import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

export function formatSetupStatusSummary(body = {}, status = null) {
  const http = status == null ? '' : `http=${status} `;
  const configured = body?.configured === true ? 'configured' : 'not_configured';
  const reason = body?.reason ? ` reason=${body.reason}` : '';
  const message = body?.message ? ` message="${body.message}"` : '';
  return `${http}${configured}${reason}${message}`.trim();
}

function normalizePort(port) {
  const normalized = Number(port);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw new Error(`Invalid port for startup smoke: ${port}`);
  }
  return String(normalized);
}

// Guards against the "stale server on the port" false-positive class: if a
// prior smoke run (or a leftover `next start`) is still bound to this port,
// spawning a new server either fails to bind or the poll below ends up
// hitting the OLD process while a fresh .next build sits unused underneath
// it — every route looks broken even though the current build is fine.
export function assertPortAvailable(port, { host = '127.0.0.1', createServerImpl = createServer } = {}) {
  const targetPort = normalizePort(port);
  return new Promise((resolve, reject) => {
    const tester = createServerImpl();
    tester.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        reject(new Error(
          `startup smoke: port ${targetPort} is already in use by another process. ` +
          'A stale server left on this port will be tested instead of the fresh build. ' +
          `Free it first (Windows: netstat -ano | findstr :${targetPort} then taskkill /PID <pid> /F; ` +
          `POSIX: lsof -i:${targetPort} then kill <pid>) and re-run.`,
        ));
        return;
      }
      reject(error);
    });
    tester.once('listening', () => {
      tester.close(() => resolve());
    });
    tester.listen(Number(targetPort), host);
  });
}

export function createStartServerSpawnConfig({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  port = 3100,
  comspec = 'cmd.exe',
} = {}) {
  const isWindows = platform === 'win32';
  const smokePort = normalizePort(port);
  const spawnEnv = { ...env, PORT: smokePort };

  if (isWindows) {
    return {
      command: comspec,
      args: ['/d', '/s', '/c', 'npm.cmd run start'],
      options: {
        cwd,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: false,
      },
    };
  }

  return {
    command: 'npm',
    args: ['run', 'start'],
    options: {
      cwd,
      env: spawnEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      shell: false,
    },
  };
}

export async function waitForConfiguredSetup({
  url,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 45000,
  intervalMs = 1000,
  shouldAbort = null,
} = {}) {
  const startedAt = Date.now();
  let lastSummary = 'no response received';

  while (Date.now() - startedAt < timeoutMs) {
    if (shouldAbort?.()) {
      throw new Error(`startup smoke aborted before setup configured: ${lastSummary}`);
    }

    try {
      const response = await fetchImpl(url);
      let body = {};
      try {
        body = await response.json();
      } catch {
        body = {};
      }

      lastSummary = formatSetupStatusSummary(body, response.status);
      if (response.status === 200 && body?.configured === true) {
        return body;
      }
    } catch (error) {
      lastSummary = `request_failed ${error.message}`;
    }

    await sleepImpl(intervalMs);
  }

  throw new Error(`startup smoke timed out waiting for configured setup status from ${url}; last=${lastSummary}`);
}

export function sendTerminationSignal({
  child,
  signal,
  isDetached = false,
  platform = process.platform,
  killImpl = process.kill,
  taskkillImpl = (pid) => {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
  },
} = {}) {
  if (!child) return;

  if (platform === 'win32' && Number.isInteger(child.pid)) {
    taskkillImpl(child.pid);
    return;
  }

  if (platform !== 'win32' && isDetached && Number.isInteger(child.pid)) {
    killImpl(-child.pid, signal);
    return;
  }

  child.kill(signal);
}

export async function shutdownChildProcess({
  child,
  hasExited = () => false,
  exitPromise = Promise.resolve(),
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  graceMs = 5000,
  isDetached = false,
  platform = process.platform,
  killImpl = process.kill,
} = {}) {
  if (!child || hasExited()) return;

  sendTerminationSignal({ child, signal: 'SIGTERM', isDetached, platform, killImpl });

  if (graceMs <= 0) {
    if (!hasExited()) {
      sendTerminationSignal({ child, signal: 'SIGKILL', isDetached, platform, killImpl });
    }
    return;
  }

  const deadline = Date.now() + graceMs;
  while (!hasExited() && Date.now() < deadline) {
    await Promise.race([exitPromise, sleepImpl(50)]);
  }

  if (!hasExited()) {
    sendTerminationSignal({ child, signal: 'SIGKILL', isDetached, platform, killImpl });
  }
}
