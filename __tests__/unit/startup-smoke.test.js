import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  assertPortAvailable,
  createStartServerSpawnConfig,
  formatSetupStatusSummary,
  sendTerminationSignal,
  shutdownChildProcess,
  waitForConfiguredSetup,
} from '../../scripts/lib/startup-smoke.mjs';

describe('startup smoke runner', () => {
  it('returns immediately when setup status is configured', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      async json() {
        return { configured: true, message: 'Dashboard is configured' };
      },
    }));

    const result = await waitForConfiguredSetup({
      url: 'http://127.0.0.1:3000/api/setup/status',
      fetchImpl,
      sleepImpl: async () => {},
      timeoutMs: 100,
      intervalMs: 1,
    });

    expect(result.configured).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries until setup status becomes configured', async () => {
    const responses = [
      { status: 200, body: { configured: false, reason: 'no_tables', message: 'Missing 2 core table(s). Run migrations.' } },
      { status: 200, body: { configured: false, reason: 'no_tables', message: 'Missing 1 core table(s). Run migrations.' } },
      { status: 200, body: { configured: true, message: 'Dashboard is configured' } },
    ];

    const fetchImpl = vi.fn(async () => {
      const next = responses.shift();
      return {
        status: next.status,
        async json() {
          return next.body;
        },
      };
    });

    const result = await waitForConfiguredSetup({
      url: 'http://127.0.0.1:3000/api/setup/status',
      fetchImpl,
      sleepImpl: async () => {},
      timeoutMs: 100,
      intervalMs: 1,
    });

    expect(result.configured).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws with the last seen status when setup never becomes configured', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      async json() {
        return { configured: false, reason: 'no_tables', message: 'Missing 6 core table(s). Run migrations.' };
      },
    }));

    await expect(waitForConfiguredSetup({
      url: 'http://127.0.0.1:3000/api/setup/status',
      fetchImpl,
      sleepImpl: async () => {},
      timeoutMs: 10,
      intervalMs: 1,
    })).rejects.toThrow(/no_tables/i);
  });

  it('formats setup status summaries for logs', () => {
    expect(formatSetupStatusSummary({ configured: true, message: 'Dashboard is configured' }, 200)).toContain('configured');
    expect(formatSetupStatusSummary({ configured: false, reason: 'connection_error' }, 500)).toContain('connection_error');
  });

  it('uses cmd.exe without shell args when spawning npm start on Windows', () => {
    const config = createStartServerSpawnConfig({
      cwd: 'C:/Projects/DashClaw',
      env: { NODE_ENV: 'production' },
      platform: 'win32',
      port: 3100,
      comspec: 'C:\\Windows\\System32\\cmd.exe',
    });

    expect(config.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(config.args).toEqual(['/d', '/s', '/c', 'npm.cmd run start']);
    expect(config.options.shell).toBe(false);
    expect(config.options.detached).toBe(false);
    expect(config.options.env.PORT).toBe('3100');
  });

  it('keeps process-group shutdown on POSIX npm start', () => {
    const config = createStartServerSpawnConfig({
      cwd: '/repo',
      env: { NODE_ENV: 'production' },
      platform: 'linux',
      port: 3100,
    });

    expect(config.command).toBe('npm');
    expect(config.options.shell).toBe(false);
    expect(config.options.detached).toBe(true);
    expect(config.options.env.PORT).toBe('3100');
  });

  it('resolves when the target port is free', async () => {
    function fakeServer() {
      const emitter = new EventEmitter();
      emitter.listen = () => {
        process.nextTick(() => emitter.emit('listening'));
      };
      emitter.close = (cb) => cb();
      return emitter;
    }

    await expect(assertPortAvailable(3100, { createServerImpl: fakeServer })).resolves.toBeUndefined();
  });

  it('rejects with an actionable message when a stale server already holds the port', async () => {
    function fakeServer() {
      const emitter = new EventEmitter();
      emitter.listen = () => {
        const error = new Error('address already in use');
        error.code = 'EADDRINUSE';
        process.nextTick(() => emitter.emit('error', error));
      };
      emitter.close = (cb) => cb();
      return emitter;
    }

    await expect(assertPortAvailable(3100, { createServerImpl: fakeServer }))
      .rejects.toThrow(/port 3100 is already in use/i);
  });

  it('rejects invalid startup smoke ports before spawning a shell command', () => {
    expect(() => createStartServerSpawnConfig({ port: 'bad' })).toThrow(/invalid port/i);
    expect(() => createStartServerSpawnConfig({ port: 70000 })).toThrow(/invalid port/i);
  });

  it('waits for child shutdown after SIGTERM', async () => {
    const child = { kill: vi.fn() };
    let exited = false;
    let resolveExit;
    const exitPromise = new Promise((resolve) => {
      resolveExit = () => {
        exited = true;
        resolve();
      };
    });

    await shutdownChildProcess({
      child,
      hasExited: () => exited,
      exitPromise,
      sleepImpl: async () => {
        resolveExit();
      },
      graceMs: 10,
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('forces SIGKILL when the child ignores SIGTERM', async () => {
    const child = { kill: vi.fn() };

    await shutdownChildProcess({
      child,
      hasExited: () => false,
      exitPromise: new Promise(() => {}),
      sleepImpl: async () => {},
      graceMs: 0,
    });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('targets the detached process group on posix when sending termination signals', () => {
    const killImpl = vi.fn();
    sendTerminationSignal({
      child: { pid: 4242, kill: vi.fn() },
      signal: 'SIGTERM',
      isDetached: true,
      platform: 'linux',
      killImpl,
    });

    expect(killImpl).toHaveBeenCalledWith(-4242, 'SIGTERM');
  });

  it('terminates the Windows process tree for cmd-launched npm start', () => {
    const taskkillImpl = vi.fn();
    const child = { pid: 4242, kill: vi.fn() };

    sendTerminationSignal({
      child,
      signal: 'SIGTERM',
      platform: 'win32',
      taskkillImpl,
    });

    expect(taskkillImpl).toHaveBeenCalledWith(4242);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
