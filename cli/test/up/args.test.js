// cli/test/up/args.test.js
//
// Tests for cli/lib/up/args.js — the flag parser for `dashclaw up`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseUpArgs } from '../../lib/up/args.js';

describe('parseUpArgs', () => {
  test('defaults', () => {
    assert.deepStrictEqual(parseUpArgs([]), {
      update: false, yes: false, noBrowser: false,
      db: null, dir: null, port: null, sourceDir: null,
    });
  });

  test('parses all flags', () => {
    assert.deepStrictEqual(
      parseUpArgs(['--update', '--yes', '--no-browser', '--db', 'embedded', '--dir', '/x', '--port', '3210', '--source-dir', '.']),
      { update: true, yes: true, noBrowser: true, db: 'embedded', dir: '/x', port: 3210, sourceDir: '.' }
    );
  });

  test('rejects unknown --db values', () => {
    assert.throws(
      () => parseUpArgs(['--db', 'sqlite']),
      /docker, embedded, url/
    );
  });

  test('rejects a non-numeric port', () => {
    assert.throws(
      () => parseUpArgs(['--port', 'abc']),
      /port/i
    );
  });

  test('rejects unknown flags', () => {
    assert.throws(
      () => parseUpArgs(['--prot', '3000']),
      /Unknown flag: --prot/
    );
  });

  test('accepts --update without error', () => {
    assert.doesNotThrow(() => parseUpArgs(['--update']));
  });
});
