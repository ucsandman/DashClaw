/**
 * Pure analysis pass. Takes a parsed session, its tool events, and
 * pre-computed aggregates; returns the structured signal set every Optimal
 * Files generator depends on. No HTTP, no DB, no fs.
 *
 * Ported from AgentLens (`src/optimal-files/analyze.js`) with the A4
 * refactor:
 *   - `probeProject` no longer reads from disk. It takes `projectFiles`
 *     (Map<relPath, content>) supplied by the caller. The web server passes
 *     an empty map; the CLI can populate it from real disk state.
 *   - `projectMedianCost` and `similarSessionCount` are now caller-supplied
 *     numbers instead of `db.prepare(...)` queries.
 */

import { detectRepeatedRuns } from '../repeated-runs';
import type { ToolEvent, RepeatedRunSignal } from '../repeated-runs';

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.venv', 'venv', '__pycache__']);

export interface RankedTarget {
  target: string;
  count: number;
  firstSeen: number;
}

export interface RankedBashCommand {
  command: string;
  count: number;
  firstSeen: number;
}

export interface ClassifiedBashCommands {
  verification: Array<{ command: string; count: number }>;
  dangerous: Array<{ command: string; count: number; why: string }>;
}

export interface ProjectMeta {
  hasReadme: boolean;
  scripts: Record<string, unknown>;
  deps: Record<string, unknown>;
  testRunner: string | null;
  runtime: string | null;
  packageJson: Record<string, unknown> | null;
  tsconfig: unknown | null;
  pyproject: string | null;
}

export interface PathScopes {
  frontend: RankedTarget[];
  backend: RankedTarget[];
  tests: RankedTarget[];
  data: RankedTarget[];
  hooks: RankedTarget[];
  docs: RankedTarget[];
}

export function isIgnoredPath(p: string | null | undefined): boolean {
  if (!p) return true;
  const segs = String(p).split(/[\\/]/).map(s => s.toLowerCase());
  return segs.some(s => IGNORED_SEGMENTS.has(s));
}

function rankTargetEvents(events: ToolEvent[], predicate: (ev: ToolEvent) => boolean): RankedTarget[] {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  events.forEach((ev, idx) => {
    if (!ev || !predicate(ev)) return;
    const t = ev.target;
    if (!t || isIgnoredPath(t)) return;
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!firstSeen.has(t)) firstSeen.set(t, idx);
  });
  return [...counts.entries()].map(([target, count]) => ({
    target,
    count,
    firstSeen: firstSeen.get(target) || 0,
  })).sort((a, b) => (b.count - a.count) || (a.firstSeen - b.firstSeen));
}

function bashCommandsFromEvents(events: ToolEvent[]): RankedBashCommand[] {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  events.forEach((ev, idx) => {
    if (!ev || ev.name !== 'Bash') return;
    const cmd = String(ev.target || '').trim();
    if (!cmd) return;
    counts.set(cmd, (counts.get(cmd) || 0) + 1);
    if (!firstSeen.has(cmd)) firstSeen.set(cmd, idx);
  });
  return [...counts.entries()].map(([command, count]) => ({
    command, count, firstSeen: firstSeen.get(command) || 0,
  })).sort((a, b) => (b.count - a.count) || (a.firstSeen - b.firstSeen));
}

export const VERIFICATION_HINTS: RegExp[] = [
  /^npm\s+test\b/i,
  /^npm\s+run\s+(test|lint|typecheck|build)\b/i,
  /^node\s+--test\b/i,
  /^pnpm\s+test\b/i,
  /^yarn\s+test\b/i,
  /^pytest\b/i,
  /^python\s+-m\s+pytest\b/i,
  /^python\s+tests\//i,
  /^cargo\s+(test|check|build)\b/i,
  /^go\s+(test|build|vet)\b/i,
  /^mix\s+test\b/i,
  /^rspec\b/i,
  /^bundle\s+exec\b/i,
];

