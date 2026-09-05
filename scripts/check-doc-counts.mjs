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
 *   Counts → ERROR on drift (exit 1 under --strict; wired into CI), or DERIVED
 *            in place under --write.
 *   Dates  → WARN only (heuristic: a freshness stamp older than the file's last
 *            commit means the doc changed but the stamp didn't advance).
 *
 * The date check deliberately never touches historical dates (CHANGELOG release
 * lines, "shipped on X", scratch files) — it only looks at the designated
 * freshness-stamp lines below.
 *
 * WHY --write EXISTS: detecting drift still left a human retyping ~40 numbers
 * across 20 files, late, after CI rejected the push. --write closes that loop —
 * the numbers are derived from source, so there is nothing left to hand-maintain
 * and nothing for the gate to catch. The gate stays as the CI backstop.
 *
 * Deliberately NOT auto-written:
 *   • MCP tool ENUMERATIONS (membership lists + group taxonomy). Rewriting a
 *     bulleted group list is prose surgery, not a number swap — the taxonomy is
 *     editorial, so drift there stays a human decision.
 *   • Freshness DATE stamps. Auto-advancing `last-verified` would assert a human
 *     verified something they did not. Those stay warn-only, on purpose.
 *
 * Usage:
 *   node scripts/check-doc-counts.mjs            # report only (always exit 0)
 *   node scripts/check-doc-counts.mjs --strict   # exit 1 if any count drifts (CI)
 *   node scripts/check-doc-counts.mjs --write    # derive drifted counts in place
 *   node scripts/check-doc-counts.mjs --write --staged-only
 *                                                # pre-commit: rewrite + re-stage
 *                                                # ONLY files already in the commit
 *
 * Extending: add a row to COUNT_CHECKS (counts) or DATE_CHECKS (stamps). Each
 * count source of truth is computed once in sources() so docs cite a derived
 * number, never a remembered one. Surfaces intentionally NOT yet covered are
 * listed in UNCOVERED so this script never silently claims total coverage.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
// --write turns this from a gate into a generator: every drifted count is
// rewritten from its source of truth instead of reported for a human to retype.
const WRITE = process.argv.includes('--write');
// Pre-commit mode. Only rewrite files ALREADY staged for this commit, and
// re-stage exactly those. Without it, fixing a stale count in README.md would
// sweep the developer's unrelated unstaged edits to README.md into the commit.
const STAGED_ONLY = process.argv.includes('--staged-only');

const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const countMatches = (rel, re) => (read(rel).match(re) || []).length;

// Working copy of every doc a count check touches. Several checks target the
// same file (README.md carries eight), so each rewrite must land on the text
// the previous rewrite produced, never a stale re-read from disk.
const texts = new Map();
const getText = (rel) => {
  if (!texts.has(rel)) texts.set(rel, read(rel));
  return texts.get(rel);
};
const changedFiles = new Set();

const STAGED = STAGED_ONLY ? stagedFileSet() : null;
function stagedFileSet() {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set(); // not a repo / no index — --staged-only then writes nothing
  }
}

/** The same pattern with `d`, so exec() reports per-capture-group offsets. */
const withIndices = (re) => (re.flags.includes('d') ? re : new RegExp(re.source, `${re.flags}d`));

/**
 * Replace each drifted capture group with its source-of-truth value and leave
 * every other byte of the match alone. Groups are spliced last-to-first so the
 * earlier offsets stay valid as the string length changes.
 *
 * A word-spelled count stays word-spelled ("seven" -> "eight"), so --write
 * never rewrites a doc's prose style; anything past the WORDS table falls back
 * to digits.
 */
