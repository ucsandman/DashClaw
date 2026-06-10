/**
 * Repository for behavior_samples + behavior_dismissals — the opt-in ANONYMIZED
 * behavior-sample upload that lets a hosted Policy Coach run the deterministic
 * analyzer when local JSONL files are unreachable.
 *
 * Privacy contract: rows only ever contain what the ingest route's allowlist
 * rebuild lets through — path HASHES (never raw paths), pre-classified
 * write_path_groups, command shapes, and scalar metadata. Every read and write
 * here is org-scoped; multi-tenant instances must never see each other's
 * behavior (the local-file path has no org axis by nature — this one does).
 *
 * Follows the repository pattern: every function takes (sql, orgId, ...);
 * tagged templates or parameterized sql.query only.
 */
import type { SqlTag } from '../types/db';

/** Hard retention bounds — mirrors the local store's MAX_SAMPLES ceiling. */
const MAX_SAMPLES_PER_ORG = 20000;
const RETENTION_DAYS = 60;

/** A sanitized, allowlist-rebuilt sample row as produced by the ingest route. */
export interface SanitizedBehaviorSample {
  event_id: string;
  ts: string;
  agent_id: string;
  session_hash: string | null;
  source: string | null;
  tool: string | null;
  tool_category: string | null;
  action_type: string | null;
  command_shape: string | null;
  bash_intent: string | null;
  risk_score: number | null;
  guard_decision: string | null;
  reversible: number;
  model: string | null;
  read_path_hashes: string[];
  write_path_hashes: string[];
  write_path_groups: string[];
  sensitive_path: number;
  outcome_status: string | null;
  error_type: string | null;
  duration_ms: number | null;
  matched_policy_count: number | null;
  finalized: number;
}

const INSERT_COLUMNS = [
  'org_id', 'event_id', 'ts', 'agent_id', 'session_hash', 'source', 'tool',
  'tool_category', 'action_type', 'command_shape', 'bash_intent', 'risk_score',
  'guard_decision', 'reversible', 'model', 'read_path_hashes',
  'write_path_hashes', 'write_path_groups', 'sensitive_path', 'outcome_status',
  'error_type', 'duration_ms', 'matched_policy_count', 'finalized',
] as const;

// Per-column cast suffixes so jsonb/timestamptz params survive the HTTP driver.
const COLUMN_CASTS: Record<string, string> = {
  ts: '::timestamptz',
  read_path_hashes: '::jsonb',
  write_path_hashes: '::jsonb',
  write_path_groups: '::jsonb',
};

const UPSERT_CHUNK = 100;

/**
 * Idempotent batch upsert keyed on (org_id, event_id). Mirrors the local
 * store's pickFinalSample semantics: an incoming FINALIZED record supersedes a
 * stored "running" one, and among finalized records the latest ts wins. An
 * incoming non-finalized record NEVER overwrites an existing row (re-uploads of
 * pre-tool "running" records are no-ops once anything is stored).
 * Returns the number of rows actually written (inserted or updated).
 */
