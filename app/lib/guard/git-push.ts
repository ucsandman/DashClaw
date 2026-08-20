// Branch-aware git push predicate. Used by (a) require_approval /
// block_action_type rules carrying `rules.git_push` and (b) risk_threshold
// rules carrying `rules.except_git_push`. Pure; no I/O. Funded 2026-08-20 so
// that a force-push over a protected branch is a HOLD with an approval card
// instead of a dead run.
//
// Two strengths on purpose:
//   liberal (default) — "this command contains a force push". Used to RAISE a
//     decision (the hold line). Over-matching only ever adds a gate.
//   strict (`{ strict: true }`) — "this command IS a push and nothing else".
//     Used to EXCLUDE an action from the risk-100 block line. Over-matching
//     there DROPS a gate, so `rm -rf / && git push --force origin main` must
//     stay blocked.
//
// Tokenisation is delegated to the plain-language shell parser (quote-aware
// stage splitting, escapes, flag/operand split) rather than re-implemented —
// a third bespoke shell tokeniser is exactly the drift this repo does not need.
import { parseShell, type ShellStage } from '../plain-language/parse-shell';

export interface GitPushPredicate { force?: boolean; branches?: string[] }
export interface ParsedGitPush {
  force: boolean;
  /** First refspec destination; null when the push names none. */
  branch: string | null;
  /** EVERY refspec destination — `git push origin a b` pushes both. */
  branches: string[];
  remote: string | null;
}

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master', 'trunk', 'production', 'release/*'] as const;

// Tokens that stand in front of the real command without changing what it is:
// shell wrappers, plus the hook's tool prefix ("Bash: git push ..."), which is
// how the command reaches the guard in declared_goal.
const WRAPPERS = new Set(['rtk', 'sudo', 'env', 'time', 'nohup', 'command', 'npx', 'exec']);
const isWrapper = (t: string) => WRAPPERS.has(t) || /^[A-Za-z]+:$/.test(t);

// --force / -f / --delete / -d, the attached-value lease form, and bundled
// short flags (-fq). A long flag can never reach the bundle branch: its second
// character is '-'.
const isForceFlag = (f: string) =>
  f === '--force' || f === '--delete' || f.startsWith('--force-with-lease')
  || (/^-[a-zA-Z]+$/.test(f) && (f.includes('f') || f.includes('d')));

export function commandTextOf(context: { declared_goal?: unknown; act?: unknown }): string {
  const act = context?.act && typeof context.act === 'object' ? (context.act as { command?: unknown }).command : undefined;
  if (typeof act === 'string' && act.trim()) return act;
  return typeof context?.declared_goal === 'string' ? context.declared_goal : '';
}

/**
 * A stage's non-flag tokens, truncated at a `#` comment. parseShell keeps a
 * quoted run whole, so a '#' inside quotes never starts a comment here.
 * ponytail: flags after a '#' still land in stage.flags, so a command that
 * mentions --force only in a comment can read as a force push. Conservative
 * direction (an extra hold); tighten only if it shows up in calibration data.
 */
function bareTokens(stage: ShellStage): string[] {
  const all = [stage.binary, ...(stage.subcommand ? [stage.subcommand] : []), ...stage.operands];
  const hash = all.findIndex((t) => t.startsWith('#'));
  return hash < 0 ? all : all.slice(0, hash);
}

/** Operands following `git push` in this stage, or null when it is not a push. */
function pushOperands(stage: ShellStage): string[] | null {
  const tokens = bareTokens(stage);
  const at = tokens.findIndex((t, i) => t === 'push' && tokens.slice(0, i).includes('git'));
  return at < 0 ? null : tokens.slice(at + 1);
}

export function parseGitPush(text: unknown): ParsedGitPush | null {
  if (typeof text !== 'string') return null;
  for (const stage of parseShell(text)) {
    const operands = pushOperands(stage);
    if (!operands) continue;
    let force = stage.flags.some(isForceFlag);
    const branches: string[] = [];
    for (const operand of operands.slice(1)) {
      let spec = operand;
      if (spec.startsWith('+')) { force = true; spec = spec.slice(1); }
      if (spec.startsWith(':')) { force = true; spec = spec.slice(1); }   // push :branch deletes it
      const colon = spec.indexOf(':');
      const dst = (colon >= 0 ? spec.slice(colon + 1) : spec).replace(/^refs\/heads\//, ''); // src:dst → dst
      if (dst) branches.push(dst);
    }
    return { force, branch: branches[0] ?? null, branches, remote: operands[0] ?? null };
  }
  return null;
}

/**
 * Whether the command is a push and NOTHING else: every stage is a comment, a
 * `cd`, a wrapper, or some `git <subcommand>`, and at least one stage pushes.
 * This is the gate on the exclusion direction — see the header.
 */
export function isPureGitPush(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  let sawPush = false;
  for (const stage of parseShell(text)) {
    const tokens = bareTokens(stage).filter((t) => !isWrapper(t));
    if (tokens.length === 0) continue;
    if (tokens[0] === 'cd') continue;
    if (tokens[0] !== 'git') return false;
    if (pushOperands(stage)) sawPush = true;
  }
  return sawPush;
}

export function branchMatches(branch: string | null, patterns: readonly string[]): boolean {
  if (branch == null) return true; // ponytail: unknown branch counts as protected — the conservative reading
  return patterns.some((p) => (p.endsWith('/*') ? branch.startsWith(p.slice(0, -1)) : branch === p));
}

export function gitPushPredicateMatches(
  pred: GitPushPredicate,
  text: unknown,
  opts?: { strict?: boolean },
): boolean {
  const parsed = parseGitPush(text);
  if (!parsed) return false;
  if (opts?.strict && !isPureGitPush(text)) return false;
  if (pred.force === true && !parsed.force) return false;
  const patterns = pred.branches;
  if (Array.isArray(patterns) && patterns.length > 0) {
    // A push with no refspec pushes the CURRENT branch, whatever it is: one
    // null candidate, which branchMatches reads as protected.
    const candidates: Array<string | null> = parsed.branches.length > 0 ? parsed.branches : [null];
    if (!candidates.some((b) => branchMatches(b, patterns))) return false;
  }
  return true;
}
