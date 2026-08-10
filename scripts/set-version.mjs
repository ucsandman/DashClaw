#!/usr/bin/env node
/**
 * set-version.mjs <x.y.z> — set the unified DashClaw version across the
 * platform and both SDK manifests at once, so they never drift:
 *   package.json, sdk/package.json, sdk-python/pyproject.toml
 *
 * Usage:
 *   node scripts/set-version.mjs 4.1.0
 *   npm run version:set -- 4.1.0
 *
 * Afterward run `npm install` to sync package-lock.json, then commit.
 * `npm run version:sync:check` (CI + pre-commit) enforces that these agree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpReleasePlan } from './lib/bump-release-plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version || '')) {
  console.error('Usage: node scripts/set-version.mjs <x.y.z>   (or: npm run version:set -- <x.y.z>)');
  process.exit(1);
}

function setJsonVersion(rel) {
  const p = resolve(ROOT, rel);
  // Replace only the FIRST `"version": "..."` (the top-level package version).
  const updated = readFileSync(p, 'utf8').replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  writeFileSync(p, updated);
}

function setPyprojectVersion(rel) {
  const p = resolve(ROOT, rel);
  const updated = readFileSync(p, 'utf8').replace(/^(\s*version\s*=\s*["'])[^"']+(["'])/m, `$1${version}$2`);
  writeFileSync(p, updated);
}

setJsonVersion('package.json');
setJsonVersion('sdk/package.json');
setPyprojectVersion('sdk-python/pyproject.toml');

// Contract convergence gate: release-plan current_versions must match the
// manifests, so they advance in the same stroke (see lib/bump-release-plan.mjs).
const planPath = resolve(ROOT, 'contracts/sdk/release-plan.json');
writeFileSync(planPath, bumpReleasePlan(readFileSync(planPath, 'utf8'), version));

console.log(`Set DashClaw version to ${version} in:`);
console.log('  package.json, sdk/package.json, sdk-python/pyproject.toml');
console.log('  contracts/sdk/release-plan.json (current_versions + reason version refs)');
console.log('If SDK source changed this release, rewrite the release-plan reasons by hand.');
console.log('Next: `npm install` to sync package-lock.json, regen the platform guide');
console.log('(stale after any version bump), then commit — or run the whole recipe:');
console.log(`  npm run release:prep -- ${version}`);
