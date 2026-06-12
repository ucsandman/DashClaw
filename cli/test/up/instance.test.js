// cli/test/up/instance.test.js
//
// Tests for cli/lib/up/instance.js — instance state checkpointing for `dashclaw up`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadInstance, saveInstance, checkpoint, STEPS } from '../../lib/up/instance.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dashclaw-instance-test-'));
}

describe('loadInstance', () => {
  test('returns null when no instance exists', () => {
    const dir = tempDir();
    assert.strictEqual(loadInstance(dir), null);
  });

  test('tolerates a corrupt file', () => {
    const dir = tempDir();
    saveInstance(dir, {});
    writeFileSync(join(dir, 'instance.json'), 'not-json');
    assert.strictEqual(loadInstance(dir), null);
  });
});

describe('saveInstance + checkpoint', () => {
  test('round-trips and checkpoints in order', () => {
    const dir = tempDir();
    saveInstance(dir, { version: '4.21.0', port: 3000, dbMode: 'embedded' });
    checkpoint(dir, 'db_ready');
    const inst = loadInstance(dir);
    assert.strictEqual(inst.version, '4.21.0');
    assert.deepStrictEqual(inst.completed, ['db_ready']);
  });

  test('checkpoint is idempotent', () => {
    const dir = tempDir();
    saveInstance(dir, {});
    checkpoint(dir, 'db_ready');
    checkpoint(dir, 'db_ready');
    const inst = loadInstance(dir);
    assert.deepStrictEqual(inst.completed, ['db_ready']);
  });
});

describe('STEPS', () => {
  test('exposes the canonical step order', () => {
    assert.deepStrictEqual(
      STEPS,
      ['app_fetched', 'deps_installed', 'db_ready', 'setup_done', 'built', 'connected'],
    );
  });
});