export const DANGEROUS_HINTS: Array<{ re: RegExp; why: string }> = [
  // Trailing `\b` removed deliberately: at end-of-string after a non-word
  // char like `/` the JS regex \b does not match, so `rm -rf /` would slip
  // through. Verified by AgentLens regression test `optimal-files.test.js`.
  { re: /\brm\s+-rf\s+(\/|~|\$HOME|\*|\.)/i, why: 'rm -rf at filesystem root or home' },
  { re: /\bgit\s+push\s+.*--force\b/i, why: 'force push' },
  { re: /\bgit\s+reset\s+--hard\b/i, why: 'destructive git reset' },
  { re: /\bDROP\s+(?:TABLE|DATABASE)\b/i, why: 'destructive SQL' },
  { re: /\bsudo\s+rm\b/i, why: 'sudo rm' },
  { re: /:[(]:[)]/, why: 'fork bomb' },
];

export function classifyBashCommands(bashCommands: Array<{ command: string; count: number }>): ClassifiedBashCommands {
  const verification: Array<{ command: string; count: number }> = [];
  const dangerous: Array<{ command: string; count: number; why: string }> = [];
  for (const { command, count } of bashCommands) {
    if (VERIFICATION_HINTS.some(re => re.test(command))) {
      verification.push({ command, count });
    }
    for (const hint of DANGEROUS_HINTS) {
      if (hint.re.test(command)) {
        dangerous.push({ command, count, why: hint.why });
        break;
      }
    }
  }
  return { verification, dangerous };
}

// Pure project meta probe — uses caller-supplied projectFiles map instead
// of reading from disk. `projectFiles` keys are relative paths
// ('package.json', 'tsconfig.json', 'README.md', 'pyproject.toml'); values
// are file contents as strings.
export function probeProject(projectFiles: Map<string, string> | null | undefined): ProjectMeta {
  const meta: ProjectMeta = {
    hasReadme: false,
    scripts: {},
    deps: {},
    testRunner: null,
    runtime: null,
    packageJson: null,
    tsconfig: null,
    pyproject: null,
  };
  const files = projectFiles instanceof Map ? projectFiles : new Map<string, string>();

  const pkg = files.get('package.json');
  if (pkg) {
    try {
      const packageJson = JSON.parse(pkg) as Record<string, unknown>;
      meta.packageJson = packageJson;
      meta.scripts = (packageJson.scripts as Record<string, unknown>) || {};
      meta.deps = (packageJson.dependencies as Record<string, unknown>) || {};
      meta.runtime = 'node';
      const scripts = meta.scripts as { test?: string };
      if (scripts.test && /node\s+--test/.test(scripts.test)) meta.testRunner = 'node:test';
      else if (scripts.test && /jest/.test(scripts.test)) meta.testRunner = 'jest';
      else if (scripts.test && /vitest/.test(scripts.test)) meta.testRunner = 'vitest';
      else if (scripts.test && /mocha/.test(scripts.test)) meta.testRunner = 'mocha';
      else if (scripts.test) meta.testRunner = 'custom';
    } catch { /* malformed */ }
  }
  const tsc = files.get('tsconfig.json');
  if (tsc) {
    try { meta.tsconfig = JSON.parse(tsc); } catch { /* skip */ }
  }
  const py = files.get('pyproject.toml');
  if (py) {
    meta.pyproject = String(py).slice(0, 500);
    if (!meta.runtime) meta.runtime = 'python';
  }
  for (const name of ['README.md', 'readme.md', 'README']) {
    if (files.has(name)) { meta.hasReadme = true; break; }
  }
  return meta;
}

