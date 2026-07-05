#!/usr/bin/env node
/**
 * check-version-hardcodes.mjs — guard against hardcoded version strings in
 * user-facing code. Canonical versions live in:
 *
 *   - package.json                                 (platform)
 *   - sdk/package.json                             (Node SDK)
 *   - sdk-python/pyproject.toml                    (Python SDK)
 *   - plugins/dashclaw/.claude-plugin/plugin.json  (plugin manifest)
 *
 * UI / SDK source files that need to display a version MUST derive from
 * those — via process.env.NEXT_PUBLIC_*_VERSION (see next.config.js) or by
 * importing the manifest JSON directly. Hardcoded `v?X.Y.Z` literals drift.
 *
 * What this script flags:
 *   Any version literal in scanned files whose value is NOT one of the four
 *   canonical versions, AND that doesn't end with the `+)` feature-
 *   availability marker (e.g. `(v2.13.3+)` meaning "available since 2.13.3").
 *
 * What it does NOT scan (intentionally):
 *   - .planning/, docs/architecture/, docs/superpowers/, *.md changelogs —
 *     historical / version-stamped documentation
 *   - test fixtures using mock version strings (out of scan paths)
 *   - lock files, snapshots, generated/ outputs
 *
 * Exit 1 on drift; 0 if clean.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

function readPackageVersion(relPath) {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf8')).version;
}

function readPyprojectVersion(relPath) {
  const m = readFileSync(join(REPO_ROOT, relPath), 'utf8').match(/^version\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error(`could not parse version from ${relPath}`);
  return m[1];
}

const CANONICAL = new Set([
  readPackageVersion('package.json'),
  readPackageVersion('sdk/package.json'),
  readPyprojectVersion('sdk-python/pyproject.toml'),
  readPackageVersion('plugins/dashclaw/.claude-plugin/plugin.json'),
  readPackageVersion('mcp-server/package.json'),
]);

const SCAN_DIRS = ['app', 'sdk-python/dashclaw'];
const SCAN_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py']);
const SCAN_INDIVIDUAL_FILES = ['sdk/dashclaw.js'];

// Files that are documented to legitimately contain non-canonical version
// literals — SDK code examples and demo fixtures that show what an agent's
// `declared_goal` or `output_summary` looks like in the wild. The version
// in these strings is example-content for the user's eyes, not a claim
// about DashClaw's own version. Adding new entries here is a deliberate
// choice — keep the list short.
const FILE_ALLOWLIST = new Set([
  'app/docs/page.js',                              // SDK code examples
  'app/lib/demo/fixtures/journey-agents.js',       // Demo agent fixtures
  'app/lib/demo/fixtures/persona-agents.js',       // Demo agent fixtures
  'app/lib/demo/fixtures/tutorial-assumptions.js', // Demo agent fixtures
]);

// Require EITHER a `v` prefix OR surrounding quote/backtick to avoid matching
// IP addresses (127.0.0.1) and SVG path coordinates (1.43.35). Two alternations
// so the captured group is always group 1 or group 2.
const VERSION_RE = /["'`](\d{1,3}\.\d{1,3}\.\d{1,3})["'`]|\bv(\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;

function isFeatureMarker(line, matchIndex, matchLength) {
  const trailing = line.slice(matchIndex + matchLength, matchIndex + matchLength + 2);
  return trailing.startsWith('+');
}

function isExplicitlyAllowed(line) {
  return /\bversion-hardcode-allowed\b/.test(line);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__pycache__' || entry === '.next') continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

const findings = [];

function scanFile(absPath) {
  const ext = absPath.slice(absPath.lastIndexOf('.'));
  if (!SCAN_EXTS.has(ext)) return;
  const rel = relative(REPO_ROOT, absPath).split(sep).join('/');
  if (FILE_ALLOWLIST.has(rel)) return;
  const text = readFileSync(absPath, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    let m;
    VERSION_RE.lastIndex = 0;
    while ((m = VERSION_RE.exec(line)) !== null) {
      const ver = m[1] || m[2];
      if (CANONICAL.has(ver)) continue;
      if (isFeatureMarker(line, m.index, m[0].length)) continue;
      if (isExplicitlyAllowed(line)) continue;
      findings.push({ file: rel, line: i + 1, version: ver, snippet: line.trim().slice(0, 120) });
    }
  });
}

for (const dir of SCAN_DIRS) {
  for (const f of walk(join(REPO_ROOT, dir))) scanFile(f);
}
for (const f of SCAN_INDIVIDUAL_FILES) {
  scanFile(join(REPO_ROOT, f));
}

if (findings.length === 0) {
  console.log(`OK no hardcoded version drift found (canonical: ${[...CANONICAL].join(', ')})`);
  process.exit(0);
}

console.error(`FAIL found ${findings.length} hardcoded version literal(s) outside canonical set ${[...CANONICAL].join(', ')}:`);
console.error('');
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  v${f.version}`);
  console.error(`    ${f.snippet}`);
}
console.error('');
console.error('Fix options:');
console.error('  1. Replace with process.env.NEXT_PUBLIC_*_VERSION (see next.config.js).');
console.error('  2. Import the manifest JSON directly and template the version.');
console.error('  3. If intentional (test fixture, feature-availability marker like');
console.error('     "(v2.13.3+)", or historical reference), append "// version-hardcode-allowed"');
console.error('     to the same line.');
process.exit(1);
