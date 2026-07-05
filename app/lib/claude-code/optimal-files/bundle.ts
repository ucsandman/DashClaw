/**
 * Optimal Files bundle builder. Pure — no DB, no HTTP, no fs.
 *
 * Per the A4 refactor in docs/architecture/AGENTLENS_INTEGRATION_GOAL.md:
 *
 *   - `buildOptimalFilesBundle` accepts pre-computed aggregates and an
 *     optional `existingPaths: Set<string>` to compute `overwriteRisk`.
 *     Empty set ⇒ `'unknown'` for non-virtual entries. The web server omits
 *     `existingPaths` (it cannot see the user's filesystem); the CLI
 *     populates it from real disk state.
 *
 *   - `planBundleSelections` (renamed from `writeBundleSelections`) is
 *     pure: returns per-file `{ path, status, content, mode, ... }` plans
 *     without touching disk. The CLI's `apply.js` consumes the plan and
 *     does the actual writes.
 *
 *   - `previewBundleMerge` is pure: accepts the existing on-disk content as
 *     a string argument instead of reading it. The CLI passes real content;
 *     the server passes `null` and the result is the "bundle-side plan".
 *
 * Ported from AgentLens (`src/optimal-files/bundle.js`).
 */

import path from 'node:path';
import { analyzeSession } from './analyze';
import { generateRootClaudeMd } from './root-claude-md';
import { generateSessionPack } from './session-pack';
import { generatePathRules } from './path-rules';
import { generateHooksBundle } from './hooks-bundle';
import { generateRecipe } from './recipe';
import { generateSkillCandidates } from './skills';
import { scanFiles } from './secret-scan';
import { previewMerge, applyMerge } from './merge';

// Bundle files are produced by a mix of generators (some already typed, some
// still JS). They share a common loose shape: a `path` + `content` plus the
// risk/selection annotations mutated below. Kept permissive so heterogeneous
// generator return types remain assignable.
interface BundleFile {
  path: string;
  content: string;
  virtual?: boolean;
  group?: string;
  kind?: unknown;
  title?: unknown;
  reason?: unknown;
  confidence?: unknown;
  overwriteRisk?: string;
  absolutePath?: string;
  [key: string]: unknown;
}

interface BundleSelection {
  path: string;
  mode?: string;
  overwrite?: boolean;
  acceptedHeadings?: string[];
  acceptedBullets?: Array<{ heading: string; text: string }>;
}

export function buildOptimalFilesBundle({
  session,
  project,
  toolEvents,
  projectCwd,
  projectMedianCost = null,
  similarSessionCount = 0,
  projectFiles = null,
  now,
  existingPaths = null,
}: {
  session: any;
  project?: any;
  toolEvents?: any;
  projectCwd?: string | null;
  projectMedianCost?: number | null;
  similarSessionCount?: number;
  projectFiles?: any;
  now?: any;
  existingPaths?: Set<string> | null;
}): { bundle: BundleFile[]; analysis: Record<string, unknown>; groups: ReturnType<typeof groupBundle> } {
  const analysis = analyzeSession({
    session,
    project,
    toolEvents,
    projectCwd,
    projectMedianCost,
    similarSessionCount,
    projectFiles,
    now,
  });

  const files: BundleFile[] = [];
  // `analysis` from analyzeSession infers `project: unknown`; each generator
  // wants a narrower `*Analysis` shape it's structurally compatible with at
  // runtime. Cast the shared object to satisfy every generator's param type,
  // and the typed artifacts to BundleFile (they lack the loose index signature).
  const a = analysis as any;
  files.push(generateRootClaudeMd(a) as unknown as BundleFile);
  files.push(generateSessionPack(a) as unknown as BundleFile);
  for (const r of generatePathRules(a)) files.push(r as unknown as BundleFile);
  for (const h of generateHooksBundle(a)) files.push(h as unknown as BundleFile);
  files.push(generateRecipe(a) as unknown as BundleFile);
  for (const s of generateSkillCandidates(a)) files.push(s as unknown as BundleFile);

  // Pure scan of every emitted file's content for secrets. Replaces content
  // with the redacted version. Bundle files with empty content (virtual /
  // deferred entries) get a passed scan.
  scanFiles(files);

  // Mark overwrite risk per file based on the caller-supplied existingPaths
  // set. Without it, non-virtual entries are 'unknown' — the web server
  // takes this path because it cannot see the user's filesystem.
  const pathsSet = existingPaths instanceof Set ? existingPaths : null;
  for (const f of files) {
    if (f.virtual) { f.overwriteRisk = 'n/a'; continue; }
    if (!projectCwd) { f.overwriteRisk = 'new'; continue; }
    const abs = absolutize(projectCwd, f.path);
    if (!abs) { f.overwriteRisk = 'unsafe'; continue; }
    if (!pathsSet) { f.overwriteRisk = 'unknown'; f.absolutePath = abs; continue; }
    f.overwriteRisk = pathsSet.has(abs) ? 'conflict' : 'new';
    f.absolutePath = abs;
  }

  return {
    bundle: files,
    analysis: {
      // Trim the analysis we hand back — the UI doesn't need every tool event.
      session_uuid: (session && session.session_uuid) || null,
      cost: analysis.cost,
      reads: analysis.reads.slice(0, 10),
      edits: analysis.edits.slice(0, 10),
      bashCommands: analysis.bashCommands.slice(0, 10),
      verificationCommands: analysis.verificationCommands,
      dangerousCommands: analysis.dangerousCommands,
      repeatedRunSummary: analysis.repeatedRunSummary,
      projectMedianCost: analysis.projectMedianCost,
      similarSessionCount: analysis.similarSessionCount,
      confidence: analysis.confidence,
      generatedAt: analysis.generatedAt,
    },
    groups: groupBundle(files),
  };
}

