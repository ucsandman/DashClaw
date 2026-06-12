// cli/test/up/fetch-app.test.js
//
// Tests for cli/lib/up/fetch-app.js — version resolve + tarball fetch/extract.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import * as tar from 'tar';

import { resolveAppVersion, tarballUrl, downloadAndExtract } from '../../lib/up/fetch-app.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dashclaw-fetch-test-'));
}

describe('resolveAppVersion', () => {
  test('reads the latest platform version from the npm registry', async () => {
    let capturedUrl;
    const fetchImpl = async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ version: '4.21.0' }), { status: 200 });
    };
    const version = await resolveAppVersion(fetchImpl);
    assert.strictEqual(version, '4.21.0');
    assert.strictEqual(capturedUrl, 'https://registry.npmjs.org/dashclaw/latest');
  });

  test('throws a clear error on registry failure', async () => {
    const fetchImpl = async () => new Response('Service Unavailable', { status: 503 });
    await assert.rejects(
      () => resolveAppVersion(fetchImpl),
      /registry/i,
    );
  });
});

describe('tarballUrl', () => {
  test('builds the codeload URL', () => {
    assert.strictEqual(
      tarballUrl('4.21.0'),
      'https://codeload.github.com/ucsandman/DashClaw/tar.gz/refs/tags/v4.21.0',
    );
  });
});

describe('downloadAndExtract', () => {
  test('strips the wrapper dir and verifies package.json', async () => {
    const work = tempDir();

    // Build a real fixture tarball: work/DashClaw-9.9.9/package.json
    const srcDir = join(work, 'DashClaw-9.9.9');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'package.json'), JSON.stringify({ name: 'x' }));
    const tarPath = join(work, 'app.tgz');
    await tar.c({ gzip: true, file: tarPath, cwd: work }, ['DashClaw-9.9.9']);

    const fetchImpl = async () =>
      new Response(readFileSync(tarPath), { status: 200 });

    const out = await downloadAndExtract({
      version: '9.9.9',
      baseDir: work,
      fetchImpl,
      logger: { error() {} },
    });

    assert.ok(out.endsWith(join('app', '9.9.9')), `expected path ending in app/9.9.9, got: ${out}`);
    assert.ok(existsSync(join(out, 'package.json')), 'package.json must exist in extracted dir');
  });
});
