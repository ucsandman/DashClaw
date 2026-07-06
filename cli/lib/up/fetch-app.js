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
 * Resolve the latest installable platform version.
 *
 * GitHub releases are the platform-version pointer: a GitHub Release rides
 * every ship, while npm's `dashclaw` version lags behind on platform-only
 * releases — the SDK packages republish only when SDK source changes, which
 * once froze fresh installs at platform 4.63.2 while main was at 4.66.0
 * (dropping, among others, the workspace-import route that trial graduation
 * depends on). npm latest stays as the fallback for GitHub API failures or
 * rate limits; either path is only trusted after a HEAD check confirms the
 * tag's tarball actually exists.
 *
 * @param {typeof fetch} fetchImpl - injectable for tests
 * @param {{ error: (...args: any[]) => void }} logger
 * @returns {Promise<string>} semver string e.g. '4.66.0'
 */
export async function resolveAppVersion(fetchImpl = fetch, logger = console) {
  try {
    const rel = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (rel.ok) {
      const tagName = (await rel.json()).tag_name;
      const version = typeof tagName === 'string' ? tagName.replace(/^v/, '') : null;
      if (version) {
        const head = await fetchImpl(tarballUrl(version), { method: 'HEAD' });
        if (head.ok) return version;
      }
    }
  } catch {
    // Network/API failure — fall through to the npm path below.
  }

  const res = await fetchImpl('https://registry.npmjs.org/dashclaw/latest');
  if (!res.ok) {
    throw new Error(
      `Version lookup failed: GitHub releases unavailable and npm registry answered ${res.status} — check your network and retry.`,
    );
  }
  const { version } = await res.json();
  if (!version) throw new Error('npm registry returned no version for dashclaw.');

  const head = await fetchImpl(tarballUrl(version), { method: 'HEAD' });
  if (!head.ok) {
    throw new Error(
      `No installable version found: GitHub releases lookup failed and tag v${version} (npm latest) is missing on GitHub — report this at https://github.com/${REPO}/issues.`,
    );
  }
  logger.error(`[warn] GitHub releases lookup failed; using npm latest ${version} (may lag behind the newest platform release).`);
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