export async function upsertBehaviorSamples(
  sql: SqlTag,
  orgId: string,
  samples: SanitizedBehaviorSample[]
): Promise<number> {
  if (!Array.isArray(samples) || samples.length === 0) return 0;
  let written = 0;
  for (let offset = 0; offset < samples.length; offset += UPSERT_CHUNK) {
    const chunk = samples.slice(offset, offset + UPSERT_CHUNK);
    const params: unknown[] = [];
    const rows = chunk.map((s) => {
      const values = [
        orgId, s.event_id, s.ts, s.agent_id, s.session_hash, s.source, s.tool,
        s.tool_category, s.action_type, s.command_shape, s.bash_intent,
        s.risk_score, s.guard_decision, s.reversible, s.model,
        JSON.stringify(s.read_path_hashes || []),
        JSON.stringify(s.write_path_hashes || []),
        JSON.stringify(s.write_path_groups || []),
        s.sensitive_path, s.outcome_status, s.error_type, s.duration_ms,
        s.matched_policy_count, s.finalized,
      ];
      const placeholders = values.map((v, i) => {
        params.push(v);
        return `$${params.length}${COLUMN_CASTS[INSERT_COLUMNS[i] ?? ''] || ''}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    const result = await sql.query(
      `INSERT INTO behavior_samples (${INSERT_COLUMNS.join(', ')})
       VALUES ${rows.join(', ')}
       ON CONFLICT (org_id, event_id) DO UPDATE SET
         ts = EXCLUDED.ts, agent_id = EXCLUDED.agent_id,
         session_hash = EXCLUDED.session_hash, source = EXCLUDED.source,
         tool = EXCLUDED.tool, tool_category = EXCLUDED.tool_category,
         action_type = EXCLUDED.action_type, command_shape = EXCLUDED.command_shape,
         bash_intent = EXCLUDED.bash_intent, risk_score = EXCLUDED.risk_score,
         guard_decision = EXCLUDED.guard_decision, reversible = EXCLUDED.reversible,
         model = EXCLUDED.model, read_path_hashes = EXCLUDED.read_path_hashes,
         write_path_hashes = EXCLUDED.write_path_hashes,
         write_path_groups = EXCLUDED.write_path_groups,
         sensitive_path = EXCLUDED.sensitive_path, outcome_status = EXCLUDED.outcome_status,
         error_type = EXCLUDED.error_type, duration_ms = EXCLUDED.duration_ms,
         matched_policy_count = EXCLUDED.matched_policy_count, finalized = EXCLUDED.finalized
       WHERE EXCLUDED.finalized = 1
         AND (behavior_samples.finalized = 0 OR EXCLUDED.ts >= behavior_samples.ts)
       RETURNING id`,
      params
    );
    written += Array.isArray(result) ? result.length : 0;
  }
  return written;
}

function toIso(v: unknown): string {
  const t = Date.parse(String(v ?? ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : [];
}

/**
 * Read this org's uploaded samples, newest first, mapped back into the
 * BehaviorSample shape the analyzer/simulator consume: path hashes flow into
 * read_paths/write_paths (string identity is all the loop detectors need),
 * write_path_groups passes through for protected-path classification.
 */
export async function listBehaviorSamples(
  sql: SqlTag,
  orgId: string,
  { limit = MAX_SAMPLES_PER_ORG }: { limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const cap = Math.min(Math.max(Math.floor(Number(limit)) || MAX_SAMPLES_PER_ORG, 1), MAX_SAMPLES_PER_ORG);
  const rows = await sql`
    SELECT event_id, ts, agent_id, session_hash, source, tool, tool_category,
           action_type, command_shape, bash_intent, risk_score, guard_decision,
           reversible, model, read_path_hashes, write_path_hashes,
           write_path_groups, sensitive_path, outcome_status, error_type,
           duration_ms, matched_policy_count, finalized
    FROM behavior_samples
    WHERE org_id = ${orgId}
    ORDER BY ts DESC
    LIMIT ${cap}
  `;
  return rows.map((r) => ({
    event_id: r.event_id,
    ts: toIso(r.ts),
    agent_id: r.agent_id,
    session_hash: r.session_hash ?? null,
    source: r.source ?? null,
    tool: r.tool ?? null,
    tool_category: r.tool_category ?? null,
    action_type: r.action_type ?? null,
    command_shape: r.command_shape ?? null,
    bash_intent: r.bash_intent ?? null,
    risk_score: r.risk_score != null ? Number(r.risk_score) : null,
    guard_decision: r.guard_decision ?? null,
    reversible: Number(r.reversible) === 1,
    model: r.model ?? null,
    read_paths: stringList(r.read_path_hashes),
    write_paths: stringList(r.write_path_hashes),
    write_path_groups: stringList(r.write_path_groups),
    sensitive_path: Number(r.sensitive_path) === 1,
    outcome_status: r.outcome_status ?? null,
    error_type: r.error_type ?? null,
    duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    matched_policy_count: r.matched_policy_count != null ? Number(r.matched_policy_count) : null,
  }));
}

/** Count of uploaded samples for this org. */
export async function countBehaviorSamples(sql: SqlTag, orgId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count FROM behavior_samples WHERE org_id = ${orgId}
  `;
  return Number(rows[0]?.count) || 0;
}

/**
 * Opportunistic retention prune (called from ingest — the free tier has no
 * cron): delete rows older than RETENTION_DAYS, then anything beyond the
 * newest MAX_SAMPLES_PER_ORG. Returns the number of rows deleted.
 */
export async function pruneBehaviorSamples(sql: SqlTag, orgId: string): Promise<number> {
  const aged = await sql`
    DELETE FROM behavior_samples
    WHERE org_id = ${orgId} AND ts < NOW() - (${RETENTION_DAYS} * INTERVAL '1 day')
    RETURNING id
  `;
  const overflow = await sql`
    DELETE FROM behavior_samples
    WHERE org_id = ${orgId} AND id IN (
      SELECT id FROM behavior_samples
      WHERE org_id = ${orgId}
      ORDER BY ts DESC
      OFFSET ${MAX_SAMPLES_PER_ORG}
    )
    RETURNING id
  `;
  return aged.length + overflow.length;
}

/** Dismissals mapped to the local .dismissals.json record shape. */
export async function listBehaviorDismissals(sql: SqlTag, orgId: string): Promise<Record<string, unknown>[]> {
  const rows = await sql`
    SELECT signature, agent_id, type, target, reason, status, suppress_similar, ts
    FROM behavior_dismissals
    WHERE org_id = ${orgId}
    ORDER BY ts DESC
  `;
  return rows.map((r) => ({
    signature: r.signature,
    agent_id: r.agent_id ?? null,
    type: r.type ?? null,
    target: r.target ?? null,
    reason: r.reason ?? null,
    status: r.status ?? null,
    suppress_similar: Number(r.suppress_similar) === 1,
    ts: toIso(r.ts) || null,
  }));
}

interface DismissalRecord {
  signature?: string;
  agent_id?: string | null;
  type?: string | null;
  target?: string | null;
  reason?: string | null;
  status?: string | null;
  suppress_similar?: boolean;
  ts?: string;
}

/** Upsert (replace-by-signature) a dismissal / accepted-advisory record. */
export async function upsertBehaviorDismissal(
  sql: SqlTag,
  orgId: string,
  record: DismissalRecord
): Promise<void> {
  if (!record?.signature) throw new Error('upsertBehaviorDismissal: signature is required');
  await sql`
    INSERT INTO behavior_dismissals (
      org_id, signature, agent_id, type, target, reason, status, suppress_similar, ts
    ) VALUES (
      ${orgId}, ${record.signature}, ${record.agent_id || null}, ${record.type || null},
      ${record.target || null}, ${record.reason || null}, ${record.status || null},
      ${record.suppress_similar ? 1 : 0}, ${record.ts || new Date().toISOString()}
    )
    ON CONFLICT (org_id, signature) DO UPDATE SET
      agent_id = EXCLUDED.agent_id, type = EXCLUDED.type, target = EXCLUDED.target,
      reason = EXCLUDED.reason, status = EXCLUDED.status,
      suppress_similar = EXCLUDED.suppress_similar, ts = EXCLUDED.ts
  `;
}