function rewriteGroups(text, m, expected, wordForm) {
  let out = text;
  for (let i = expected.length; i >= 1; i--) {
    const span = m.indices?.[i];
    if (!span) continue;
    const [start, end] = span;
    const original = text.slice(start, end);
    const want = expected[i - 1];
    const replacement = wordForm && !/^\d+$/.test(original) && want < WORDS.length
      ? WORDS[want]
      : String(want);
    if (original === replacement) continue;
    out = `${out.slice(0, start)}${replacement}${out.slice(end)}`;
  }
  return out;
}

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

  // Count policy types from the single source of truth: the POLICY_TYPES array
  // in validate.js. Extract the array literal and count quoted identifiers.
  const validateSrc = read('app/lib/validate.js');
  const ptMatch = /const POLICY_TYPES\s*=\s*\[([^\]]+)\]/.exec(validateSrc);
  const policyTypes = ptMatch ? (ptMatch[1].match(/'[^']+'/g) || []).length : 0;

  // Exact tool-name set (not just the count) so README tool enumerations can
  // be gated for membership drift, not only arithmetic.
  const mcpToolNames = new Set(
    [...read('mcp-server/src/tools.ts').matchAll(/^\s*name:\s*['"](dashclaw_\w+)['"]/gm)].map((m) => m[1]),
  );

  return {
    routes,
    sdk,
    mcpToolNames,
    mcpTools: countMatches('mcp-server/src/tools.ts', /^\s*name:\s*['"]dashclaw_/gm),
    mcpResources: countMatches('mcp-server/src/resources.ts', /^\s*uri:\s*['"]/gm),
    shields: countMatches('app/policies/lib/shields.js', /^\s*id:\s*['"]/gm),
    policyTypes,
  };
}

const S = sources();

// Each check: a regex with one capture group per number, compared positionally
// to `expected`. `word: true` means the captured token may be spelled out.
const COUNT_CHECKS = [
  { file: 'README.md', label: 'route inventory',
    re: /\*\*(\d+) routes\*\*: (\d+) stable, (\d+) beta, (\d+) experimental/,
    expected: [S.routes.total, S.routes.stable, S.routes.beta, S.routes.experimental] },
  // V10: the "Project status" section restates the stable/beta/experimental
  // split in unbolded prose (no **N routes** header) — that form drifted
  // silently (67 written as 62) because only the bolded form above was gated.
  { file: 'README.md', label: 'route inventory (unbolded prose)',
    re: /(\d+) stable routes pinned in the \[OpenAPI contract\]\([^)]+\), (\d+) beta, (\d+) experimental/,
    expected: [S.routes.stable, S.routes.beta, S.routes.experimental] },
  { file: 'README.md', label: 'MCP tool count', re: /\*\*(\d+) governance MCP tools\*\*/, expected: [S.mcpTools] },
  { file: 'docs/README.md', label: 'route inventory (docs hub)',
    re: /\*\*(\d+) routes\*\*: (\d+) stable, (\d+) beta, (\d+) experimental/,
    expected: [S.routes.total, S.routes.stable, S.routes.beta, S.routes.experimental] },
  { file: 'docs/README.md', label: 'MCP tool count (docs hub)', re: /\*\*(\d+) governance MCP tools\*\*/, expected: [S.mcpTools] },
  { file: 'docs/integrations/mcp.md', label: 'MCP tool count (integration guide)', re: /\*\*(\d+) governance tools\*\*/, expected: [S.mcpTools] },
  { file: 'README.md', label: 'MCP resource count', re: /plus (\d+) read-only resources/, expected: [S.mcpResources] },
  { file: 'README.md', label: 'pre-built safety switches', word: true, re: /(\w+) pre-built safety switches/, expected: [S.shields] },
  { file: 'docs/policy-modes.md', label: 'live policy_type count',
    re: /the (\d+) live `policy_type` values/, expected: [S.policyTypes] },
  S.sdk && { file: 'README.md', label: 'Node SDK methods', re: /(\d+)-method canonical Node surface/, expected: [S.sdk.node] },
  S.sdk && { file: 'README.md', label: 'Python SDK methods', re: /Python SDK exposes (\d+) methods/, expected: [S.sdk.python] },
  { file: 'PROJECT_DETAILS.md', label: 'route inventory',
    re: /\*\*(\d+) routes\*\*: \*\*(\d+) stable\*\*, \*\*(\d+) beta\*\*, \*\*(\d+) experimental\*\*/,
    expected: [S.routes.total, S.routes.stable, S.routes.beta, S.routes.experimental] },
  // MCP tool count across the peripheral docs that silently drifted to 26/28 while
  // live was 29 (only the root README was gated before). Each checks the FIRST
  // occurrence as a tripwire — a stale tool count now fails the build, not a review.
  { file: 'mcp-server/README.md', label: 'MCP tool count (intro)', re: /Exposes (\d+) governance tools/, expected: [S.mcpTools] },
  { file: 'mcp-server/README.md', label: 'MCP tool count (section)', re: /^## Tools \((\d+) governance \+ \d+ stdio support\)/m, expected: [S.mcpTools] },
  { file: 'app/docs/page.tsx', label: 'MCP tool count (intro)', re: /(\d+) governance tools across \d+ groups/, expected: [S.mcpTools] },
  { file: 'app/docs/page.tsx', label: 'MCP tool count (section)', re: /Tools \((\d+)\)<\/h3>/, expected: [S.mcpTools] },
  { file: 'examples/README.md', label: 'MCP tool count', re: /agent (\d+) governance tools/, expected: [S.mcpTools] },
  { file: 'examples/managed-agent-mcp/README.md', label: 'MCP tool count', re: /(\d+) tools \+ \d+ resources/, expected: [S.mcpTools] },
  { file: 'docs/monetization-plan.md', label: 'MCP tool count', re: /MCP server \((\d+) tools/, expected: [S.mcpTools] },
  { file: 'docs/monetization-plan.md', label: 'policy type count',
    re: /all (\d+) policy types/, expected: [S.policyTypes] },
  // Surfaces caught stale at 29/224 by the 2026-06-10 preship drift audit —
  // gated so the next tool/method addition fails the build here, not review.
  { file: 'sdk/README.md', label: 'MCP tool count', re: /\*\*(\d+) tools\*\* in \d+ groups/, expected: [S.mcpTools] },
  { file: 'sdk-python/README.md', label: 'MCP tool count', re: /\*\*(\d+) tools\*\* across \d+ groups/, expected: [S.mcpTools] },
  S.sdk && { file: 'sdk-python/README.md', label: 'Python SDK methods (intro)', re: /governance-core surface \((\d+) methods\)/, expected: [S.sdk.python] },
  S.sdk && { file: 'sdk-python/README.md', label: 'Python SDK methods (parity)', re: /governance surface \((\d+) methods\)/, expected: [S.sdk.python] },
  // `optional`: this map is generated by the codebase-map skill and is gitignored
  // (.gitignore `.claude/*`), so it exists on a maintainer's machine and never in
  // CI. Its absence is the expected state there, not a guard that died — the only
  // check here for which that is true. Every other file below is tracked, so a
  // missing one means a doc was deleted out from under its check.
  { file: '.claude/CODEBASE_MAP.md', label: 'MCP tool count', re: /(\d+) governance tools \+ \d+ resources/, expected: [S.mcpTools], optional: true },
  { file: 'app/docs/page.tsx', label: 'MCP tool count (nav)', re: /label: 'Tools \((\d+)\)'/, expected: [S.mcpTools] },
  { file: 'app/downloads/page.tsx', label: 'MCP tool count', re: /(\d+) governance tools plus \d+ read-only resources/, expected: [S.mcpTools] },
  S.sdk && { file: 'app/downloads/page.tsx', label: 'Python SDK methods', re: /Broader Python surface \((\d+) methods\)/, expected: [S.sdk.python] },
  { file: 'docs/CLAUDE-DESKTOP-PLUGIN.md', label: 'MCP tool count', re: /\*\*(\d+) governance tools\*\*/, expected: [S.mcpTools] },
  { file: 'examples/managed-agent-mcp/main.py', label: 'MCP tool count', re: /gets (\d+) governance tools/, expected: [S.mcpTools] },
  { file: 'examples/managed-agent-mcp/README.md', label: 'MCP tool count (intro)', re: /(\d+) governance tools and \d+ resources/, expected: [S.mcpTools] },
  // Second drift ring (same audit): marketing/landing prose and the docs-page
  // SDK claim.
  // landingData's dead feature arrays (incl. the "governance tools and N resources"
  // prose) were removed in v2.6d — only the rendered code-sample count remains here.
  { file: 'app/landingData.js', label: 'MCP tool count (code sample)', re: /(\d+) governance tools \+ \d+ resources/, expected: [S.mcpTools] },
  { file: 'app/page.tsx', label: 'MCP tool count', re: /(\d+) tools and \d+ resources/, expected: [S.mcpTools] },
  S.sdk && { file: 'app/downloads/page.tsx', label: 'Node SDK methods', re: /Canonical (\d+)-method surface/, expected: [S.sdk.node] },
  S.sdk && { file: 'app/docs/page.tsx', label: 'Node SDK methods', re: /(\d+) methods total/, expected: [S.sdk.node] },
  S.sdk && { file: 'sdk-python/README.md', label: 'Node SDK methods (parity)', re: /curated subset of \*\*(\d+) methods\*\*/, expected: [S.sdk.node] },
  S.sdk && { file: 'PROJECT_DETAILS.md', label: 'SDK method counts', re: /exposes \*\*(\d+) public methods\*\* in `sdk\/dashclaw\.js` and the Python SDK \*\*(\d+)\*\*/, expected: [S.sdk.node, S.sdk.python] },
  S.sdk && { file: 'docs/sdk-reference.md', label: 'Node SDK methods (catalogue)', re: /Full v2 method catalogue \((\d+) methods\)/, expected: [S.sdk.node] },
  S.sdk && { file: 'docs/sdk-parity.md', label: 'Node SDK methods (intro)', re: /canonical SDK: \*\*(\d+) governance-core methods\*\*/, expected: [S.sdk.node] },
  S.sdk && { file: 'docs/sdk-parity.md', label: 'Python SDK methods (intro)', re: /read\/admin conveniences:\s*\*\*(\d+) methods\*\*/, expected: [S.sdk.python] },
  S.sdk && { file: 'docs/sdk-parity.md', label: 'Node SDK methods (table)', re: /Canonical governance-core SDK \((\d+) methods\)/, expected: [S.sdk.node] },
  S.sdk && { file: 'docs/sdk-parity.md', label: 'Python SDK methods (table)', re: /Governance core \+ read\/admin conveniences \((\d+) methods\)/, expected: [S.sdk.python] },
  S.sdk && { file: 'docs/architecture/runtime-api.md', label: 'Node SDK methods (runtime-api)', re: /exposes (\d+) public methods across the core runtime/, expected: [S.sdk.node] },
  // V10: platform-guide-data.json's MCP-server package summary restates the
  // tool count in two ungated prose forms that had drifted to a pre-cull "12"
  // while live was 17 (fixed by hand, not caught by this script until now).
  { file: 'public/guides/platform-guide-data.json', label: 'MCP tool count (guide, "tools/3 resources")',
    re: /\((\d+) tools\/3 resources\)/, expected: [S.mcpTools] },
  { file: 'public/guides/platform-guide-data.json', label: 'MCP tool count (guide, "MCP tools / 3 resources")',
    re: /\((\d+) MCP tools \/ 3 resources\)/, expected: [S.mcpTools] },
  // The Python SDK's guide entry carries its own method_count field (the
  // Node entry has no equivalent field to gate) — same source of truth as
  // the README Python SDK method checks above.
  // `\s*` after the colon is load-bearing: the guide JSON is pretty-printed, so
  // the field reads `"method_count": 59`. Without it this pattern silently stopped
  // matching and the check downgraded itself to an un-asserted `warn` — the count
  // was unguarded while the script still reported all-clear.
  S.sdk && { file: 'public/guides/platform-guide-data.json', label: 'Python SDK method_count field (guide)',
    re: /"method_count":\s*(\d+)/, expected: [S.sdk.python] },
].filter(Boolean);

// Freshness stamps: the date should be >= the file's last commit date. We never
// look at any other date in these files, so historical/CHANGELOG dates are safe.
const DATE_CHECKS = [
  { file: 'PROJECT_DETAILS.md', re: /last-verified:\s*(\d{4}-\d{2}-\d{2})/ },
  { file: 'docs/sdk-reference.md', re: /last-verified:\s*(\d{4}-\d{2}-\d{2})/ },
  { file: 'docs/sdk-parity.md', re: /last-verified:\s*(\d{4}-\d{2}-\d{2})/ },
];

// Honesty: surfaces a thorough sweep covers that this script does NOT yet gate.
// 2026-07-28 sweep: the former three entries are gone — "N new sections" and
// the sdk-parity route/signal counts no longer appear in any doc (verified by
// grep), and the "N groups" prose is now gated below via tool-name set
// equality + per-group sums + cross-surface group-count consistency (the
// group taxonomy itself stays editorial; its arithmetic no longer can drift).
const UNCOVERED = [];

function lastCommitDate(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const errors = [];
const warnings = [];
// A check that never ran is not a passing check. When a doc is reworded, deleted,
// or the SDK counter fails, the assertion silently stops asserting while this
// script still prints "all gated counts match" — the count is then unguarded and
// nothing says so. (Lived example: `"method_count":(\d+)` stopped matching once the
// guide JSON was pretty-printed to `"method_count": 59`, and the check spent that
// whole time reporting a tolerant `warn` nobody read.) These are fatal under
// --strict for the same reason a drifted count is.
const deadGuards = [];
const oks = [];
// Counts --write derived from source-of-truth this run. Not errors: the doc now
// says the right number, so there is nothing left for a human to fix.
const fixed = [];

if (!S.sdk) deadGuards.push('count-sdk-methods.mjs did not return counts — every SDK method check was skipped this run.');

for (const c of COUNT_CHECKS) {
  let text;
  try {
    text = getText(c.file);
  } catch {
    if (c.optional) warnings.push(`${c.file}: not present — '${c.label}' skipped (optional, generated locally).`);
    else deadGuards.push(`${c.file}: file not found — '${c.label}' never ran.`);
    continue;
  }
  const m = withIndices(c.re).exec(text);
  if (!m) {
    deadGuards.push(`${c.file}: '${c.label}' pattern matched nothing — the doc was reworded and this count is now unguarded. Update the pattern (or drop the check if the string is gone for good).`);
    continue;
  }
  const got = m.slice(1, c.expected.length + 1).map((t) => (c.word ? toNum(t) : Number(t)));
  const mismatch = got.some((g, i) => g !== c.expected[i]);
  if (!mismatch) {
    oks.push(`${c.file}: ${c.label} = [${c.expected.join(', ')}]`);
    continue;
  }
  // Drifted. Derive it if we're allowed to touch this file; otherwise report.
  if (WRITE && (!STAGED_ONLY || STAGED.has(c.file))) {
    texts.set(c.file, rewriteGroups(text, m, c.expected, c.word));
    changedFiles.add(c.file);
    fixed.push(`${c.file}: ${c.label} [${got.join(', ')}] -> [${c.expected.join(', ')}]`);
  } else {
    const hint = WRITE && STAGED_ONLY ? ' (not staged for this commit — run `npm run doc:counts:fix`)' : '';
    errors.push(`${c.file}: ${c.label} says [${got.join(', ')}] but source-of-truth is [${c.expected.join(', ')}]${hint}`);
  }
}

// ---- flush rewrites ----
// Written before the enumeration checks below read the same files, so their
// verdicts describe the text that will actually be committed.
if (changedFiles.size) {
  for (const f of changedFiles) writeFileSync(resolve(ROOT, f), texts.get(f));
  if (STAGED_ONLY) {
    try {
      execFileSync('git', ['add', '--', ...changedFiles], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      warnings.push(`rewrote ${changedFiles.size} file(s) but could not re-stage them — \`git add\` them before committing.`);
    }
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

// ---- MCP tool enumeration + group arithmetic ----
// The SDK READMEs enumerate every tool name inside their MCP section prose.
// Gate MEMBERSHIP (set equality vs tools.ts), not just the count: a renamed or
// forgotten tool keeps the arithmetic right while the list lies.
const ENUMERATIONS = [
  // sdk/README.md: a bulleted group list between the "**N tools** in N groups:"
  // header and the "**3 resources:**" line, each bullet carrying "(N)".
  { file: 'sdk/README.md', label: 'MCP tool enumeration',
    section: /\*\*\d+ tools\*\* in (\d+) groups:([\s\S]*?)\*\*\d+ resources?:?\*\*/ },
  // sdk-python/README.md: one prose sentence, "**N tools** across N groups: ... ."
  { file: 'sdk-python/README.md', label: 'MCP tool enumeration',
    section: /\*\*\d+ tools\*\* across (\d+) groups:([\s\S]*?)(?:\n\n|Plus \d+ resources)/ },
];
const groupCounts = [];
for (const e of ENUMERATIONS) {
  let text;
  try {
    text = getText(e.file);
  } catch {
    deadGuards.push(`${e.file}: file not found — '${e.label}' never ran.`);
    continue;
  }
  const m = e.section.exec(text);
  if (!m) {
    deadGuards.push(`${e.file}: '${e.label}' section matched nothing — the doc was reworded and this enumeration is now unguarded. Update the pattern (or drop the check if the section is gone for good).`);
    continue;
  }
  groupCounts.push({ file: e.file, groups: Number(m[1]) });
  const listed = new Set([...m[2].matchAll(/`(dashclaw_\w+)`/g)].map((x) => x[1]));
  const missing = [...S.mcpToolNames].filter((n) => !listed.has(n));
  const extra = [...listed].filter((n) => !S.mcpToolNames.has(n));
  if (missing.length || extra.length) {
    errors.push(`${e.file}: ${e.label} drifted — missing from doc: [${missing.join(', ') || 'none'}]; not in tools.ts: [${extra.join(', ') || 'none'}]`);
  } else {
    oks.push(`${e.file}: ${e.label} lists exactly the ${S.mcpToolNames.size} live tools`);
  }
  // Per-group "(N)" sums must add up to the live tool count (bulleted form only).
  const perGroup = [...m[2].matchAll(/^- \*\*[^*]+\((\d+)\):?\*\*/gm)].map((x) => Number(x[1]));
  if (perGroup.length > 0) {
    const sum = perGroup.reduce((a, b) => a + b, 0);
    if (sum !== S.mcpTools) {
      errors.push(`${e.file}: per-group tool counts sum to ${sum} but tools.ts has ${S.mcpTools}`);
    } else {
      oks.push(`${e.file}: per-group counts [${perGroup.join('+')}] sum to ${S.mcpTools}`);
    }
    if (perGroup.length !== Number(m[1])) {
      errors.push(`${e.file}: declares ${m[1]} groups but lists ${perGroup.length} group bullets`);
    }
  }
}
// Group count has no machine source (taxonomy is editorial), but every surface
// that states one must state the SAME one.
const docsPage = getText('app/docs/page.tsx');
const docsGroups = /\d+ governance tools across (\d+) groups/.exec(docsPage);
if (docsGroups) groupCounts.push({ file: 'app/docs/page.tsx', groups: Number(docsGroups[1]) });
const distinct = [...new Set(groupCounts.map((g) => g.groups))];
if (distinct.length > 1) {
  errors.push(`MCP group count disagrees across surfaces: ${groupCounts.map((g) => `${g.file}=${g.groups}`).join(', ')}`);
} else if (groupCounts.length > 1) {
  oks.push(`MCP group count consistent (${distinct[0]}) across ${groupCounts.length} surfaces`);
}

// ---- report ----
console.log(`doc-counts: ${WRITE ? 'deriving' : 'reconciling'} hardcoded counts + freshness dates against source-of-truth\n`);
for (const o of oks) console.log(`  ok   ${o}`);
for (const f of fixed) console.log(`  FIX  ${f}`);
for (const w of warnings) console.log(`  warn ${w}`);
for (const g of deadGuards) console.error(`  DEAD  ${g}`);
for (const e of errors) console.error(`  DRIFT ${e}`);

console.log(`\n  (not yet gated, sweep by hand: ${UNCOVERED.length} surfaces — see UNCOVERED in this script)`);

if (errors.length === 0 && deadGuards.length === 0) {
  if (fixed.length) {
    console.log(`\ndoc-counts: derived ${fixed.length} count(s) into ${changedFiles.size} file(s) from source-of-truth.`);
  } else {
    console.log('\ndoc-counts: all gated counts match source-of-truth.');
  }
  process.exit(0);
}
if (fixed.length) console.log(`\ndoc-counts: derived ${fixed.length} count(s) into ${changedFiles.size} file(s) from source-of-truth.`);

if (errors.length) console.error(`\ndoc-counts: ${errors.length} count(s) drifted from source-of-truth.`);
if (deadGuards.length) console.error(`doc-counts: ${deadGuards.length} check(s) never ran — those counts are unguarded.`);
if (STRICT) {
  console.error('Fix the doc strings above (or regenerate the source), then re-run.');
  process.exit(1);
}
console.error('(report-only run; pass --strict to fail the build, as CI does.)');
process.exit(0);
