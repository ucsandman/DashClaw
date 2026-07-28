#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_MATURITY_RULES,
  discoverApiRoutes,
} from './lib/api-route-inventory.mjs';

function getInventoryJsonPath(rootDir = process.cwd()) {
  return path.join(rootDir, 'docs', 'api-inventory.json');
}

function getInventoryMarkdownPath(rootDir = process.cwd()) {
  return path.join(rootDir, 'docs', 'api-inventory.md');
}

function countByMaturity(routes) {
  const counts = { stable: 0, beta: 0, experimental: 0 };
  for (const route of routes) {
    counts[route.maturity] = (counts[route.maturity] || 0) + 1;
  }
  return counts;
}

export async function generateApiInventory(rootDir = process.cwd()) {
  const routes = await discoverApiRoutes(rootDir);
  const counts = countByMaturity(routes);

  return {
    schema_version: 1,
    generated_from: 'app/api/**/route.js',
    maturity_rules: API_MATURITY_RULES,
    summary: {
      total_routes: routes.length,
      stable_routes: counts.stable,
      beta_routes: counts.beta,
      experimental_routes: counts.experimental,
    },
    routes,
  };
}

export function serializeApiInventoryJson(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

/**
 * LOCAL calendar date as YYYY-MM-DD (2026-07-27 pre-ship sweep: the prior
 * `new Date().toISOString().slice(0, 10)` stamped UTC, so a run in the
 * evening (local) after ~17:00-20:00 PT/PDT already rolled into tomorrow in
 * UTC — this file regenerated with `last-verified: 2026-07-28` in the same
 * commit as siblings hand-stamped `2026-07-27`. Every other freshness stamp
 * in this repo (PROJECT_DETAILS.md, docs/sdk-reference.md,
 * docs/sdk-parity.md — see check-doc-counts.mjs) is maintained by hand
 * against the author's own calendar date, which is implicitly local; this
 * mirrors that by reading the machine's local date instead of UTC.
 */
function localDateStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function serializeApiInventoryMarkdown(inventory) {
  const lines = [];
  // last-verified reflects the most recent regeneration date so the
  // auto-generated artifact doesn't carry a permanently stale stamp.
  // Override with process.env.API_INVENTORY_VERIFIED_DATE for deterministic
  // builds (e.g. snapshot tests).
  const verified = process.env.API_INVENTORY_VERIFIED_DATE
    || localDateStamp();
  lines.push('---');
  lines.push('source-of-truth: false');
  lines.push('owner: API Governance Lead');
  lines.push(`last-verified: ${verified}`);
  lines.push('doc-type: architecture');
  lines.push('---');
  lines.push('');
  lines.push('# API Inventory');
  lines.push('');
  lines.push('- Source: `app/api/**/route.js`');
  lines.push('- Artifact: `docs/api-inventory.json`');
  lines.push('- Maturity levels: `stable`, `beta`, `experimental`');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total routes: \`${inventory.summary.total_routes}\``);
  lines.push(`- Stable routes: \`${inventory.summary.stable_routes}\``);
  lines.push(`- Beta routes: \`${inventory.summary.beta_routes}\``);
  lines.push(`- Experimental routes: \`${inventory.summary.experimental_routes}\``);
  lines.push('');
  lines.push('## Routes');
  lines.push('');
  lines.push('| Path | Methods | Maturity | Rule Prefix | File |');
  lines.push('|---|---|---|---|---|');
  for (const route of inventory.routes) {
    lines.push(
      `| \`${route.path}\` | \`${route.methods.join(', ')}\` | \`${route.maturity}\` | \`${route.matched_prefix}\` | \`${route.file}\` |`
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export async function writeApiInventory(rootDir = process.cwd()) {
  const inventory = await generateApiInventory(rootDir);
  const jsonPath = getInventoryJsonPath(rootDir);
  const mdPath = getInventoryMarkdownPath(rootDir);
  await fs.writeFile(jsonPath, serializeApiInventoryJson(inventory), 'utf8');
  await fs.writeFile(mdPath, serializeApiInventoryMarkdown(inventory), 'utf8');
  return { jsonPath, mdPath };
}

async function main() {
  const rootDir = process.cwd();
  const { jsonPath, mdPath } = await writeApiInventory(rootDir);
  console.log(`API inventory written to ${path.relative(rootDir, jsonPath)}`);
  console.log(`API inventory written to ${path.relative(rootDir, mdPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`API inventory generation failed: ${err.message}`);
    process.exitCode = 1;
  });
}
