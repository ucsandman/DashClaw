#!/usr/bin/env node
/**
 * check-surface-budget.mjs — the anti-regrowth brake (THESIS.md, section
 * "The anti-regrowth brake").
 *
 * WHY THIS EXISTS: the 2026-03 purge (178→5 SDK methods, 142 routes archived)
 * regrew to full sprawl within four months because the "Governance Boundary CI
 * check" it promised never shipped. This is that check. It counts every
 * governed surface and fails the build when any exceeds its v5.0.0 ceiling, so
 * regrowth becomes a deliberate, recorded act instead of a silent drift.
 *
 * Ceilings live in contracts/surface-budget.json, each set to the EXACT live
 * count at v5.0.0. Raising a ceiling requires amending THESIS.md (anti-regrowth
 * section) AND contracts/surface-budget.json in the same commit with a written
 * reason — the failure message below repeats that rule.
 *
 * Every counter derives its number from a single source of truth this run, so
 * the budget can never be satisfied by a stale count. A surface that cannot be
 * counted is a surface that cannot be governed, so a missing count fails loudly
 * rather than being skipped.
 *
 * Usage:
 *   node scripts/check-surface-budget.mjs   # print counts vs ceilings; exit 1 on any exceed
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const countMatches = (rel, re) => (read(rel).match(re) || []).length;

/** Recursively count files under `rel` whose basename matches `re`. */
export function countFiles(rel, re) {
  let n = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (re.test(entry.name)) n++;
    }
  };
  walk(resolve(ROOT, rel));
  return n;
}

const HTTP_METHOD_EXPORT_RE = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/;

/**
 * A route.* file with zero exported HTTP methods is not a route (e.g.
 * app/api/auth/[...nextauth]/route.ts, which re-exports a NextAuth handler
 * under a different shape) -- mirrors discoverApiRoutes()'s rule in
 * scripts/lib/api-route-inventory.mjs, the canonical source
 * docs/api-inventory.json is generated from. Fixed 2026-07-27 pre-ship sweep:
 * this counter used to raw-glob route.* files (124), one more than the
 * canonical inventory's 123, because it counted that file anyway -- the two
 * sources of truth must use the identical "exports a method" rule or they
 * drift by exactly this kind of file.
 */
function routeFileExportsHttpMethod(fullPath) {
  return HTTP_METHOD_EXPORT_RE.test(readFileSync(fullPath, 'utf8'));
}