export function deriveScopes(targets: RankedTarget[]): PathScopes {
  const scopes: PathScopes = { frontend: [], backend: [], tests: [], data: [], hooks: [], docs: [] };
  for (const t of targets) {
    const lower = String(t.target || '').toLowerCase();
    let placed = false;
    if (/\/tests?\//.test(lower) || /\.test\./.test(lower) || /\.spec\./.test(lower) || /\\tests?\\/.test(lower)) {
      scopes.tests.push(t); placed = true;
    }
    if (/\/(?:public|frontend|client|web|ui|app)\//.test(lower) || /\\(?:public|frontend|client|web|ui|app)\\/.test(lower) || (/\.tsx?$/.test(lower) && /\/components\//.test(lower)) || /\.(css|html)$/.test(lower)) {
      scopes.frontend.push(t); placed = true;
    }
    if (/\/(?:routes|api|server|controllers|handlers)\//.test(lower) || /\\(?:routes|api|server|controllers|handlers)\\/.test(lower) || /server\.(js|ts)$/.test(lower)) {
      scopes.backend.push(t); placed = true;
    }
    if (/\/(?:db|schema|migrations?|models?)\//.test(lower) || /\\(?:db|schema|migrations?|models?)\\/.test(lower) || /\.sql$/.test(lower) || /db\.js$/.test(lower) || /schema/.test(lower)) {
      scopes.data.push(t); placed = true;
    }
    if (/\/hooks?\//.test(lower) || /\\hooks?\\/.test(lower)) {
      scopes.hooks.push(t); placed = true;
    }
    if (/\.md$/.test(lower)) {
      scopes.docs.push(t); placed = !placed ? true : placed;
    }
  }
  return scopes;
}

interface SessionLike {
  cost_usd?: number | string | null;
  naive_cost_usd?: number | string | null;
  parser_version?: number | string | null;
  [key: string]: unknown;
}

export interface AnalyzeSessionInput {
  session: SessionLike;
  project: unknown;
  toolEvents?: ToolEvent[] | null;
  projectCwd: unknown;
  projectMedianCost?: number | null;
  similarSessionCount?: number;
  projectFiles?: Map<string, string> | null;
  now?: Date;
}

export function analyzeSession({
  session,
  project,
  toolEvents,
  projectCwd,
  projectMedianCost = null,
  similarSessionCount = 0,
  projectFiles = null,
  now,
}: AnalyzeSessionInput) {
  toolEvents = toolEvents || [];
  const reads = rankTargetEvents(toolEvents, ev => ev.name === 'Read' || ev.name === 'Grep');
  const edits = rankTargetEvents(toolEvents, ev => ev.name === 'Edit' || ev.name === 'MultiEdit');
  const writes = rankTargetEvents(toolEvents, ev => ev.name === 'Write');
  const bash = bashCommandsFromEvents(toolEvents);
  const { verification, dangerous } = classifyBashCommands(bash);
  const repeatedRuns = detectRepeatedRuns(toolEvents);
  const repeatedRunSummary = repeatedRuns.reduce(
    (acc, r) => { acc[r.confidence] = (acc[r.confidence] || 0) + 1; return acc; },
    { high: 0, medium: 0, low: 0 } as Record<RepeatedRunSignal['confidence'], number>,
  );
  const projectMeta = probeProject(projectFiles);
  const pathScopes = deriveScopes(reads.concat(edits));
  const generatedAt = (now || new Date()).toISOString();

  const confidence = {
    contextGap: reads.length && reads[0]!.count >= 3 ? 'high'
      : (reads.length && reads[0]!.count >= 2 ? 'medium' : 'low'),
    repeatedRunGuard: repeatedRunSummary.high >= 1 ? 'high'
      : (repeatedRunSummary.medium >= 2 ? 'medium' : 'low'),
    costGuard: (projectMedianCost && Number(session.cost_usd) > projectMedianCost * 1.5) ? 'high'
      : ((Number(session.cost_usd) || 0) > 2.0 ? 'medium' : 'low'),
    dangerousCommandGuard: dangerous.length >= 1 ? 'high' : 'low',
    skillCandidate: similarSessionCount >= 3 ? 'medium' : 'low',
  };

  return {
    session,
    project,
    projectCwd,
    toolEvents,
    reads,
    edits,
    writes,
    bashCommands: bash,
    repeatedRuns,
    repeatedRunSummary,
    verificationCommands: verification,
    dangerousCommands: dangerous,
    pathScopes,
    projectMeta,
    projectMedianCost,
    similarSessionCount,
    cost: {
      usd: Number(session.cost_usd) || 0,
      naive_usd: Number(session.naive_cost_usd) || 0,
      parserVersion: Number(session.parser_version) || 0,
    },
    confidence,
    generatedAt,
  };
}
