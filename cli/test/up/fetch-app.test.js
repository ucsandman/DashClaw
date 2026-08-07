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
  const quiet = { error() {} };

  test('reads the latest GitHub release first, never touching npm on the happy path', async () => {
    const urls = [];
    const fetchImpl = async (url, opts = {}) => {
      urls.push(url);
      if (url.endsWith('/releases/latest')) {
        return new Response(JSON.stringify({ tag_name: 'v4.66.0' }), { status: 200 });
      }
      // HEAD tarball-existence check
      assert.strictEqual(opts.method, 'HEAD');
      return new Response(null, { status: 200 });
    };
    const version = await resolveAppVersion(fetchImpl, quiet);
    assert.strictEqual(version, '4.66.0');
    assert.ok(urls[0].endsWith('/releases/latest'));
    assert.ok(urls[1].endsWith('/refs/tags/v4.66.0'));
    assert.ok(!urls.some((u) => new URL(u).hostname === 'registry.npmjs.org'), 'npm must not be consulted when GitHub answers');
  });

  test('falls back to npm latest when the GitHub releases lookup fails', async () => {
    const warnings = [];
    const fetchImpl = async (url) => {
      if (url.endsWith('/releases/latest')) return new Response(null, { status: 403 });
      if (url === 'https://registry.npmjs.org/dashclaw/latest') {
        return new Response(JSON.stringify({ version: '4.63.2' }), { status: 200 });
      }
      if (url.includes('/refs/tags/')) return new Response(null, { status: 200 });
      throw new Error(`unexpected url: ${url}`);
    };
    const version = await resolveAppVersion(fetchImpl, { error: (m) => warnings.push(m) });
    assert.strictEqual(version, '4.63.2');
    assert.match(warnings.join(' '), /using npm latest 4\.63\.2/);
  });

  test('falls back to npm when the GitHub release tag has no tarball', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/releases/latest')) {
        return new Response(JSON.stringify({ tag_name: 'v4.67.0' }), { status: 200 });
      }
      if (url.includes('/refs/tags/v4.67.0')) return new Response(null, { status: 404 });
      if (url === 'https://registry.npmjs.org/dashclaw/latest') {
        return new Response(JSON.stringify({ version: '4.63.2' }), { status: 200 });
      }
      if (url.includes('/refs/tags/v4.63.2')) return new Response(null, { status: 200 });
      throw new Error(`unexpected url: ${url}`);
    };
    const version = await resolveAppVersion(fetchImpl, quiet);
    assert.strictEqual(version, '4.63.2');
  });

  test('falls back to npm when the GitHub fetch throws (network error)', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/releases/latest')) throw new Error('ECONNRESET');
      if (url === 'https://registry.npmjs.org/dashclaw/latest') {
        return new Response(JSON.stringify({ version: '4.63.2' }), { status: 200 });
      }
      return new Response(null, { status: 200 });
    };
    const version = await resolveAppVersion(fetchImpl, quiet);
    assert.strictEqual(version, '4.63.2');
  });

  test('throws a clear error when both GitHub and the npm tag are missing', async () => {
    const fetchImpl = async (url) => {
      if (url === 'https://registry.npmjs.org/dashclaw/latest') {
        return new Response(JSON.stringify({ version: '4.32.0' }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    };
    await assert.rejects(
      () => resolveAppVersion(fetchImpl, quiet),
      /No installable version found/,
    );
  });

  test('throws a clear error when GitHub fails and the npm registry is down', async () => {
    const fetchImpl = async () => new Response('Service Unavailable', { status: 503 });
    await assert.rejects(
      () => resolveAppVersion(fetchImpl, quiet),
      /npm registry answered 503/,
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

  test('rejects on truncated/corrupt stream and removes partial target dir', async () => {
    const work = tempDir();
    const fetchImpl = async () =>
      new Response(Buffer.from('not a tarball'), { status: 200 });

    await assert.rejects(
      () => downloadAndExtract({
        version: '9.9.8',
        baseDir: work,
        fetchImpl,
        logger: { error() {} },
      }),
    );
    const target = join(work, 'app', '9.9.8');
    assert.strictEqual(existsSync(target), false, 'partial target dir must be removed on pipeline failure');
  });

  test('skips fetch entirely when target already has package.json (resume)', async () => {
    const work = tempDir();
    const target = join(work, 'app', '9.9.7');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'cached' }));

    const fetchImpl = () => { throw new Error('must not fetch'); };

    const out = await downloadAndExtract({
      version: '9.9.7',
      baseDir: work,
      fetchImpl,
      logger: { error() {} },
    });
    assert.strictEqual(out, target);
  });
});
