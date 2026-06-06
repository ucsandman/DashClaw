/**
 * living-merge — where cross-worktree state lives.
 *
 * Keyed by the repo's origin remote so EVERY worktree of the same clone
 * resolves to the same directory under the user's home dir. All worktrees of a
 * clone share an identical `origin` URL, so the raw (lightly-normalized) URL is
 * a stable key; light normalization tolerates a trailing `.git` / slash / case.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT_DIRNAME = '.dashclaw-living-merge';

function sha16(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16);
}

/** Stable key for a repo, derived from its origin remote URL. */
export function repoKey(remoteUrl: string): string {
  const normalized = remoteUrl.trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
  return sha16(normalized);
}

/** Home-dir state directory for a repo (shared across all its worktrees). */
export function stateDir(remoteUrl: string): string {
  return join(homedir(), ROOT_DIRNAME, repoKey(remoteUrl), 'worktrees');
}

/** Stable id for a worktree, derived from its absolute path. */
export function worktreeId(worktreePath: string): string {
  return sha16(worktreePath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
}
