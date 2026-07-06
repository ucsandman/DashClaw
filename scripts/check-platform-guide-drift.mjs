#!/usr/bin/env node
/**
 * check-platform-guide-drift.mjs — keeps the Complete Platform Guide honest.
 *
 * The guide's dataset (public/guides/platform-guide-data.json) is a generated
 * snapshot: nine inventory passes over the source merged with live-captured
 * examples. Routes come from the same ground truth CI already gates
 * (docs/api-inventory.json), so this check fails the build when the API
 * surface changes without the guide being regenerated — the guide can claim
 * 100% coverage only while this passes.
 *
 * Compares the route+method set only (the machine-checkable slice). SDK/CLI/
 * MCP entries drift with their own release gates (contracts:check,
 * check-doc-counts) and get refreshed in the same regeneration pass.
 *
 * Usage: node scripts/check-platform-guide-drift.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const inventory = read('docs/api-inventory.json');
const guide = read('public/guides/platform-guide-data.json');

// Ground truth: every route+method pair from the generated API inventory.
const expected = new Set();
for (const route of inventory.routes) {
  for (const method of route.methods) expected.add(`${method} ${route.path}`);
}

// Guide: every api-kind item, normalized back to "METHOD /path" pairs.
// Archived entries were inventoried as "GET/POST /path" (combined) — split them.
const documented = new Set();
for (const area of guide.areas) {
  if (area.kind !== 'api') continue;
  for (const item of area.items) {
    const [methodPart, ...rest] = item.name.split(' ');
    const path = rest.join(' ');
    for (const method of methodPart.split('/')) documented.add(`${method} ${path}`);
  }
}

const missing = [...expected].filter((k) => !documented.has(k)).sort();
const stale = [...documented].filter((k) => !expected.has(k)).sort();

if (missing.length || stale.length) {
  console.error('Platform guide has drifted from docs/api-inventory.json:');
  for (const k of missing) console.error(`  MISSING from guide: ${k}`);
  for (const k of stale) console.error(`  STALE in guide (route no longer exists): ${k}`);
  console.error(
    `\n${missing.length} missing, ${stale.length} stale. Regenerate the guide dataset ` +
      '(see docs/platform-guide-coverage.json for provenance) or update it to match the inventory.'
  );
  process.exit(1);
}

console.log(`platform-guide drift check passed: ${expected.size} route+method pairs all documented.`);
