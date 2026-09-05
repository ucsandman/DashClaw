import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import {
  commandLooksLikeDashClawServer,
  defaultProcessAlive,
  readProcessCommand,
  stopOwnedServer,
} from '../../lib/up/index.js';

describe('update process ownership check', () => {
  it('accepts the recorded Next start command only on the recorded port', () => {
    assert.strictEqual(commandLooksLikeDashClawServer('npx next start -p 3000', 3000), true);
    assert.strictEqual(commandLooksLikeDashClawServer('node C:/app/node_modules/next/dist/bin/next start --port 3000', 3000), true);
    assert.strictEqual(commandLooksLikeDashClawServer('npx next start -p 4000', 3000), false);
  });

  it('rejects unrelated live processes even when their arguments mention the port', () => {
    assert.strictEqual(commandLooksLikeDashClawServer('node worker.js --port 3000', 3000), false);
    assert.strictEqual(commandLooksLikeDashClawServer('postgres -p 3000', 3000), false);
    assert.strictEqual(commandLooksLikeDashClawServer('', 3000), false);
  });

  it('refuses an unrelated recorded pid without sending a kill', async () => {
    let killed = false;
    await assert.rejects(
      () => stopOwnedServer({
        pid: 4242,
        appDir: 'C:/dashclaw/app/9.9.8',
        port: 3000,
        expectedVersion: '9.9.8',
        baseUrl: 'http://localhost:3000',
        processAlive: () => true,
        processCommand: () => 'node unrelated-worker.js --port 3000',
        healthProbe: async () => ({ status: 200, body: { version: '9.9.8' } }),
        kill: () => { killed = true; },
      }),
      /Refusing to stop pid 4242.*does not match/,
    );
    assert.strictEqual(killed, false);
  });

  it('stops and observes exit of a benign child only after command and version evidence agree', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });

    try {
      assert.strictEqual(defaultProcessAlive(child.pid), true);
      await stopOwnedServer({
        pid: child.pid,
        appDir: 'C:/dashclaw/app/9.9.8',
        port: 3000,
        expectedVersion: '9.9.8',
        baseUrl: 'http://localhost:3000',
        processCommand: () => 'npx next start -p 3000',
        healthProbe: async () => ({ status: 200, body: { version: '9.9.8' } }),
        kill: (pid) => process.kill(pid),
      });
      assert.strictEqual(defaultProcessAlive(child.pid), false);
    } finally {
      if (defaultProcessAlive(child.pid)) child.kill();
    }
  });

  it('reads a real benign child command for the ownership decision', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });

    try {
      assert.match(readProcessCommand(child.pid), /setInterval/);
    } finally {
      child.kill();
    }
  });
});
