#!/usr/bin/env node
/**
 * check-doc-counts.mjs — reconcile hardcoded COUNTS and freshness DATE-STAMPS in
 * hand-authored docs against their single source of truth.
 *
 * WHY THIS EXISTS: `docs:check` validates only markdown links + the Next.js
 * version, and `version:check` only the unified version literal. The numbers that
 * actually rot every time a feature ships — route totals, SDK method counts, MCP
 * tool/resource counts, the pre-built guard-policy count — are duplicated across
 * README, PROJECT_DETAILS, the SDK READMEs, the reference narratives, and the
 * landing pages, and nothing reconciles them. They get fixed by hand, late. So
 * does the "last-verified" date on living docs. This is the missing gate.
 *
 *   Counts → ERROR on drift (exit 1 under --strict; wired into CI).
 *   Dates  → WARN only (heuristic: a freshness stamp older than the file's last
 *            commit means the doc changed but the stamp didn't advance).
 *
 * The date check deliberately never touches historical dates (CHANGELOG release
 * lines, "shipped on X", scratch files) — it only looks at the designated
 * freshness-stamp lines below.
 *
 * Usage:
 *   node scripts/check-doc-counts.mjs            # report only (always exit 0)
 *   node scripts/check-doc-counts.mjs --strict   # exit 1 if any count drifts (CI)
 *
 * Extending: add a row to COUNT_CHECKS (counts) or DATE_CHECKS (stamps). Each
 * count source of truth is computed once in sources() so docs cite a derived
 * number, never a remembered one. Surfaces intentionally NOT yet covered are
 * listed in UNCOVERED so this script never silently claims total coverage.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const countMatches = (rel, re) => (read(rel).match(re) || []).length;

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty'];
const toNum = (tok) => (/^\d+$/.test(tok) ? Number(tok) : WORDS.indexOf(tok.toLowerCase()));

/** Compute every count from its single source of truth, this run. */
function sources() {
  const inv = JSON.parse(read('docs/api-inventory.json'));
  const totals = inv.summary ?? inv.totals ?? inv; // generator nests these under `summary`
  const routes = {
    total: totals.total_routes,
    stable: totals.stable_routes,
    beta: totals.beta_routes,
    experimental: totals.experimental_routes,
  };

  let sdk = null;
  try {
    const out = execFileSync('node', ['scripts/count-sdk-methods.mjs'], { cwd: ROOT, encoding: 'utf8' });
    sdk = {
      node: Number(/Node[^:]*:\s*(\d+)/.exec(out)?.[1]),
      python: Number(/Python[^:]*:\s*(\d+)/.exec(out)?.[1]),
    };
    if (!sdk.node || !sdk.python) sdk = null;
  } catch {
    sdk = null; // surfaced as a warning below, SDK checks skipped this run
  }

  return {
    routes,
    sdk,
    mcpTools: countMatches('mcp-server/src/tools.ts', /^\s*name:\s*['"]dashclaw_/gm),
    mcpResources: countMatches('mcp-server/src/resources.ts', /^\s*uri:\s*['"]/gm),
    shields: countMatches('app/policies/lib/shields.js', /^\s*id:\s*['"]/gm),
  };
}

const S = sources();

// Each check: a regex with one capture group per number, compared positionally
// to `expected`. `word: true` means the captured token may be spelled out.
const COUNT_CHECKS = [
  { file: 'README.md', label: 'route inventory',
    re: /\*\*(\d+) routes\*\*: (\d+) stable, (\d+) beta, (\d+) experimental/,
    expected: [S.routes.total, S.routes.stable, S.routes.beta, S.routes.experimental] },
  { file: 'README.md', label: 'MCP tool count', re: /\*\*(\d+) governance MCP tools\*\*/, expected: [S.mcpTools] },
  { file: 'README.md', label: 'MCP resource count', re: /plus (\d+) read-only resources/, expected: [S.mcpResources] },
  { file: 'README.md', label: 'pre-built safety switches', word: true, re: /(\w+) pre-built safety switches/, expected: [S.shields] },
  S.sdk && { file: 'README.md', label: 'Node SDK methods', re: /(\d+)-method canonical Node surface/, expected: [S.sdk.node] },
  S.sdk && { file: 'README.md', label: 'Python SDK methods', re: /Python SDK exposes (\d+) methods/, expected: [S.sdk.python] },
  { file: 'PROJECT_DETAILS.md', label: 'route inventory',
    re: /\*\*(\d+) routes\*\*: \*\*(\d+) stable\*\*, \*\*(\d+) beta\*\*, \*\*(\d+) experimental\*\*/,
    expected: [S.routes.total, S.routes.stable, S.routes.beta, S.routes.experimental] },
  { file: 'public/downloads/dashclaw-platform-intelligence/references/api-surface.md', label: 'active route count',
    re: /\*\*(\d+) active routes\*\*/, expected: [S.routes.total] },
  // MCP tool count across the peripheral docs that silently drifted to 26/28 while
  // live was 29 (only the root README was gated before). Each checks the FIRST
  // occurrence as a tripwire — a stale tool count now fails the build, not a review.
  { file: 'mcp-server/README.md', label: 'MCP tool count (intro)', re: /Exposes (\d+) governance tools/, expected: [S.mcpTools] },
  { file: 'mcp-server/README.md', label: 'MCP tool count (section)', re: /^## Tools \((\d+)\)/m, expected: [S.mcpTools] },
  { file: 'app/docs/page.tsx', label: 'MCP tool count (intro)', re: /(\d+) governance tools across \d+ groups/, expected: [S.mcpTools] },
  { file: 'app/docs/page.tsx', label: 'MCP tool count (section)', re: /Tools \((\d+)\)<\/h3>/, expected: [S.mcpTools] },
  { file: 'examples/README.md', label: 'MCP tool count', re: /agent (\d+) governance tools/, expected: [S.mcpTools] },
  { file: 'examples/managed-agent-mcp/README.md', label: 'MCP tool count', re: /(\d+) tools \+ \d+ resources/, expected: [S.mcpTools] },
  { file: 'docs/monetization-plan.md', label: 'MCP tool count', re: /MCP server \((\d+) tools/, expected: [S.mcpTools] },
  // Surfaces caught stale at 29/224 by the 2026-06-10 preship drift audit —
  // gated so the next tool/method addition fails the build here, not review.
  { file: 'sdk/README.md', label: 'MCP tool count', re: /\*\*(\d+) tools\*\* in \d+ groups/, expected: [S.mcpTools] },
  { file: 'sdk-python/README.md', label: 'MCP tool count', re: /\*\*(\d+) tools\*\* across \d+ groups/, expected: [S.mcpTools] },
  S.sdk && { file: 'sdk-python/README.md', label: 'Python SDK methods (intro)', re: /full platform SDK \((\d+) methods\)/, expected: [S.sdk.python] },
  S.sdk && { file: 'sdk-python/README.md', label: 'Python SDK methods (parity)', re: /platform surface \((\d+) methods\)/, expected: [S.sdk.python] },
  { file: '.claude/CODEBASE_MAP.md', label: 'MCP tool count', re: /(\d+) governance tools \+ \d+ resources/, expected: [S.mcpTools] },
  { file: 'app/docs/page.tsx', label: 'MCP tool count (nav)', re: /label: 'Tools \((\d+)\)'/, expected: [S.mcpTools] },
  { file: 'app/downloads/page.tsx', label: 'MCP tool count', re: /(\d+) governance tools plus \d+ read-only resources/, expected: [S.mcpTools] },
  S.sdk && { file: 'app/downloads/page.tsx', label: 'Python SDK methods', re: /Broader Python surface \((\d+) methods\)/, expected: [S.sdk.python] },
  { file: 'docs/CLAUDE-DESKTOP-PLUGIN.md', label: 'MCP tool count', re: /\*\*(\d+) governance tools\*\*/, expected: [S.mcpTools] },
  { file: 'examples/managed-agent-mcp/main.py', label: 'MCP tool count', re: /gets (\d+) governance tools/, expected: [S.mcpTools] },
  { file: 'examples/managed-agent-mcp/README.md', label: 'MCP tool count (intro)', re: /(\d+) governance tools and \d+ resources/, expected: [S.mcpTools] },
  // Second drift ring (same audit): marketing/landing prose, the docs-page SDK
  // claim, and the platform-intelligence reference SOURCES (public/downloads is
  // the hand-authored source; plugins/.agents copies are kept lockstep).
  { file: 'app/landingData.js', label: 'MCP tool count', re: /(\d+) tools and \d+ resources/, expected: [S.mcpTools] },
  { file: 'app/page.tsx', label: 'MCP tool count', re: /(\d+) tools and \d+ resources/, expected: [S.mcpTools] },
  S.sdk && { file: 'app/downloads/page.tsx', label: 'Node SDK methods', re: /Canonical (\d+)-method surface/, expected: [S.sdk.node] },
  S.sdk && { file: 'app/docs/page.tsx', label: 'Node SDK methods', re: /(\d+) methods total/, expected: [S.sdk.node] },
  S.sdk && { file: 'sdk-python/README.md', label: 'Node SDK methods (parity)', re: /curated subset of \*\*(\d+) methods\*\*/, expected: [S.sdk.node] },
  { file: 'public/downloads/dashclaw-platform-intelligence/references/api-surface.md', label: 'MCP tool count', re: /\*\*(\d+) tools across \d+ groups\.\*\*/, expected: [S.mcpTools] },
  { file: 'public/downloads/dashclaw-platform-intelligence/references/platform-knowledge.md', label: 'MCP tool count', re: /\*\*(\d+) tools across \d+ groups:\*\*/, expected: [S.mcpTools] },
  S.sdk && { file: 'public/downloads/dashclaw-platform-intelligence/references/platform-knowledge.md', label: 'Node SDK methods', re: /`sdk\/dashclaw\.js`, (\d+) methods/, expected: [S.sdk.node] },
  S.sdk && { file: 'public/downloads/dashclaw-platform-intelligence/references/platform-knowledge.md', label: 'Python SDK methods', re: /`sdk-python\/dashclaw\/client\.py`, (\d+) methods/, expected: [S.sdk.python] },
].filter(Boolean);

// Freshness stamps: the date should be >= the file's last commit date. We never
// look at any other date in these files, so historical/CHANGELOG dates are safe.
const DATE_CHECKS = [
  { file: 'PROJECT_DETAILS.md', re: /last-verified:\s*(\d{4}-\d{2}-\d{2})/ },
  { file: 'docs/sdk-reference.md', re: /last-verified:\s*(\d{4}-\d{2}-\d{2})/ },
  { file: 'docs/sdk-parity.md', re: /last-verified:\s*(\d{4}-\d{2}-\d{2})/ },
  { file: 'public/downloads/dashclaw-platform-intelligence/references/api-surface.md', re: /\(verified (\d{4}-\d{2}-\d{2})/ },
];

// Honesty: surfaces a thorough sweep covers that this script does NOT yet gate.
const UNCOVERED = [
  'README.md / sdk READMEs / reference docs "N groups" (MCP groups have no machine-readable source in tools.js — verify by hand)',
  'README.md "N new sections" (governance-skill section count)',
  'platform-knowledge.md / sdk-parity.md route + signal-type counts',
  'plugins/ + .agents/ copies of the platform-intelligence references (source gated above; copies kept lockstep by livingcode refresh / manual parity)',
];

function lastCommitDate(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const errors = [];
const warnings = [];
const oks = [];

if (!S.sdk) warnings.push('count-sdk-methods.mjs did not return counts — SDK method checks skipped this run.');

for (const c of COUNT_CHECKS) {
  let text;
  try {
    text = read(c.file);
  } catch {
    warnings.push(`${c.file}: file not found — '${c.label}' not checked.`);
    continue;
  }
  const m = c.re.exec(text);
  if (!m) {
    warnings.push(`${c.file}: '${c.label}' pattern not found — doc may have been reworded; not asserted.`);
    continue;
  }
  const got = m.slice(1, c.expected.length + 1).map((t) => (c.word ? toNum(t) : Number(t)));
  const mismatch = got.some((g, i) => g !== c.expected[i]);
  if (mismatch) {
    errors.push(`${c.file}: ${c.label} says [${got.join(', ')}] but source-of-truth is [${c.expected.join(', ')}]`);
  } else {
    oks.push(`${c.file}: ${c.label} = [${c.expected.join(', ')}]`);
  }
}

for (const d of DATE_CHECKS) {
  let text;
  try {
    text = read(d.file);
  } catch {
    continue;
  }
  const m = d.re.exec(text);
  if (!m) continue;
  const stamp = m[1];
  const committed = lastCommitDate(d.file);
  if (committed && stamp < committed) {
    warnings.push(`${d.file}: freshness stamp ${stamp} predates the file's last commit ${committed} — advance it to today.`);
  } else {
    oks.push(`${d.file}: freshness stamp ${stamp} is current`);
  }
}

// ---- report ----
console.log('doc-counts: reconciling hardcoded counts + freshness dates against source-of-truth\n');
for (const o of oks) console.log(`  ok   ${o}`);
for (const w of warnings) console.log(`  warn ${w}`);
for (const e of errors) console.error(`  DRIFT ${e}`);

console.log(`\n  (not yet gated, sweep by hand: ${UNCOVERED.length} surfaces — see UNCOVERED in this script)`);

if (errors.length === 0) {
  console.log('\ndoc-counts: all gated counts match source-of-truth.');
  process.exit(0);
}

console.error(`\ndoc-counts: ${errors.length} count(s) drifted from source-of-truth.`);
if (STRICT) {
  console.error('Fix the doc strings above (or regenerate the source), then re-run.');
  process.exit(1);
}
console.error('(report-only run; pass --strict to fail the build, as CI does.)');
process.exit(0);
