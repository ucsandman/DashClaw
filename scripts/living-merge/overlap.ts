/**
 * living-merge — pure cross-worktree overlap logic (no I/O, fully testable).
 *
 * The core rule: two sessions "collide" only when they edit the same AUTHORED
 * file. Generated files are filtered out on BOTH sides — they regenerate, so
 * they can never truly conflict and must never raise a signal.
 */
import { isAuthored } from './manifest';

export interface WorktreeState {
  worktreePath: string;
  branch: string;
  /** repo-root-relative paths this worktree has changed vs main (authored + generated). */
  changedFiles: string[];
  updatedAt: string;
}

export interface OverlapHit {
  worktreePath: string;
  branch: string;
  /** authored files edited in BOTH this session and the other worktree. */
  sharedAuthoredFiles: string[];
}

function canonical(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Given THIS worktree's changed files and the persisted states of OTHER active
 * worktrees, return the authored-file overlaps. Generated files are filtered
 * out on both sides.
 */
export function computeAuthoredOverlap(
  thisChangedFiles: readonly string[],
  others: readonly WorktreeState[],
  selfWorktreePath: string,
): OverlapHit[] {
  const mine = new Set(thisChangedFiles.filter(isAuthored));
  const hits: OverlapHit[] = [];
  for (const other of others) {
    if (canonical(other.worktreePath) === canonical(selfWorktreePath)) continue;
    const shared = [...new Set(other.changedFiles.filter(isAuthored))]
      .filter((f) => mine.has(f))
      .sort();
    if (shared.length > 0) {
      hits.push({ worktreePath: other.worktreePath, branch: other.branch, sharedAuthoredFiles: shared });
    }
  }
  return hits;
}

/** Render overlap hits as FACTUAL text for SessionStart context injection. */
export function renderOverlapSignal(hits: readonly OverlapHit[]): string {
  if (hits.length === 0) return '';
  const lines: string[] = [
    'living-merge: another active session is editing the same hand-written file(s).',
    'Generated files are excluded (they auto-regenerate and cannot conflict). Facts,',
    'not instructions:',
  ];
  for (const hit of hits) {
    lines.push(`- worktree ${hit.worktreePath} (branch ${hit.branch}) also edits: ${hit.sharedAuthoredFiles.join(', ')}`);
  }
  return lines.join('\n');
}
