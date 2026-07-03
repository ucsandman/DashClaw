#!/usr/bin/env node
/**
 * check-version-sync.mjs — enforce ONE DashClaw version.
 *
 * As of 4.0.0 the platform and both SDKs share a single version. These three
 * manifests must always agree:
 *   package.json              (platform / Next.js app)
 *   sdk/package.json          (npm SDK)
 *   sdk-python/pyproject.toml (PyPI SDK)
 *
 * Bump all three together with `npm run version:set <x.y.z>`. CI and the
 * pre-commit hook run this guard, so drift fails the build.
 *
 * (The `dashclaw` plugin bundle and CLI keep their own manifest versions and
 * are intentionally NOT synced to the platform version. But the plugin's THREE
 * ecosystem manifests — Claude Code, Codex, Hermes — describe one plugin source
 * and must agree with EACH OTHER; they drifted 2.15.0/2.14.2/2.14.1 before this
 * second group was added (v2.7). The desktop build reads the Claude manifest.)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function jsonVersion(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')).version;
}

function pyprojectVersion(rel) {
  const m = readFileSync(resolve(ROOT, rel), 'utf8').match(/^\s*version\s*=\s*["']([^"']+)["']/m);
  return m ? m[1] : null;
}

function yamlVersion(rel) {
  const m = readFileSync(resolve(ROOT, rel), 'utf8').match(/^version:\s*["']?([^"'\s]+)["']?/m);
  return m ? m[1] : null;
}

const groups = [
  {
    label: 'platform + SDK',
    fix: 'Bump them together with `npm run version:set <x.y.z>`.',
    versions: {
      'package.json': jsonVersion('package.json'),
      'sdk/package.json': jsonVersion('sdk/package.json'),
      'sdk-python/pyproject.toml': pyprojectVersion('sdk-python/pyproject.toml'),
    },
  },
  {
    label: 'plugin manifests (Claude Code / Codex / Hermes)',
    fix: 'One plugin source, one version — edit all three manifests together.',
    versions: {
      'plugins/dashclaw/.claude-plugin/plugin.json': jsonVersion('plugins/dashclaw/.claude-plugin/plugin.json'),
      'plugins/dashclaw/.codex-plugin/plugin.json': jsonVersion('plugins/dashclaw/.codex-plugin/plugin.json'),
      'plugins/dashclaw/.hermes-plugin/plugin.yaml': yamlVersion('plugins/dashclaw/.hermes-plugin/plugin.yaml'),
    },
  },
];

let failed = false;
for (const group of groups) {
  const unique = [...new Set(Object.values(group.versions))];
  if (unique.length === 1 && unique[0]) {
    console.log(`OK ${group.label} versions are in sync: ${unique[0]}`);
    continue;
  }
  failed = true;
  console.error(`FAIL ${group.label} versions are out of sync:`);
  for (const [file, v] of Object.entries(group.versions)) console.error(`  ${file}: ${v ?? '(unparseable)'}`);
  console.error(`${group.fix}\n`);
}
process.exit(failed ? 1 : 0);
