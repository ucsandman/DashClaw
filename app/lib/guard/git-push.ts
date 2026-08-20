// Branch-aware git push predicate. Used by (a) require_approval /
// block_action_type rules carrying `rules.git_push` and (b) risk_threshold
// rules carrying `rules.except_git_push`. Pure; no I/O. Funded 2026-08-20 so
// that a force-push over a protected branch is a HOLD with an approval card
// instead of a dead run.
export interface GitPushPredicate { force?: boolean; branches?: string[] }
export interface ParsedGitPush { force: boolean; branch: string | null; remote: string | null }

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master', 'trunk', 'production', 'release/*'] as const;

const FORCE_FLAGS = new Set(['--force', '-f', '--delete', '-d']);

export function commandTextOf(context: { declared_goal?: unknown; act?: { command?: unknown } | null }): string {
  const act = context?.act && typeof context.act === 'object' ? (context.act as { command?: unknown }).command : undefined;
  if (typeof act === 'string' && act.trim()) return act;
  return typeof context?.declared_goal === 'string' ? context.declared_goal : '';
}

/** Split on shell chain operators; return the args of the first `git push`. */
function gitPushSegment(text: string): string[] | null {
  for (const seg of text.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const words = seg.trim().split(/\s+/);
    const gi = words.findIndex((w, i) => w === 'git' && words[i + 1] === 'push');
    if (gi >= 0) return words.slice(gi + 2);
  }
  return null;
}

export function parseGitPush(text: unknown): ParsedGitPush | null {
  if (typeof text !== 'string') return null;
  const args = gitPushSegment(text);
  if (!args) return null;
  let force = false;
  const positional: string[] = [];
  for (const a of args) {
    if (FORCE_FLAGS.has(a) || a.startsWith('--force-with-lease')) { force = true; continue; }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  const remote = positional[0] ?? null;
  let branch: string | null = null;
  const refspec = positional[1];
  if (refspec) {
    let spec = refspec;
    if (spec.startsWith('+')) { force = true; spec = spec.slice(1); }
    if (spec.startsWith(':')) { force = true; spec = spec.slice(1); }       // push :branch deletes it
    const colon = spec.indexOf(':');
    branch = colon >= 0 ? spec.slice(colon + 1) : spec;                    // src:dst → dst
    branch = branch.replace(/^refs\/heads\//, '') || null;
  }
  return { force, branch, remote };
}

export function branchMatches(branch: string | null, patterns: readonly string[]): boolean {
  if (branch == null) return true; // ponytail: unknown branch counts as protected — the conservative reading
  return patterns.some((p) => (p.endsWith('/*') ? branch.startsWith(p.slice(0, -1)) : branch === p));
}

export function gitPushPredicateMatches(pred: GitPushPredicate, text: unknown): boolean {
  const parsed = parseGitPush(text);
  if (!parsed) return false;
  if (pred.force === true && !parsed.force) return false;
  if (Array.isArray(pred.branches) && pred.branches.length > 0 && !branchMatches(parsed.branch, pred.branches)) return false;
  return true;
}
