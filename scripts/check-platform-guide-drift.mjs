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
const pkg = read('package.json');

// Stale-surface gate: the captured /api/health example carries the version of the
// instance the liveExamples were recorded against. When that falls a major.minor
// behind package.json, the guide is showing responses from an old platform —
// exactly the drift that let 4.67.0 captures survive into 5.8.x. Patch drift is
// tolerated so routine ships don't force a re-capture.
const healthExample = (guide.liveExamples?.http ?? []).find((e) => e.id === 'health');
const capturedVersion = healthExample?.response?.match(/"version":\s*"(\d+\.\d+\.\d+)"/)?.[1];
const minor = (v) => v?.split('.').slice(0, 2).join('.');
if (!capturedVersion) {
  console.error('platform-guide liveExamples have no health capture with a version — regenerate: node scripts/regen-platform-guide-examples.mjs');
  process.exit(1);
}
if (minor(capturedVersion) !== minor(pkg.version)) {
  console.error(
    `platform-guide liveExamples are stale: captured against v${capturedVersion} but the platform is v${pkg.version}. ` +
      'Regenerate: node scripts/regen-platform-guide-examples.mjs (needs a local instance on :3001).'
  );
  process.exit(1);
}

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

// meta.counts renders on the guide's hero ("N entries: …") — it must equal a
// live tally of the dataset's own items. Regenerations that add items without
// recomputing the summary drifted this to 417 while the items said 421.
const tally = { total: 0, stable: 0, beta: 0, experimental: 0, archived: 0, deprecated: 0 };
for (const area of guide.areas) {
  for (const item of area.items) {
    if (item.status in tally) tally[item.status] += 1;
    tally.total += 1;
  }
}
const counts = guide.meta?.counts ?? {};
const countDrift = Object.entries(tally).filter(([k, v]) => Number(counts[k] ?? 0) !== v);

if (missing.length || stale.length || countDrift.length) {
  for (const [k, v] of countDrift) {
    console.error(`meta.counts.${k} says ${counts[k] ?? 0} but the dataset's items tally to ${v} — recompute meta.counts in the regen.`);
  }
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
