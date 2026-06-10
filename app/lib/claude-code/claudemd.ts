/**
 * Generate a context-priming CLAUDE.md from a session's heavy-read files.
 * Pure — the caller supplies `projectFiles` as a `Map<relPath, content>`
 * (or omits it). When the map is missing, missing, or the file isn't in it,
 * `summarizeFile` returns the `kind: 'unknown'` / `highlights: []` stub.
 *
 * Ported from AgentLens (`src/claudemd.js`) with the A4-style refactor:
 * dropped the `fs` import and the `readSafely(absPath)` helper entirely.
 */

import path from 'node:path';
import { SECRET_PATTERNS, scanForSecrets } from './optimal-files/secret-scan';

// The secret pattern table lives in exactly one place — the Optimal Files
// secret-scan module (its declared single source of truth). Re-exported here
// so this module's public surface is unchanged, but there is no longer a
// second copy of the patterns to drift out of sync.
export { SECRET_PATTERNS };

export function redact(text: string): string {
  return scanForSecrets(text).redacted;
}

export const FILE_EXCERPT_BYTES = 1800;
export const MAX_FILE_EXCERPTS = 8;

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '.venv', 'venv', '__pycache__']);

function isIgnoredPath(p: string | null | undefined): boolean {
  if (!p) return true;
  const segs = String(p).split(/[\\/]/).map(s => s.toLowerCase());
  return segs.some(s => IGNORED_SEGMENTS.has(s));
}

export interface ToolEvent {
  name?: string;
  target?: string;
}

export interface RankedReadFile {
  target: string;
  count: number;
  firstSeen: number;
}

export function rankReadFiles(toolEvents: Array<ToolEvent | null | undefined>): RankedReadFile[] {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  toolEvents.forEach((ev, idx) => {
    if (!ev) return;
    if (ev.name !== 'Read' && ev.name !== 'Grep') return;
    const target = ev.target;
    if (!target || isIgnoredPath(target)) return;
    counts.set(target, (counts.get(target) || 0) + 1);
    if (!firstSeen.has(target)) firstSeen.set(target, idx);
  });
  const entries = [...counts.entries()].map(([target, count]) => ({
    target,
    count,
    firstSeen: firstSeen.get(target) || 0,
  }));
  entries.sort((a, b) => (b.count - a.count) || (a.firstSeen - b.firstSeen));
  return entries;
}

export function resolveInsideProject(target: string | null | undefined, projectCwd: string | null | undefined): string | null {
  if (!target || !projectCwd) return null;
  let candidate: string;
  if (path.isAbsolute(target)) candidate = path.normalize(target);
  else candidate = path.normalize(path.join(projectCwd, target));
  const cwdNorm = path.normalize(projectCwd);
  const ci = process.platform === 'win32';
  const a = ci ? candidate.toLowerCase() : candidate;
  const b = ci ? cwdNorm.toLowerCase() : cwdNorm;
  if (a !== b && !a.startsWith(b + path.sep)) return null;
  return candidate;
}

export interface FileSummary {
  kind: string;
  highlights: string[];
}

