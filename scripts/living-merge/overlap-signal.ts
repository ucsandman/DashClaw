#!/usr/bin/env node
/**
 * living-merge — SessionStart hook. Surfaces, as FACTUAL context, any AUTHORED
 * file this worktree is editing that ANOTHER active worktree of the same repo
 * is also editing. Generated files are filtered out (they regenerate, so they
 * cannot truly conflict).
 *
 * Cross-worktree state lives under ~/.dashclaw-living-merge/<repo-key>/worktrees
 * keyed by the origin remote, so every worktree of the same clone resolves it
 * identically. Each run (re)writes this worktree's state and reads its siblings'
 * (restricted to worktrees `git worktree list` still knows about, so removed
 * worktrees don't linger as false positives).
 *
 * Registered as a Claude Code SessionStart hook by install.ts. stdout is
 * injected into the session context. ALWAYS exits 0 — never blocks a session.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir, worktreeId } from './state';
import { computeAuthoredOverlap, renderOverlapSignal, type WorktreeState } from './overlap';

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function changedVsMain(): string[] {
  const base = git(['merge-base', 'HEAD', 'main']) || git(['merge-base', 'HEAD', 'origin/main']);
  const sets = new Set<string>();
  const add = (out: string) =>
    out.split('\n').map((s) => s.trim()).filter(Boolean).forEach((f) => sets.add(f.replace(/\\/g, '/')));
  if (base) add(git(['diff', '--name-only', base, 'HEAD']));
  add(git(['diff', '--name-only', 'HEAD'])); // unstaged
  add(git(['diff', '--name-only', '--cached', 'HEAD'])); // staged
  add(git(['ls-files', '--others', '--exclude-standard'])); // untracked
  return [...sets];
}

/** Absolute paths of all worktrees git currently knows about (canonical, lowercased). */
function currentWorktreePaths(): Set<string> {
  const out = git(['worktree', 'list', '--porcelain']);
  const paths = new Set<string>();
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      paths.add(line.slice('worktree '.length).trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
    }
  }
  return paths;
}

function main(): void {
  const root = git(['rev-parse', '--show-toplevel']);
  if (!root) return; // not in a git repo
  const remote = git(['remote', 'get-url', 'origin']);
  if (!remote) return; // no origin — can't key shared state
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || '(detached)';

  const dir = stateDir(remote);
  mkdirSync(dir, { recursive: true });

  const self: WorktreeState = {
    worktreePath: root,
    branch,
    changedFiles: changedVsMain(),
    updatedAt: new Date().toISOString(),
  };
  const selfFile = join(dir, `${worktreeId(root)}.json`);
  writeFileSync(selfFile, JSON.stringify(self, null, 2));

  const live = currentWorktreePaths();
  const others: WorktreeState[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    if (file === selfFile) continue;
    let st: WorktreeState | null = null;
    try {
      st = JSON.parse(readFileSync(file, 'utf8')) as WorktreeState;
    } catch {
      continue;
    }
    if (!st || !Array.isArray(st.changedFiles) || !st.worktreePath) continue;
    const canon = st.worktreePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!live.has(canon)) {
      // worktree removed — prune its stale state so it can't raise false signals
      try { rmSync(file); } catch { /* ignore */ }
      continue;
    }
    others.push(st);
  }

  const text = renderOverlapSignal(computeAuthoredOverlap(self.changedFiles, others, root));
  if (text) process.stdout.write(text + '\n');
}

main();
