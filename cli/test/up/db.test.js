// cli/test/up/db.test.js
//
// Tests for cli/lib/up/db.js — database mode selection and docker command shape.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chooseDbMode, dockerCommandFor, provisionDatabase } from '../../lib/up/db.js';

describe('chooseDbMode', () => {
  test('honors explicit flagDb even when docker is available', async () => {
    const mode = await chooseDbMode({ flagDb: 'embedded', dockerAvailable: true });
    assert.strictEqual(mode, 'embedded');
  });

  test('defaults to docker when docker is available and yes is true', async () => {
    const mode = await chooseDbMode({ flagDb: null, dockerAvailable: true, yes: true });
    assert.strictEqual(mode, 'docker');
  });

  test('defaults to embedded when docker is unavailable and yes is true', async () => {
    const mode = await chooseDbMode({ flagDb: null, dockerAvailable: false, yes: true });
    assert.strictEqual(mode, 'embedded');
  });

  test('prompts interactively and maps answer "3" to url', async () => {
    let callCount = 0;
    const promptFn = async (_msg) => { callCount++; return '3'; };
    const mode = await chooseDbMode({ flagDb: null, dockerAvailable: true, yes: false, promptFn });
    assert.strictEqual(mode, 'url');
    assert.strictEqual(callCount, 1);
  });
});

describe('provisionDatabase — url mode', () => {
  test('rejects non-postgresql:// connection strings', async () => {
    await assert.rejects(
      () => provisionDatabase({ mode: 'url', promptFn: async () => 'mysql://x' }),
      /postgresql:\/\//,
    );
  });
});

describe('dockerCommandFor', () => {
  test('uses postgres:16-alpine image', () => {
    const { args } = dockerCommandFor();
    assert.ok(args.includes('postgres:16-alpine'), 'expected postgres:16-alpine in args');
  });

  test('maps host port 5433 to container port 5432', () => {
    const { args } = dockerCommandFor();
    const joined = args.join(' ');
    assert.ok(joined.includes('5433:5432'), 'expected 5433:5432 port mapping');
  });

  test('uses dashclaw_pgdata named volume', () => {
    const { args } = dockerCommandFor();
    const joined = args.join(' ');
    assert.ok(joined.includes('dashclaw_pgdata'), 'expected dashclaw_pgdata volume');
  });
});
