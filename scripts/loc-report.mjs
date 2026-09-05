#!/usr/bin/env node
// scripts/loc-report.mjs — structural size report for the simplification work
// (docs/simplify/). Measures the SOURCE tree (non-test, non-generated) and
// prints: LOC and code lines, files >= 1,500 LOC, functions >= 150 LOC,
// highest fan-in files, and duplicate helper clusters. Every number in
// docs/simplify/*.md comes from this script, never from an estimate.
//
//   node scripts/loc-report.mjs                 # markdown to stdout (working tree)
//   node scripts/loc-report.mjs --md docs/simplify/baseline.md --json out.json
//   node scripts/loc-report.mjs --ref main      # measure a git ref instead of the tree
//
// Deterministic: same tree -> same bytes (only the commit line changes).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const BIG_FILE_LOC = 1500;
const BIG_FN_LOC = 150;
const FAN_IN_TOP = 30;
const DUP_MIN_LINES = 3; // a same-named function shorter than this is noise
const CLONE_MIN_LINES = 6; // structural clones need a body worth unifying
const SRC_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py']);


// Trees that are product source. Everything else tracked in git is out of scope.
const SOURCE_TREES = [
  'app/', 'sdk/', 'sdk-python/dashclaw/', 'mcp-server/src/', 'mcp-server/bin/',
  'cli/bin/', 'cli/lib/', 'hooks/', 'scripts/', 'schema/',
  'packages/openclaw-plugin/src/', 'packages/dashclaw-demo/bin/',
  'middleware.js', 'middleware.demo.js', 'middleware.shared.js', 'next.config.js', 'drizzle.config.js', 'vitest.config.js',
  'tailwind.config.js', 'postcss.config.js', 'playwright.config.js', 'eslint.config.mjs',
];
const TEST_TREES = ['__tests__/', 'tests/', 'sdk-python/tests/', 'mcp-server/test/', 'cli/test/'];
// Generated or vendored: never measured, never edited by hand.
const EXCLUDE_RE = [
  /(^|\/)node_modules\//, /(^|\/)\.next\//, /^public\/downloads\//, /(^|\/)dist\//,
  /\.generated\./, /(^|\/)generated\//, /^mcp-server\/lib\//, /^plugins\/dashclaw\/hooks\//,
  /\.d\.ts$/, /\.min\.js$/,
];
// Names that legitimately repeat across files and are not helpers.
const NOT_HELPER = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'default', 'main', 'Page', 'Layout', 'generateMetadata', 'middleware', 'config']);

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const REF = opt('--ref');
const OUT_MD = opt('--md');
const OUT_JSON = opt('--json');