export function summarizeFile(absPath: string, content: unknown): FileSummary {
  const ext = path.extname(absPath || '').toLowerCase();
  const out: FileSummary = { kind: 'unknown', highlights: [] };
  if (typeof content !== 'string' || !content) return out;
  const lines = content.split(/\r?\n/);
  const push = (s: string | null | undefined) => { if (s && out.highlights.length < 20) out.highlights.push(s); };

  if (path.basename(absPath).toLowerCase() === 'package.json') {
    out.kind = 'package.json';
    try {
      const json = JSON.parse(content);
      if (json.name) push(`name: ${json.name}`);
      if (json.version) push(`version: ${json.version}`);
      if (json.type) push(`module type: ${json.type}`);
      if (json.main) push(`main: ${json.main}`);
      if (json.scripts) push(`scripts: ${Object.keys(json.scripts).slice(0, 10).join(', ')}`);
      if (json.dependencies) push(`dependencies: ${Object.keys(json.dependencies).slice(0, 12).join(', ')}`);
    } catch { /* malformed */ }
    return out;
  }

  if (path.basename(absPath).toLowerCase() === 'tsconfig.json') {
    out.kind = 'tsconfig.json';
    try {
      const json = JSON.parse(content);
      const co = json.compilerOptions || {};
      if (co.target) push(`target: ${co.target}`);
      if (co.module) push(`module: ${co.module}`);
      if (co.strict !== undefined) push(`strict: ${co.strict}`);
      if (co.paths) push(`path aliases: ${Object.keys(co.paths).join(', ')}`);
    } catch { /* skip */ }
    return out;
  }

  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    out.kind = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';
    for (const line of lines) {
      const m1 = line.match(/^\s*export\s+(?:default\s+)?(?:async\s+)?(class|function|interface|type|const|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (m1) push(`export ${m1[1]} ${m1[2]}`);
      const m2 = line.match(/^\s*module\.exports\s*=\s*\{?([A-Za-z0-9_$,\s]+)?\}?/);
      if (m2 && m2[1]) {
        const names = m2[1].split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
        if (names.length) push(`module.exports: ${names.join(', ')}`);
      }
      const m3 = line.match(/^\s*(class|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (m3) push(`${m3[1]} ${m3[2]}`);
    }
    return out;
  }

  if (ext === '.md') {
    out.kind = 'markdown';
    for (const line of lines.slice(0, 60)) {
      const m = line.match(/^#{1,3}\s+(.+)$/);
      if (m) push(`heading: ${(m[1] as string).slice(0, 80)}`);
    }
    return out;
  }

  if (ext === '.sql' || /schema/i.test(path.basename(absPath))) {
    out.kind = 'schema';
    for (const m of content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      push(`table: ${m[1]}`);
    }
    return out;
  }

  return out;
}

export interface SessionRow {
  session_uuid?: string;
  source_file?: string;
  [key: string]: unknown;
}

export interface ProjectRow {
  slug?: string;
  cwd?: string;
  [key: string]: unknown;
}

export interface GenerateClaudeMdInput {
  session: SessionRow;
  project: ProjectRow;
  toolEvents: Array<ToolEvent | null | undefined>;
  projectCwd: string | null | undefined;
  projectFiles?: Map<string, string> | null;
  now?: Date;
}

interface FileIndexEntry {
  target: string;
  count: number;
  inside: boolean;
  readable?: boolean;
  kind?: string;
}

interface FileExcerpt {
  target: string;
  relative: string;
  count: number;
  kind: string;
  highlights: string[];
  head: string;
  truncated: boolean;
}

export interface GenerateClaudeMdResult {
  filename: string;
  suggestedPath: string | null;
  markdown: string;
  stats: {
    heavyReads: number;
    excerpts: number;
    fileIndex: number;
  };
}

/**
 * Generate a CLAUDE.md primer.
 */
export function generateClaudeMd({ session, project, toolEvents, projectCwd, projectFiles = null, now }: GenerateClaudeMdInput): GenerateClaudeMdResult {
  const ranked = rankReadFiles(toolEvents || []);
  const heavyReads = ranked.filter(r => r.count >= 2).slice(0, 16);
  const generatedAt = (now || new Date()).toISOString();
  const slug = project && (project.slug || project.cwd || 'unknown');
  const projectName = project && (project.slug || path.basename(project.cwd || '') || 'project');

  const filesMap = projectFiles instanceof Map ? projectFiles : null;

  const excerpts: FileExcerpt[] = [];
  const fileIndex: FileIndexEntry[] = [];
  for (const r of heavyReads) {
    const abs = resolveInsideProject(r.target, projectCwd);
    if (!abs) {
      fileIndex.push({ target: r.target, count: r.count, inside: false });
      continue;
    }
    const rel = projectCwd ? path.relative(projectCwd, abs) || abs : abs;
    const content = filesMap ? (filesMap.get(rel) ?? filesMap.get(r.target) ?? null) : null;
    if (content == null) {
      fileIndex.push({ target: r.target, count: r.count, inside: true, readable: false });
      continue;
    }
    const summary = summarizeFile(abs, content);
    fileIndex.push({ target: r.target, count: r.count, inside: true, readable: true, kind: summary.kind });
    if (excerpts.length < MAX_FILE_EXCERPTS) {
      const head = redact(String(content).slice(0, FILE_EXCERPT_BYTES));
      excerpts.push({
        target: r.target,
        relative: rel,
        count: r.count,
        kind: summary.kind,
        highlights: summary.highlights,
        head,
        truncated: String(content).length > FILE_EXCERPT_BYTES,
      });
    }
  }

  const lines: string[] = [];
  lines.push(`# CLAUDE.md — ${projectName}`);
  lines.push('');
  lines.push(`<!--`);
  lines.push(`  Generated by DashClaw Code Sessions from session ${session && session.session_uuid}`);
  lines.push(`  at ${generatedAt}.`);
  lines.push(`  Source: ${session && session.source_file}`);
  lines.push(`  Provenance: this file is a context primer for Claude Code, derived`);
  lines.push(`  from the files the agent had to re-read repeatedly during the`);
  lines.push(`  previous session. Edit it freely — DashClaw never overwrites without`);
  lines.push(`  an explicit Save action.`);
  lines.push(`-->`);
  lines.push('');
  lines.push(`## Why this file exists`);
  lines.push('');
  lines.push(`In the last session for **${slug}**, the agent re-read ${heavyReads.length || 0} file${heavyReads.length === 1 ? '' : 's'} multiple times — a sign it was searching for context it should have been given up front. This file primes the next session with that context.`);
  lines.push('');

  if (fileIndex.length) {
    lines.push(`## Files the agent leaned on`);
    lines.push('');
    lines.push(`| File | Reads | Status |`);
    lines.push(`| --- | ---: | --- |`);
    for (const f of fileIndex.slice(0, 12)) {
      const status = f.inside
        ? (f.readable ? f.kind : 'inside project, content not supplied')
        : 'outside project root';
      lines.push(`| \`${f.target.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')}\` | ${f.count} | ${status} |`);
    }
    lines.push('');
  } else {
    lines.push(`## Files the agent leaned on`);
    lines.push('');
    lines.push(`_None detected — the session did not exhibit a strong repeat-read pattern._`);
    lines.push('');
  }

  for (const ex of excerpts) {
    lines.push(`### \`${ex.relative}\` (${ex.kind}, read x${ex.count})`);
    lines.push('');
    if (ex.highlights.length) {
      lines.push(`**Key shape:**`);
      for (const h of ex.highlights) lines.push(`- ${h}`);
      lines.push('');
    }
    lines.push(`<details><summary>Excerpt (first ${FILE_EXCERPT_BYTES} bytes${ex.truncated ? ', truncated' : ''})</summary>`);
    lines.push('');
    lines.push('```');
    lines.push(ex.head);
    lines.push('```');
    lines.push('');
    lines.push(`</details>`);
    lines.push('');
  }

  const pkg = excerpts.find(e => e.kind === 'package.json');
  const tsc = excerpts.find(e => e.kind === 'tsconfig.json');
  if (pkg || tsc) {
    lines.push(`## Build & test conventions`);
    lines.push('');
    if (pkg) for (const h of pkg.highlights) lines.push(`- ${h}`);
    if (tsc) for (const h of tsc.highlights) lines.push(`- tsconfig: ${h}`);
    lines.push('');
  }

  lines.push(`## Suggested checkpoints for the next session`);
  lines.push('');
  lines.push(`- State the goal before any tool use.`);
  lines.push(`- Plan the edits up front — read once, edit once, verify once.`);
  lines.push(`- If you find yourself re-reading the same file three times, stop and update this CLAUDE.md instead.`);
  lines.push('');
  lines.push(`---`);
  lines.push(`<sub>Generated by DashClaw Code Sessions. Edit, commit, or delete this file freely.</sub>`);

  const markdown = lines.join('\n') + '\n';

  return {
    filename: 'CLAUDE.md',
    suggestedPath: projectCwd ? path.join(projectCwd, 'CLAUDE.md') : null,
    markdown,
    stats: {
      heavyReads: heavyReads.length,
      excerpts: excerpts.length,
      fileIndex: fileIndex.length,
    },
  };
}
