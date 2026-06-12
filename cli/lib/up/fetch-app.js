// cli/lib/up/fetch-app.js
//
// Version resolve + tarball fetch/extract for `dashclaw up`.
// Fetches the latest platform version from npm and downloads the corresponding
// GitHub release tarball, extracting it into ${baseDir}/app/${version}/.

import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as tar from 'tar';

const REPO = 'ucsandman/DashClaw';

/**
 * Fetch the latest published platform version from the npm registry.
 * The `dashclaw` npm package version mirrors the platform version (unified versioning).
 *
 * @param {typeof fetch} fetchImpl - injectable for tests
 * @returns {Promise<string>} semver string e.g. '4.21.0'
 */
export async function resolveAppVersion(fetchImpl = fetch) {
  const res = await fetchImpl('https://registry.npmjs.org/dashclaw/latest');
  if (!res.ok) {
    throw new Error(`npm registry lookup failed (${res.status}) — check your network and retry.`);
  }
  const { version } = await res.json();
  if (!version) throw new Error('npm registry returned no version for dashclaw.');
  return version;
}

/**
 * Build the GitHub codeload tarball URL for a given version tag.
 *
 * @param {string} version - semver string e.g. '4.21.0'
 * @returns {string}
 */
export function tarballUrl(version) {
  return `https://codeload.github.com/${REPO}/tar.gz/refs/tags/v${version}`;
}

/**
 * Download and extract the app tarball for `version` into `${baseDir}/app/${version}`.
 * The GitHub tarball wraps everything in a `DashClaw-<version>/` folder —
 * strip 1 level so the app root lands directly in the target dir.
 * Skips cleanly if the target already exists (resume case).
 *
 * @param {object} opts
 * @param {string} opts.version
 * @param {string} opts.baseDir
 * @param {typeof fetch} opts.fetchImpl
 * @param {{ error: (...args: any[]) => void }} opts.logger
 * @returns {Promise<string>} absolute path to the extracted app dir
 */
export async function downloadAndExtract({ version, baseDir, fetchImpl = fetch, logger = console }) {
  const target = join(baseDir, 'app', version);
  if (existsSync(join(target, 'package.json'))) {
    logger.error(`[ok] App ${version} already present at ${target}`);
    return target;
  }
  mkdirSync(target, { recursive: true });
  const res = await fetchImpl(tarballUrl(version));
  if (!res.ok || !res.body) {
    rmSync(target, { recursive: true, force: true });
    throw new Error(
      `Download failed (${res.status}) for ${tarballUrl(version)} — does tag v${version} exist?`,
    );
  }
  await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: target, strip: 1 }));
  if (!existsSync(join(target, 'package.json'))) {
    rmSync(target, { recursive: true, force: true });
    throw new Error('Extracted tarball did not contain package.json — aborting.');
  }
  return target;
}
