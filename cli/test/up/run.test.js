// cli/test/up/run.test.js
//
// Tests for cli/lib/up/run.js — waitForHealth polling logic.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { waitForHealth, installDeps } from '../../lib/up/run.js';

describe('installDeps — ci→install fallback', () => {
  test('falls back to npm install when npm ci fails', () => {
    const calls = [];
    const runner = (_cmd, args, _opts) => {
      calls.push(args[0]);
      // Fail ci, succeed install
      return { status: args[0] === 'ci' ? 1 : 0 };
    };
    const logger = { error() {} };
    installDeps('/fake/app', logger, runner);
    assert.deepStrictEqual(calls, ['ci', 'install']);
  });

  test('does not attempt install when npm ci succeeds', () => {
    const calls = [];
    const runner = (_cmd, args, _opts) => {
      calls.push(args[0]);
      return { status: 0 };
    };
    const logger = { error() {} };
    installDeps('/fake/app', logger, runner);
    assert.deepStrictEqual(calls, ['ci']);
  });
});

describe('waitForHealth', () => {
  test('resolves once /api/health returns 200', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (calls.length < 3) return { status: 503 };
      return { status: 200 };
    };

    await waitForHealth({ baseUrl: 'http://localhost:3999', fetchImpl, timeoutMs: 5000, intervalMs: 1 });

    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[0], 'http://localhost:3999/api/health');
  });

  test('throws after the timeout with the last status', async () => {
    const fetchImpl = async () => ({ status: 500 });

    await assert.rejects(
      () => waitForHealth({ baseUrl: 'http://localhost:3999', fetchImpl, timeoutMs: 20, intervalMs: 5 }),
      /health.*500/i,
    );
  });

  test('treats network errors as not-yet-up, not fatal', async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount++;
      if (callCount === 1) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      return { status: 200 };
    };

    await waitForHealth({ baseUrl: 'http://localhost:3999', fetchImpl, timeoutMs: 5000, intervalMs: 1 });

    assert.strictEqual(callCount, 2);
  });
});
