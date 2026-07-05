#!/usr/bin/env node
/**
 * Sync helper for cli/lib/code/vendored.js. Compares the vendored copy of
 * merge.ts + bundle.ts#absolutize against the canonical sources under
 * app/lib/claude-code/optimal-files/. Prints a per-symbol drift report and
 * exits non-zero when the canonical sources have changed in ways that the
 * vendored copy doesn't reflect.
 *
 * This script intentionally does NOT auto-edit cli/lib/code/vendored.js —
 * the file is hand-curated with renames and an extra path-traversal guard
 * pulled in from bundle.js. After every change to the canonical sources,
 * an operator should run this script, eyeball the diff, and update the
 * vendored copy by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const VENDORED = path.join(REPO_ROOT, 'cli', 'lib', 'code', 'vendored.js');
// Each canonical source declares which of its top-level functions the
// vendored copy is expected to expose. Symbols listed in `expect` must be
// present in vendored.js; everything else (the rest of bundle.js, in
// particular) stays server-side.
const CANONICAL = [
  {
    file: path.join(REPO_ROOT, 'app', 'lib', 'claude-code', 'optimal-files', 'merge.ts'),
    expect: ['parseMarkdownSections', 'normalizeHeading', 'previewMerge', 'applyMerge'],
  },
  {
    file: path.join(REPO_ROOT, 'app', 'lib', 'claude-code', 'optimal-files', 'bundle.ts'),
    // `absolutize` is renamed `_ensureInsideProject` in the vendored copy
    // because the CLI uses it as a path-traversal guard rather than a path
    // builder. Map the rename here.
    expect: [{ canonical: 'absolutize', vendored: '_ensureInsideProject' }],
  },
];

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch { return null; }
}

function extractTopLevelFunctions(src) {
  if (!src) return new Map();
  const found = new Map();
  const re = /(?:export\s+)?function\s+([A-Za-z_$][\w$]*)/g;
  for (const match of src.matchAll(re)) {
    const name = match[1];
    if (!name) continue;
    if (!found.has(name)) found.set(name, true);
  }
  return found;
}

const vendoredSrc = read(VENDORED);
if (!vendoredSrc) {
  console.error('vendored.js not found:', VENDORED);
  process.exit(2);
}
const vendoredFns = extractTopLevelFunctions(vendoredSrc);

const drift = [];
for (const { file, expect } of CANONICAL) {
  const text = read(file);
  if (!text) {
    drift.push({ kind: 'missing_canonical', file });
    continue;
  }
  const canonicalFns = extractTopLevelFunctions(text);
  for (const item of expect) {
    const canonicalName = typeof item === 'string' ? item : item.canonical;
    const vendoredName = typeof item === 'string' ? item : item.vendored;
    if (!canonicalFns.has(canonicalName)) {
      drift.push({
        kind: 'missing_in_canonical',
        name: canonicalName,
        source: path.relative(REPO_ROOT, file),
      });
    }
    if (!vendoredFns.has(vendoredName)) {
      drift.push({
        kind: 'missing_in_vendored',
        name: vendoredName,
        source: path.relative(REPO_ROOT, file),
      });
    }
  }
}

if (!drift.length) {
  console.log('OK — vendored.js exposes every top-level function present in the canonical sources.');
  process.exit(0);
}

console.log('Vendored copy is missing helpers that exist in the canonical sources:');
for (const d of drift) {
  if (d.kind === 'missing_canonical') {
    console.log('  ' + d.kind + ': ' + d.file);
  } else {
    console.log('  ' + d.name + '  (in ' + d.source + ')');
  }
}
console.log('\nUpdate cli/lib/code/vendored.js by hand, then re-run this script.');
process.exit(1);
