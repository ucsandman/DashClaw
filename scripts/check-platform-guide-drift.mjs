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
 * Checks the route+method set, live-capture version, package versions, public
 * SDK methods and exports, MCP tools/resources, and CLI commands. The guide is
 * the only place these surfaces are presented together, so the gate validates
 * them directly instead of assuming unrelated release checks keep it current.
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

const area = (id) => {
  const value = guide.areas.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`platform-guide area ${id} is missing`);
  return value;
};

const fail = [];
const checkVersion = (label, documented, actual) => {
  if (documented !== actual) fail.push(`${label} version says ${documented ?? 'missing'}; manifest says ${actual}`);
};

checkVersion('Node SDK', area('sdk-node').package?.version, read('sdk/package.json').version);
const pythonVersion = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(resolve(ROOT, 'sdk-python/pyproject.toml'), 'utf8'))?.[1];
checkVersion('Python SDK', area('sdk-python').package?.version, pythonVersion);
checkVersion('CLI', area('cli').package?.version, read('cli/package.json').version);
checkVersion('MCP server', area('mcp').package?.version, read('mcp-server/package.json').version);
checkVersion('plugin bundle', area('plugins').package?.bundle?.version, read('plugins/dashclaw/.claude-plugin/plugin.json').version);
checkVersion('OpenClaw plugin', area('plugins').package?.openclaw?.version, read('packages/openclaw-plugin/package.json').version);

function classMethods(path, language) {
  const lines = readFileSync(resolve(ROOT, path), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => /^class DashClaw\b/.test(line));
  if (start < 0) throw new Error(`${path}: class DashClaw is missing`);
  const pattern = language === 'python'
    ? /^ {4}(?:async\s+)?def\s+([A-Za-z][A-Za-z0-9_]*)\s*\(/
    : /^ {2}(?:static\s+)?(?:async\s+|\*\s*)?([A-Za-z][A-Za-z0-9_]*)\s*\(/;
  const methods = new Set();
  for (const line of lines.slice(start + 1)) {
    if (language === 'python' && /^(class |def |[A-Za-z])/.test(line)) break;
    const name = pattern.exec(line)?.[1];
    if (name && name !== 'constructor' && !name.startsWith('_')) methods.add(name);
  }
  return methods;
}

function documentedMethods(areaId) {
  return new Set(area(areaId).items.map((item) => item.name.replace(/^client\./, '').split(/[.(]/)[0]));
}

function compareSet(label, actual, documented) {
  for (const name of [...actual].filter((value) => !documented.has(value)).sort()) fail.push(`${label} missing ${name}`);
  for (const name of [...documented].filter((value) => !actual.has(value)).sort()) fail.push(`${label} documents nonexistent ${name}`);
}

compareSet('Node SDK', classMethods('sdk/dashclaw.js', 'node'), documentedMethods('sdk-node'));
compareSet('Python SDK', classMethods('sdk-python/dashclaw/client.py', 'python'), documentedMethods('sdk-python'));

const nodeExports = new Set(['DashClaw', ...[...readFileSync(resolve(ROOT, 'sdk/dashclaw.js'), 'utf8').matchAll(/^class ([A-Za-z]+Error) extends Error/gm)].map((match) => match[1]), 'scrubAct']);
const documentedNodeExports = new Set(area('sdk-node').package?.topLevelExports ?? []);
compareSet('Node SDK export', nodeExports, documentedNodeExports);

const pythonInit = readFileSync(resolve(ROOT, 'sdk-python/dashclaw/__init__.py'), 'utf8');
const pythonExports = new Set((/__all__\s*=\s*\[([\s\S]*?)\]/m.exec(pythonInit)?.[1].match(/["']([^"']+)["']/g) ?? []).map((value) => value.slice(1, -1)));
const documentedPythonExports = new Set(area('sdk-python').package?.top_level_exports?.['from dashclaw import ...'] ?? []);
compareSet('Python SDK export', pythonExports, documentedPythonExports);

const mcpSource = readFileSync(resolve(ROOT, 'mcp-server/lib/tools.js'), 'utf8');
const mcpTools = new Set([...mcpSource.matchAll(/^\s*name:\s*'((?:dashclaw_|export_dashclaw_)[a-z_]+)'/gm)].map((match) => match[1]));
for (const gated of readFileSync(resolve(ROOT, 'mcp-server/lib/registration.js'), 'utf8').matchAll(/["']((?:dashclaw_|export_dashclaw_)[a-z_]+)["']/g)) mcpTools.add(gated[1]);
const documentedMcpTools = new Set(area('mcp').items.filter((item) => item.kind === 'mcp-tool').map((item) => item.name));
compareSet('MCP tool', mcpTools, documentedMcpTools);
const mcpResources = new Set([...readFileSync(resolve(ROOT, 'mcp-server/lib/resources.js'), 'utf8').matchAll(/^\s*uri:\s*["']([^"']+)["']/gm)].map((match) => match[1]));
const documentedMcpResources = new Set(area('mcp').items.filter((item) => item.kind === 'mcp-resource').map((item) => item.name));
compareSet('MCP resource', mcpResources, documentedMcpResources);

const cliSource = readFileSync(resolve(ROOT, 'cli/bin/dashclaw.js'), 'utf8');
const helpBlock = /DashClaw CLI[\s\S]*?Config:/.exec(cliSource)?.[0] ?? '';
const cliCommands = new Set([...helpBlock.matchAll(/^\s{2}(dashclaw\s+(?!<)[^\n]+?)(?:\s{2,}.*)?$/gm)].map((match) => match[1].trim()));
const documentedCli = new Set(area('cli').items.map((item) => item.name));
compareSet('CLI command', cliCommands, documentedCli);

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

if (missing.length || stale.length || countDrift.length || fail.length) {
  for (const message of fail) console.error(`platform-guide drift: ${message}`);
  for (const [k, v] of countDrift) {
    console.error(`meta.counts.${k} says ${counts[k] ?? 0} but the dataset's items tally to ${v} — recompute meta.counts in the regen.`);
  }
  if (missing.length || stale.length) {
    console.error('Platform guide has drifted from docs/api-inventory.json:');
    for (const k of missing) console.error(`  MISSING from guide: ${k}`);
    for (const k of stale) console.error(`  STALE in guide (route no longer exists): ${k}`);
  }
  console.error(
    `\nPlatform guide drift: metadata=${fail.length}, routesMissing=${missing.length}, ` +
      `routesStale=${stale.length}, counts=${countDrift.length}. Update the guide dataset from the ` +
      'current manifests and source inventories.'
  );
  process.exit(1);
}

console.log(
  `platform-guide drift check passed: routes=${expected.size}, nodeMethods=${documentedMethods('sdk-node').size}, ` +
  `pythonMethods=${documentedMethods('sdk-python').size}, mcpTools=${documentedMcpTools.size}, ` +
  `mcpResources=${documentedMcpResources.size}, cliCommands=${documentedCli.size}.`
);
