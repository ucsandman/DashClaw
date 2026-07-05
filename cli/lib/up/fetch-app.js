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
 * npm's version number is only trusted after verifying its git tag exists —
 * a publish that shipped without cutting its tag would otherwise 404 every
 * install. When the tag is missing, fall back to the latest GitHub release.
 *
 * @param {typeof fetch} fetchImpl - injectable for tests
 * @param {{ error: (...args: any[]) => void }} logger
 * @returns {Promise<string>} semver string e.g. '4.21.0'
 */
export async function resolveAppVersion(fetchImpl = fetch, logger = console) {
  const res = await fetchImpl('https://registry.npmjs.org/dashclaw/latest');
  if (!res.ok) {
    throw new Error(`npm registry lookup failed (${res.status}) — check your network and retry.`);
  }
  const { version } = await res.json();
  if (!version) throw new Error('npm registry returned no version for dashclaw.');

  const head = await fetchImpl(tarballUrl(version), { method: 'HEAD' });
  if (head.ok) return version;

  const rel = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  const tagName = rel.ok ? (await rel.json()).tag_name : null;
  const fallback = typeof tagName === 'string' ? tagName.replace(/^v/, '') : null;
  if (!fallback) {
    throw new Error(
      `Tag v${version} (npm latest) is missing on GitHub and no release fallback was found — report this at https://github.com/${REPO}/issues.`,
    );
  }
  logger.error(`[warn] npm reports ${version} but tag v${version} is missing; using latest GitHub release ${fallback} instead.`);
  return fallback;
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
    // Resume-skip: a pre-existing package.json means a prior successful extract.
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
  try {
    await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: target, strip: 1 }));
    if (!existsSync(join(target, 'package.json'))) {
      throw new Error('Extracted tarball did not contain package.json — aborting.');
    }
  } catch (e) {
    rmSync(target, { recursive: true, force: true });
    throw e;
  }
  // Invariant: a target dir with package.json present can only result from a
  // successful prior extract because every failure path above removes the dir.
  return target;
}
