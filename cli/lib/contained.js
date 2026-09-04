// cli/lib/contained.js
//
// Pure helpers for `dashclaw contained` (Containment Verdicts,
// RFC 2026-07-06-containment-verdicts + RFC 2026-09-04-database-containment).
//
// Pinned to app/lib/guard/containment.ts — the CLI never imports app/** code,
// so these string builders are duplicated here byte-for-byte. If those change,
// mirror the change here too; a mismatch means the guard call's act/goal no
// longer matches the operator's pre-approved grant and `apply` never resolves
// to allow.

/**
 * Mirrors hooks/dashclaw_pretool.py _safe_branch_segment: branch_seg is
 * alnum+dash, max 64 chars. Used as a defensive assertion before `git merge` /
 * `git worktree remove` / a database replay. UNCHANGED by the database RFC —
 * the `db-` prefix lives inside the segment.
 */
export const CONTAINMENT_REF_PATTERN = /^dashclaw\/contained-[A-Za-z0-9-]{1,64}$/;

/** Server-derived prefix for a database-branch containment (RFC 2026-09-04). */
export const DB_REF_PREFIX = 'dashclaw/contained-db-';

export function isDbContainmentRef(ref) {
  return typeof ref === 'string' && ref.startsWith(DB_REF_PREFIX);
}

export function buildPromotionGoal(containedActionId) {
  return `containment promote ${containedActionId}`;
}

/**
 * The act the operator's Promote pre-approved. File ref -> the canonical merge
 * command; db ref -> the action's original recorded act, replayed against
 * production. A db ref with no original act throws rather than presenting a
 * merge command for a branch that does not exist.
 */
export function buildPromotionAct(containmentRef, originalAct) {
  if (isDbContainmentRef(containmentRef)) {
    if (!originalAct || typeof originalAct !== 'object' || Array.isArray(originalAct)) {
      throw new Error('db containment promotion requires the original recorded act');
    }
    return originalAct;
  }
  return { kind: 'shell', command: `git merge --no-ff ${containmentRef}` };
}

/**
 * Mirrors hooks/dashclaw_pretool.py _ensure_containment_worktree: ref is
 * "dashclaw/contained-<branch_seg>"; the worktree lives at
 * .dashclaw/contained/<branch_seg> relative to the repo root. Returned as a
 * path relative to the repo root (git resolves it against cwd).
 */
export function containmentWorktreePath(ref) {
  const branchSeg = ref.replace(/^dashclaw\/contained-/, '');
  return `.dashclaw/contained/${branchSeg}`;
}

/**
 * The original recorded act, read out of GET /api/actions/<id>. action_records
 * stores only the act's content hash, so the act itself lives on the guard
 * decision the row was created from — the SAME field the containment route
 * reads server-side, so both sides hash identically and the grant binds.
 */
export function originalActOf(detail) {
  const context = detail && detail.guard_decision ? detail.guard_decision.context : null;
  const act = context && typeof context === 'object' ? context.act : null;
  return act && typeof act === 'object' && !Array.isArray(act) ? act : null;
}

/** The shell command a replayable act carries (db v1 stages Bash acts). */
export function actCommandOf(act) {
  return act && act.kind === 'shell' && typeof act.command === 'string' && act.command.trim()
    ? act.command
    : null;
}

/**
 * The persisted guard context is DLP-redacted, and its `database_url` pattern
 * rewrites any `postgres://user:pass@host` literal to `[REDACTED:database_url]`.
 * A command carrying that marker is NOT the command the operator reviewed —
 * running it would execute corrupted text, so `apply` refuses and the operator
 * replays by hand (fail toward interruption, RFC 2026-07-06 invariant 5).
 */
export const REDACTION_MARKER_RE = /\[REDACTED:[a-z_]+\]/i;

export function hasRedactionMarker(command) {
  return typeof command === 'string' && REDACTION_MARKER_RE.test(command);
}

const DB_NOTE_FALLBACK =
  'schema unchanged — data changes are not diffable; review the statement and its output';

/**
 * Human-readable rendering of a `kind: 'db'` patch artifact — the same four
 * facts the /approvals card shows: branch, statement, schema diff (or the
 * note), output tail.
 */
export function formatDbEvidence(content) {
  const c = content && typeof content === 'object' ? content : {};
  const lines = [];
  const branch = c.branch_id ? String(c.branch_id) : '(branch id not captured)';
  lines.push(`Database branch: ${branch}${c.db_name ? ` · db ${c.db_name}` : ''}`);
  if (c.ref) lines.push(`Containment ref: ${c.ref}`);
  lines.push('', 'Statement:', c.statement ? String(c.statement) : '(not captured)');
  const diff = typeof c.diff === 'string' ? c.diff.trim() : '';
  lines.push('', 'Schema diff:', diff || String(c.note || DB_NOTE_FALLBACK));
  if (c.stdout_tail) lines.push('', 'Output (tail):', String(c.stdout_tail));
  return `${lines.join('\n')}\n`;
}