function groupBundle(files: BundleFile[]): {
  recommended_now: Array<Record<string, unknown>>;
  optional: Array<Record<string, unknown>>;
  not_recommended_yet: Array<Record<string, unknown>>;
} {
  const groups: {
    recommended_now: Array<Record<string, unknown>>;
    optional: Array<Record<string, unknown>>;
    not_recommended_yet: Array<Record<string, unknown>>;
  } = { recommended_now: [], optional: [], not_recommended_yet: [] };
  for (const f of files) {
    const g = (groups as Record<string, Array<Record<string, unknown>>>)[f.group as string] || groups.optional;
    g.push({ path: f.path, kind: f.kind, title: f.title, reason: f.reason, confidence: f.confidence });
  }
  return groups;
}

// Convert a bundle-relative path into an absolute path inside the project's
// cwd. Refuses to escape the cwd. Returns null on escape so the caller can
// flag the entry.
export function absolutize(projectCwd: string | null | undefined, relPath: string | null | undefined): string | null {
  if (!projectCwd || !relPath) return null;
  // bundle paths must be relative. Check BOTH posix and win32 absolute
  // semantics — node:path is OS-specific, so on Linux CI a string like
  // 'C:\\Windows\\System32' is not flagged by path.isAbsolute and would
  // otherwise be naively joined into the project tree. The bundle is
  // produced on Linux (Vercel) but applied on Windows, so a malicious
  // manifest with a drive-rooted or UNC path must be rejected here even
  // when the runtime is POSIX.
  if (path.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) return null;
  const candidate = path.normalize(path.join(projectCwd, relPath));
  const cwdNorm = path.normalize(projectCwd);
  const ci = process.platform === 'win32';
  const a = ci ? candidate.toLowerCase() : candidate;
  const b = ci ? cwdNorm.toLowerCase() : cwdNorm;
  if (a !== b && !a.startsWith(b + path.sep)) return null;
  return candidate;
}