function git(...a) { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); }
function listFiles() {
  const raw = REF ? git('ls-tree', '-r', '--name-only', REF) : git('ls-files', '--cached', '--others', '--exclude-standard');
  return raw.split('\n').map((s) => s.trim()).filter(Boolean).filter((f) => SRC_EXT.has(path.extname(f)));
}
function readFile(rel) {
  if (REF) return git('show', `${REF}:${rel}`);
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function classify(rel) {
  if (EXCLUDE_RE.some((re) => re.test(rel))) return 'excluded';
  const base = path.basename(rel);
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || /^test_.*\.py$/.test(base) || /(^|\/)(test|tests|__tests__|__mocks__|fixtures)\//.test(rel)) return 'test';
  if (TEST_TREES.some((t) => rel.startsWith(t))) return 'test';
  if (SOURCE_TREES.some((t) => t.endsWith('/') ? rel.startsWith(t) : rel === t)) return 'source';
  return 'excluded';
}
function tree(rel) {
  const parts = rel.split('/');
  if (parts.length === 1) return '(root)';
  if (parts[0] === 'app') return parts[1] === 'api' || parts[1] === 'lib' || parts[1] === 'components' ? `app/${parts[1]}` : 'app/(pages)';
  if (parts[0] === 'packages') return `packages/${parts[1]}`;
  return parts[0];
}

// ---------- JS/TS analysis via the TypeScript compiler API ----------
function scriptKind(rel) {
  const ext = path.extname(rel);
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.ts') return ts.ScriptKind.TS;
  // .js/.jsx/.mjs/.cjs may contain JSX (Next.js pages do); TSX parses a superset.
  return ext === '.jsx' || ext === '.js' ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}
function analyzeJs(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));
  const loc = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const codeLines = new Set();
  const functions = [];
  const imports = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line;

  const markTokens = (node) => {
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
      const s = lineOf(node.getStart(sf)); const e = lineOf(node.getEnd());
      for (let l = s; l <= e; l++) codeLines.add(l);
      return;
    }
    for (const k of kids) markTokens(k);
  };
  markTokens(sf);

  const nameFor = (node) => {
    if (node.name && ts.isIdentifier(node.name)) return node.name.text;
    if (node.name && (ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) return node.name.text;
    const p = node.parent;
    if (!p) return null;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return p.name.text;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return p.left.getText(sf).replace(/^(module\.)?exports\./, '');
    if (ts.isExportAssignment(p)) return 'default';
    return null;
  };
  const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

  const visit = (node, depth) => {
    if (isFn(node) && node.body) {
      const s = lineOf(node.getStart(sf)); const e = lineOf(node.getEnd());
      const name = nameFor(node);
      const body = node.body.getText(sf);
      functions.push({ name, start: s + 1, end: e + 1, loc: e - s + 1, depth, body, exported: isExported(node) });
      depth += 1;
    }
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isReq = ts.isIdentifier(callee) && callee.text === 'require';
      const isDyn = callee.kind === ts.SyntaxKind.ImportKeyword;
      if ((isReq || isDyn) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, (c) => visit(c, depth));
  };
  const isExported = (node) => {
    let n = node;
    while (n && !ts.isSourceFile(n)) {
      const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
      if (mods && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return true;
      if (ts.isBinaryExpression(n) && /^(module\.)?exports\b/.test(n.left.getText(sf))) return true;
      n = n.parent;
    }
    return false;
  };
  visit(sf, 0);
  return { loc, code: codeLines.size, functions, imports };
}

// ---------- Python analysis (regex; good enough for LOC and def spans) ----------
function analyzePy(text) {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  let code = 0; let inDoc = false;
  for (const raw of lines) {
    const l = raw.trim();
    if (inDoc) { if (l.includes('"""') || l.includes("'''")) inDoc = false; continue; }
    if (!l || l.startsWith('#')) continue;
    const tq = (l.match(/"""|'''/g) || []).length;
    if ((l.startsWith('"""') || l.startsWith("'''")) && tq === 1) { inDoc = true; continue; }
    if ((l.startsWith('"""') || l.startsWith("'''")) && tq >= 2) continue;
    code += 1;
  }
  const functions = [];
  const imports = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
    const im = /^\s*(?:from\s+(\.\S*|[\w.]+)\s+import|import\s+([\w.]+))/.exec(lines[i]);
    if (im) imports.push(im[1] || im[2]);
    if (!m) continue;
    const indent = m[1].length; let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j];
      if (!t.trim()) continue;
      const ind = t.length - t.trimStart().length;
      if (ind <= indent && !/^\s*[)#\]}]/.test(t)) break;
      end = j;
    }

    functions.push({ name: m[2], start: i + 1, end: end + 1, loc: end - i + 1, depth: indent > 0 ? 1 : 0, body: lines.slice(i + 1, end + 1).join('\n'), exported: indent === 0 && !m[2].startsWith('_') });
  }
  return { loc: lines.length, code, functions, imports };
}

// ---------- import resolution for fan-in ----------
function resolveImport(fromRel, spec, fileSet) {
  let target;
  if (spec.startsWith('@/')) target = 'app/' + spec.slice(2);
  else if (spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null; // bare package
  const cands = [target];
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) cands.push(target + ext);
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) cands.push(target + '/index' + ext);
  if (/\.js$/.test(target)) cands.push(target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx'));
  for (const c of cands) if (fileSet.has(c)) return c;
  return null;
}

// ---------- duplicate detection ----------
function tokens(body) {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, body);
  const out = []; let k;
  while ((k = sc.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    if (k === ts.SyntaxKind.WhitespaceTrivia || k === ts.SyntaxKind.NewLineTrivia || k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) continue;
    out.push(sc.getTokenText());
  }
  return out;
}
function normalizedIds(toks) {
  const map = new Map();
  return toks.map((t) => (/^[A-Za-z_$][\w$]*$/.test(t) && !ts.textToKeywordObj[t] ? (map.has(t) ? map.get(t) : (map.set(t, `$${map.size}`), map.get(t))) : t));
}
function jaccard(a, b) {
  const sh = (t) => { const s = new Set(); for (let i = 0; i + 2 < t.length; i++) s.add(t[i] + '' + t[i + 1] + '' + t[i + 2]); return s; };
  const A = sh(a); const B = sh(b); if (A.size === 0 && B.size === 0) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// ---------- main ----------
const all = listFiles();
const files = [];
const fileSet = new Set(all);
for (const rel of all) {
  const cls = classify(rel);
  if (cls === 'excluded') continue;
  const text = readFile(rel);
  const ext = path.extname(rel);
  const a = ext === '.py' ? analyzePy(text) : analyzeJs(rel, text);
  files.push({ rel, cls, tree: tree(rel), ...a });
}
const source = files.filter((f) => f.cls === 'source');


// fan-in
const fanIn = new Map(); // rel -> { src:Set, test:Set }
for (const f of files) {
  for (const spec of f.imports) {
    const t = resolveImport(f.rel, spec, fileSet);
    if (!t || t === f.rel) continue;
    if (!fanIn.has(t)) fanIn.set(t, { src: new Set(), test: new Set() });
    fanIn.get(t)[f.cls === 'test' ? 'test' : 'src'].add(f.rel);
  }
}
const fan = (rel) => fanIn.get(rel) || { src: new Set(), test: new Set() };

// totals
const sum = (arr, k) => arr.reduce((n, x) => n + x[k], 0);
const byTree = {};
for (const f of source) {
  const t = byTree[f.tree] || (byTree[f.tree] = { files: 0, loc: 0, code: 0, functions: 0 });
  t.files += 1; t.loc += f.loc; t.code += f.code; t.functions += f.functions.length;
}
const byLang = {};
for (const f of source) {
  const l = path.extname(f.rel) === '.py' ? 'python' : /\.tsx?$/.test(f.rel) ? 'typescript' : 'javascript';
  const t = byLang[l] || (byLang[l] = { files: 0, loc: 0, code: 0 });
  t.files += 1; t.loc += f.loc; t.code += f.code;
}
const tests = files.filter((f) => f.cls === 'test');

const bigFiles = source.filter((f) => f.loc >= BIG_FILE_LOC).sort((a, b) => b.loc - a.loc).map((f) => ({
  file: f.rel, loc: f.loc, code: f.code, functions: f.functions.length,
  longestFn: f.functions.reduce((m, x) => Math.max(m, x.loc), 0), fanIn: fan(f.rel).src.size, fanInTests: fan(f.rel).test.size,
}));
const bigFunctions = source.flatMap((f) => f.functions.filter((x) => x.loc >= BIG_FN_LOC).map((x) => ({
  file: f.rel, name: x.name || '(anonymous)', lines: `${x.start}-${x.end}`, loc: x.loc, depth: x.depth, exported: x.exported,
}))).sort((a, b) => b.loc - a.loc || a.file.localeCompare(b.file));
const fanInRows = source.map((f) => ({
  file: f.rel, loc: f.loc, fanIn: fan(f.rel).src.size, fanInTests: fan(f.rel).test.size, locXfanIn: f.loc * fan(f.rel).src.size,
})).filter((r) => r.fanIn > 0).sort((a, b) => b.fanIn - a.fanIn || b.loc - a.loc).slice(0, FAN_IN_TOP);
const godRank = source.map((f) => ({
  file: f.rel, loc: f.loc, fanIn: fan(f.rel).src.size, locXfanIn: f.loc * Math.max(1, fan(f.rel).src.size),
})).sort((a, b) => b.locXfanIn - a.locXfanIn).slice(0, 25);

// duplicates: same-named functions in 2+ files
const byName = new Map();
const cloneByHash = new Map();
for (const f of source) {
  if (path.extname(f.rel) === '.py') continue; // python has its own idioms; the clusters that matter are JS/TS
  const seen = new Set();
  for (const x of f.functions) {
    if (!x.name || NOT_HELPER.has(x.name) || x.loc < DUP_MIN_LINES) continue;
    if (x.depth > 0 && !x.exported) continue; // inner callbacks named `handler` etc. are not shared helpers
    const toks = tokens(x.body);
    if (!seen.has(x.name)) { seen.add(x.name); (byName.get(x.name) || byName.set(x.name, []).get(x.name)).push({ file: f.rel, loc: x.loc, lines: `${x.start}-${x.end}`, toks, exported: x.exported }); }
    if (x.loc >= CLONE_MIN_LINES) {
      const h = normalizedIds(toks).join(' ');
      (cloneByHash.get(h) || cloneByHash.set(h, []).get(h)).push({ file: f.rel, name: x.name, loc: x.loc, lines: `${x.start}-${x.end}` });
    }
  }
}
const sameName = [];
for (const [name, defs] of byName) {
  const fileCount = new Set(defs.map((d) => d.file)).size;
  if (fileCount < 2) continue;
  let maxSim = 0; let identical = 0;
  for (let i = 0; i < defs.length; i++) for (let j = i + 1; j < defs.length; j++) {
    const s = jaccard(defs[i].toks, defs[j].toks); maxSim = Math.max(maxSim, s);
    if (defs[i].toks.join(' ') === defs[j].toks.join(' ')) identical += 1;
  }
  sameName.push({ name, files: fileCount, maxSimilarity: Math.round(maxSim * 100) / 100, identicalPairs: identical, totalLoc: sum(defs, 'loc'), defs: defs.map(({ toks, ...d }) => d) });
}
sameName.sort((a, b) => b.maxSimilarity - a.maxSimilarity || b.files - a.files || a.name.localeCompare(b.name));
const clones = [...cloneByHash.values()].filter((g) => new Set(g.map((d) => d.file)).size >= 2)
  .map((g) => ({ loc: g[0].loc, names: [...new Set(g.map((d) => d.name))], sites: g.map((d) => `${d.file}:${d.lines}`) }))
  .sort((a, b) => b.loc * b.sites.length - a.loc * a.sites.length || a.sites[0].localeCompare(b.sites[0]));

const commit = git('rev-parse', '--short', 'HEAD').trim();
const dirty = REF ? false : git('status', '--porcelain', '--', ...SOURCE_TREES.filter((t) => fs.existsSync(path.join(ROOT, t)))).trim().length > 0;
const report = {
  script: 'scripts/loc-report.mjs', ref: REF || `working tree @ ${commit}${dirty ? ' (dirty)' : ''}`,
  thresholds: { BIG_FILE_LOC, BIG_FN_LOC, DUP_MIN_LINES, CLONE_MIN_LINES },
  scope: { sourceTrees: SOURCE_TREES, testTrees: TEST_TREES, excluded: EXCLUDE_RE.map(String) },
  totals: { sourceFiles: source.length, sourceLoc: sum(source, 'loc'), sourceCode: sum(source, 'code'), sourceFunctions: source.reduce((n, f) => n + f.functions.length, 0), testFiles: tests.length, testLoc: sum(tests, 'loc') },
  byLang, byTree,
  bigFiles, bigFunctions, fanIn: fanInRows, godRank,
  duplicates: { sameName, clones },
};

// ---------- markdown ----------
const n = (x) => x.toLocaleString('en-US');
const md = [];
md.push(`# LOC report`, ``, `Source: \`${report.script}\` on ${report.ref}. Thresholds: file >= ${n(BIG_FILE_LOC)} LOC, function >= ${BIG_FN_LOC} LOC.`, ``);
md.push(`## Scope`, ``, `Measured trees: ${SOURCE_TREES.map((t) => `\`${t}\``).join(', ')}.`, ``, `Excluded: tests (${TEST_TREES.map((t) => `\`${t}\``).join(', ')}, \`*.test.*\`, \`test_*.py\`), node_modules, .next, public/downloads, dist/, \`*.generated.*\`, \`generated/\`, \`mcp-server/lib/\` (compiled), \`plugins/dashclaw/hooks/\` (mirror), \`*.d.ts\`.`, ``);
md.push(`## Totals`, ``, `| Metric | Value |`, `|---|---:|`,
  `| Source files | ${n(report.totals.sourceFiles)} |`, `| Source LOC (raw lines) | ${n(report.totals.sourceLoc)} |`, `| Source code lines (blanks + comments stripped) | ${n(report.totals.sourceCode)} |`,
  `| Functions (named + anonymous, all depths) | ${n(report.totals.sourceFunctions)} |`, `| Test files (not measured, counted for fan-in) | ${n(report.totals.testFiles)} |`, `| Test LOC | ${n(report.totals.testLoc)} |`, ``);
md.push(`### By language`, ``, `| Language | Files | LOC | Code |`, `|---|---:|---:|---:|`);
for (const [k, v] of Object.entries(byLang).sort()) md.push(`| ${k} | ${n(v.files)} | ${n(v.loc)} | ${n(v.code)} |`);
md.push(``, `### By tree`, ``, `| Tree | Files | LOC | Code | Functions |`, `|---|---:|---:|---:|---:|`);
for (const [k, v] of Object.entries(byTree).sort((a, b) => b[1].loc - a[1].loc)) md.push(`| ${k} | ${n(v.files)} | ${n(v.loc)} | ${n(v.code)} | ${n(v.functions)} |`);
md.push(``, `## Files >= ${n(BIG_FILE_LOC)} LOC (${bigFiles.length})`, ``, `| File | LOC | Code | Functions | Longest fn | Fan-in (src) | Fan-in (tests) |`, `|---|---:|---:|---:|---:|---:|---:|`);
for (const f of bigFiles) md.push(`| ${f.file} | ${n(f.loc)} | ${n(f.code)} | ${f.functions} | ${f.longestFn} | ${f.fanIn} | ${f.fanInTests} |`);
md.push(``, `## Functions >= ${BIG_FN_LOC} LOC (${bigFunctions.length})`, ``, `Depth 0 = top-level; deeper rows are nested inside the row above them in the same file.`, ``, `| File | Function | Lines | LOC | Depth | Exported |`, `|---|---|---|---:|---:|---|`);
for (const f of bigFunctions) md.push(`| ${f.file} | ${f.name} | ${f.lines} | ${f.loc} | ${f.depth} | ${f.exported ? 'yes' : ''} |`);
md.push(``, `## Highest fan-in (top ${FAN_IN_TOP}, source importers)`, ``, `Fan-in counts distinct importing files resolved through relative and \`@/\` specifiers (imports, re-exports, require, dynamic import). Bare package imports are not edges.`, ``, `| File | Fan-in (src) | Fan-in (tests) | LOC | LOC x fan-in |`, `|---|---:|---:|---:|---:|`);
for (const r of fanInRows) md.push(`| ${r.file} | ${r.fanIn} | ${r.fanInTests} | ${n(r.loc)} | ${n(r.locXfanIn)} |`);
md.push(``, `## God-file rank (LOC x max(1, fan-in), top 25)`, ``, `| Rank | File | LOC | Fan-in | LOC x fan-in |`, `|---:|---|---:|---:|---:|`);
godRank.forEach((r, i) => md.push(`| ${i + 1} | ${r.file} | ${n(r.loc)} | ${r.fanIn} | ${n(r.locXfanIn)} |`));
const strong = sameName.filter((s) => s.maxSimilarity >= 0.6);
const weak = sameName.filter((s) => s.maxSimilarity < 0.6);
md.push(``, `## Duplicate helper clusters`, ``, `### Same-named functions in 2+ files, bodies similar (token 3-gram Jaccard >= 0.60) (${strong.length})`, ``,
  `Similarity 1.00 with identical pairs > 0 means byte-for-byte the same tokens. JS/TS only; top-level or exported, >= ${DUP_MIN_LINES} lines.`, ``, `| Name | Files | Max similarity | Identical pairs | Total LOC | Sites |`, `|---|---:|---:|---:|---:|---|`);
for (const s of strong) md.push(`| ${s.name} | ${s.files} | ${s.maxSimilarity.toFixed(2)} | ${s.identicalPairs} | ${s.totalLoc} | ${s.defs.map((d) => `${d.file}:${d.lines}`).join('<br>')} |`);
md.push(``, `### Same-named functions in 2+ files, bodies differ (similarity < 0.60) (${weak.length})`, ``, `Same name, different behaviour: candidates for a rename or a review, not a merge.`, ``, `| Name | Files | Max similarity | Sites |`, `|---|---:|---:|---|`);
for (const s of weak) md.push(`| ${s.name} | ${s.files} | ${s.maxSimilarity.toFixed(2)} | ${s.defs.map((d) => d.file).join('<br>')} |`);
md.push(``, `### Structural clones (identifier-normalized token match, >= ${CLONE_MIN_LINES} lines, 2+ files) (${clones.length})`, ``, `Different names, same shape. Each row is one body that appears at every listed site.`, ``, `| LOC | Names | Sites |`, `|---:|---|---|`);
for (const c of clones) md.push(`| ${c.loc} | ${c.names.join(', ')} | ${c.sites.join('<br>')} |`);
md.push(``);

const mdText = md.join('\n');
if (OUT_MD) { fs.mkdirSync(path.dirname(path.resolve(ROOT, OUT_MD)), { recursive: true }); fs.writeFileSync(path.resolve(ROOT, OUT_MD), mdText); }
if (OUT_JSON) { fs.mkdirSync(path.dirname(path.resolve(ROOT, OUT_JSON)), { recursive: true }); fs.writeFileSync(path.resolve(ROOT, OUT_JSON), JSON.stringify(report, null, 2) + '\n'); }
if (!OUT_MD) process.stdout.write(mdText);
else process.stdout.write(`loc-report: ${n(report.totals.sourceFiles)} files, ${n(report.totals.sourceLoc)} LOC, ${n(report.totals.sourceCode)} code lines; ${bigFiles.length} files >= ${BIG_FILE_LOC}, ${bigFunctions.length} functions >= ${BIG_FN_LOC}, ${strong.length} similar same-name clusters, ${clones.length} structural clones -> ${OUT_MD}\n`);