export function countApiRoutes() {
  let n = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^route\.(js|ts|tsx)$/.test(entry.name) && routeFileExportsHttpMethod(full)) n++;
    }
  };
  walk(resolve(ROOT, 'app/api'));
  return n;
}
export const countAppPages = () => countFiles('app', /^page\.(js|jsx|ts|tsx)$/);
export const countMcpTools = () => countMatches('mcp-server/src/tools.ts', /^\s*name:\s*['"]dashclaw_/gm);
export const countMcpResources = () => countMatches('mcp-server/src/resources.ts', /^\s*uri:\s*['"]/gm);

/** Node + Python public SDK method counts, via the canonical counter. */
export function countSdkMethods() {
  const out = execFileSync('node', ['scripts/count-sdk-methods.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const node = Number(/Node[^:]*:\s*(\d+)/.exec(out)?.[1]);
  const python = Number(/Python[^:]*:\s*(\d+)/.exec(out)?.[1]);
  if (!node || !python) throw new Error('count-sdk-methods.mjs did not return both SDK counts');
  return { node, python };
}

/** CLI commands = COMMAND_HANDLERS keys, excluding flag aliases (--help, -h, …). */
export function countCliCommands() {
  const block = /const COMMAND_HANDLERS\s*=\s*\{([\s\S]*?)\n\};/.exec(read('cli/bin/dashclaw.js'));
  if (!block) throw new Error('COMMAND_HANDLERS block not found in cli/bin/dashclaw.js');
  const keys = new Set();
  const re = /^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:/gm;
  let m;
  while ((m = re.exec(block[1]))) {
    const key = m[1] ?? m[2] ?? m[3];
    if (!key.startsWith('-')) keys.add(key); // drop --help / -h / --version / -v aliases
  }
  return keys.size;
}

/** Guard policy types = KNOWN_POLICY_TYPES = the top-level keys of POLICY_EVALUATORS. */
export function countGuardPolicyTypes() {
  const block = /const POLICY_EVALUATORS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(read('app/lib/guard/policy.ts'));
  if (!block) throw new Error('POLICY_EVALUATORS block not found in app/lib/guard/policy.ts');
  return (block[1].match(/^ {2}([A-Za-z_]\w*):/gm) || []).length;
}

/** Compute every live governed-surface count from its source of truth. */
export function liveCounts() {
  const sdk = countSdkMethods();
  return {
    apiRoutes: countApiRoutes(),
    appPages: countAppPages(),
    mcpTools: countMcpTools(),
    mcpResources: countMcpResources(),
    sdkNodeMethods: sdk.node,
    sdkPythonMethods: sdk.python,
    cliCommands: countCliCommands(),
    guardPolicyTypes: countGuardPolicyTypes(),
  };
}

export function loadCeilings() {
  return JSON.parse(read('contracts/surface-budget.json'));
}

/**
 * Pure comparison, testable with fixtures. A surface is a violation when its
 * live count EXCEEDS its ceiling (deletions — count under the ceiling — are
 * always fine), or when a declared ceiling has no matching live count.
 *
 * @param {Record<string, number>} counts   live surface counts
 * @param {{ceilings?: object}|object} budget  parsed surface-budget.json, or a
 *   flat { surface: ceiling } / { surface: { ceiling } } map
 */
export function evaluateBudget(counts, budget) {
  const ceilings = budget.ceilings ?? budget;
  const rows = [];
  for (const [surface, spec] of Object.entries(ceilings)) {
    const ceiling = typeof spec === 'number' ? spec : spec.ceiling;
    const source = typeof spec === 'number' ? '' : (spec.source ?? '');
    const count = counts[surface];
    if (count == null) {
      rows.push({ surface, count: null, ceiling, source, status: 'uncounted' });
      continue;
    }
    const status = count > ceiling ? 'exceed' : count < ceiling ? 'under' : 'at';
    rows.push({ surface, count, ceiling, source, status });
  }
  const violations = rows.filter((r) => r.status === 'exceed' || r.status === 'uncounted');
  return { ok: violations.length === 0, rows, violations };
}

function main() {
  const budget = loadCeilings();
  const counts = liveCounts();
  const { ok, rows, violations } = evaluateBudget(counts, budget);

  console.log('surface-budget: live governed surfaces vs v5.0.0 ceilings\n');
  for (const r of rows) {
    const mark = r.status === 'exceed' ? 'OVER ' : r.status === 'uncounted' ? 'MISS ' : r.status === 'under' ? 'under' : 'ok   ';
    console.log(`  ${mark} ${r.surface.padEnd(18)} ${String(r.count).padStart(4)} / ${r.ceiling}${r.source ? `   (${r.source})` : ''}`);
  }

  if (ok) {
    console.log('\nsurface-budget: every governed surface is within its ceiling.');
    process.exit(0);
  }

  console.error('\nSURFACE BUDGET EXCEEDED\n');
  for (const v of violations) {
    if (v.status === 'uncounted') {
      console.error(`  ${v.surface}: ceiling ${v.ceiling} declared but no live count could be computed (source: ${v.source || 'unknown'}).`);
    } else {
      console.error(`  ${v.surface}: ${v.count} live > ceiling ${v.ceiling}   (source: ${v.source})`);
    }
  }
  console.error(
    '\nThe anti-regrowth brake (THESIS.md, "The anti-regrowth brake") caps each\n' +
    'governed surface at its v5.0.0 count. You have added surface area.\n\n' +
    'Raising a ceiling requires amending THESIS.md (anti-regrowth section) +\n' +
    'contracts/surface-budget.json in the same commit with a written reason.\n\n' +
    'Sprawl is a deliberate, recorded act, not a drift.',
  );
  process.exit(1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