// Pure plan of which files to write and how. Replaces `writeBundleSelections`.
// Returns `{ results: [{path, status, absolutePath?, content?, mode?, ...}] }`.
// No fs writes. `existingPaths: Set<string>` supplied by the caller (CLI)
// for conflict detection; when omitted, conflict status is 'unknown' and the
// caller must check at apply time.
//
// `mergeContent` (Map<path, existingContent>) lets the caller supply the
// current on-disk content for files in merge mode. Without it, merge mode
// falls back to side-by-side.
export function planBundleSelections({ bundle, projectCwd, selections, existingPaths = null, mergeContent = null }: {
  bundle: BundleFile[];
  projectCwd?: string | null;
  selections: BundleSelection[];
  existingPaths?: Set<string> | null;
  mergeContent?: Map<string, string> | null;
}): { results: Array<Record<string, unknown>> } {
  if (!projectCwd) {
    return { results: selections.map(s => ({ path: s.path, status: 'project_cwd_missing' })) };
  }
  const pathsSet = existingPaths instanceof Set ? existingPaths : null;
  const mergeMap = mergeContent instanceof Map ? mergeContent : null;
  const results: Array<Record<string, unknown>> = [];
  for (const sel of selections) {
    const file = bundle.find(f => f.path === sel.path && !f.virtual);
    if (!file) { results.push({ path: sel.path, status: 'not_in_bundle' }); continue; }
    const abs = absolutize(projectCwd, file.path);
    if (!abs) { results.push({ path: sel.path, status: 'unsafe_path' }); continue; }
    const exists = pathsSet ? pathsSet.has(abs) : null;

    const mode = exists === true
      ? (sel.mode || (sel.overwrite ? 'overwrite' : 'safe'))
      : exists === false
        ? 'create'
        : (sel.mode || 'safe');

    if (mode === 'safe') {
      results.push({ path: sel.path, absolutePath: abs, status: exists === true ? 'conflict' : 'unknown_existing' });
      continue;
    }

    if (mode === 'merge') {
      const isMarkdown = abs.toLowerCase().endsWith('.md');
      if (!isMarkdown) {
        const sideAbs = sideBySidePath(abs);
        results.push({
          path: sel.path,
          absolutePath: sideAbs,
          status: 'side_by_side_fallback',
          content: file.content,
          mode: 'side_by_side',
          note: 'Non-markdown file; planned as side-by-side. Apply step writes <name>.NEW.<ext>.',
        });
        continue;
      }
      const existingContent = mergeMap ? mergeMap.get(abs) : null;
      if (existingContent == null) {
        // No content available — fall back to side-by-side at apply time.
        const sideAbs = sideBySidePath(abs);
        results.push({
          path: sel.path,
          absolutePath: sideAbs,
          status: 'merge_pending_disk',
          content: file.content,
          mode: 'side_by_side',
          note: 'No existing content supplied; apply step must check disk and write side-by-side if file exists, or create otherwise.',
        });
        continue;
      }
      const applied = applyMerge(existingContent, file.content, {
        acceptedHeadings: sel.acceptedHeadings || [],
        acceptedBullets: sel.acceptedBullets || [],
      });
      results.push({
        path: sel.path,
        absolutePath: abs,
        status: 'merge_planned',
        content: applied.merged,
        mode: 'merge',
        additions: applied.additions,
      });
      continue;
    }

    if (mode === 'side_by_side') {
      const sideAbs = sideBySidePath(abs);
      results.push({
        path: sel.path,
        absolutePath: sideAbs,
        status: 'side_by_side',
        content: file.content,
        mode: 'side_by_side',
      });
      continue;
    }

    // 'overwrite' or 'create' — pure plan.
    results.push({
      path: sel.path,
      absolutePath: abs,
      status: exists === true ? 'overwrite_planned' : 'create_planned',
      content: file.content,
      mode: mode === 'create' ? 'create' : 'overwrite',
    });
  }
  return { results };
}

// For a path like ".../CLAUDE.md" return ".../CLAUDE.NEW.md". For files
// without an extension just append ".NEW".
export function sideBySidePath(abs: string): string {
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const ext = path.extname(base);
  if (!ext) return path.join(dir, base + '.NEW');
  const stem = base.slice(0, -ext.length);
  return path.join(dir, `${stem}.NEW${ext}`);
}

// Pure preview of a merge plan for one bundle file against caller-supplied
// existing content. The server passes `existingContent=null` (it doesn't see
// the user's disk); the CLI passes the real content for an in-process
// preview.
export function previewBundleMerge({ bundle, projectCwd, filePath, existingContent = null }: {
  bundle: BundleFile[];
  projectCwd?: string | null;
  filePath: string;
  existingContent?: string | null;
}): Record<string, unknown> {
  if (!projectCwd) return { error: 'project_cwd_missing' };
  const file = bundle.find(f => f.path === filePath && !f.virtual);
  if (!file) return { error: 'not_in_bundle' };
  const abs = absolutize(projectCwd, file.path);
  if (!abs) return { error: 'unsafe_path' };
  if (!abs.toLowerCase().endsWith('.md')) {
    return {
      mode: 'side_by_side_only',
      absolutePath: abs,
      sideBySidePath: sideBySidePath(abs),
      reason: 'Non-markdown file. Auto-merge would be risky; merge writes side-by-side instead.',
    };
  }
  if (existingContent == null) {
    return {
      mode: 'no_existing_supplied',
      absolutePath: abs,
      reason: 'Caller did not supply existing on-disk content. Apply step will check disk and pick create/merge/side_by_side accordingly.',
      bundleSidePreview: file.content.slice(0, 4000),
    };
  }
  const plan = previewMerge(existingContent, file.content);
  const fullSelection = {
    acceptedHeadings: plan.appendSections.map(s => s.heading),
    acceptedBullets: ([] as Array<{ heading: string; text: string }>).concat(...plan.sharedSections.map(s =>
      s.candidateBullets.map(b => ({ heading: s.heading, text: b.text })))),
  };
  const fullApply = applyMerge(existingContent, file.content, fullSelection);
  return {
    mode: 'merge_available',
    absolutePath: abs,
    existing: { bytes: Buffer.byteLength(existingContent, 'utf8') },
    plan,
    fullAcceptance: {
      bytes: Buffer.byteLength(fullApply.merged, 'utf8'),
      additions: fullApply.additions,
      preview: fullApply.merged.length > 12000 ? fullApply.merged.slice(0, 12000) + '\n…(truncated)' : fullApply.merged,
    },
  };
}
