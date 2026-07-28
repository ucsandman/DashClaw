import crypto from 'crypto';
import type { SqlTag } from '../types/db';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeJsonParse(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

interface ArtifactRow {
  artifact_id: unknown;
  org_id: unknown;
  artifact_type: unknown;
  name: unknown;
  description?: unknown;
  content_json?: unknown;
  content_url?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  source_action_id?: unknown;
  source_step_id?: unknown;
  source_agent_id?: unknown;
  retention_days?: unknown;
  tags_json?: unknown;
  metadata_json?: unknown;
  created_at: unknown;
  updated_at: unknown;
  [k: string]: unknown;
}

interface ArtifactInput {
  artifact_type?: unknown;
  name?: unknown;
  description?: unknown;
  content_json?: unknown;
  content_url?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  source_action_id?: unknown;
  source_step_id?: unknown;
  source_agent_id?: unknown;
  retention_days?: unknown;
  tags?: unknown;
  metadata?: unknown;
  [k: string]: unknown;
}

interface ArtifactFilters {
  action_id?: unknown;
  step_id?: unknown;
  agent_id?: unknown;
  artifact_type?: unknown;
  limit?: number | string;
  offset?: number | string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape helpers
// ─────────────────────────────────────────────────────────────────────────────

export function shapeArtifact(row: ArtifactRow | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    artifact_id: row.artifact_id,
    org_id: row.org_id,
    artifact_type: row.artifact_type,
    name: row.name,
    description: row.description || null,
    content: safeJsonParse(row.content_json),
    content_url: row.content_url || null,
    mime_type: row.mime_type || null,
    size_bytes: row.size_bytes || null,
    source_action_id: row.source_action_id || null,
    source_step_id: row.source_step_id || null,
    source_agent_id: row.source_agent_id || null,
    retention_days: row.retention_days || null,
    tags: safeJsonParse(row.tags_json) || [],
    metadata: safeJsonParse(row.metadata_json) || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createArtifact(
  sql: SqlTag,
  orgId: string,
  data: ArtifactInput,
): Promise<Record<string, unknown> | null> {
  const artifactId = `art_${crypto.randomUUID()}`;
  const rows = await sql`
    INSERT INTO artifacts (
      artifact_id, org_id, artifact_type, name, description,
      content_json, content_url, mime_type, size_bytes,
      source_action_id, source_step_id, source_agent_id,
      retention_days, tags_json, metadata_json
    ) VALUES (
      ${artifactId}, ${orgId}, ${data.artifact_type}, ${data.name}, ${data.description || null},
      ${data.content_json ? (typeof data.content_json === 'string' ? data.content_json : JSON.stringify(data.content_json)) : null},
      ${data.content_url || null}, ${data.mime_type || null}, ${data.size_bytes || null},
      ${data.source_action_id || null}, ${data.source_step_id || null}, ${data.source_agent_id || null},
      ${data.retention_days || null},
      ${JSON.stringify(data.tags || [])},
      ${JSON.stringify(data.metadata || {})}
    )
    RETURNING *
  `;
  return shapeArtifact(rows[0] as ArtifactRow | undefined);
}

export async function listArtifacts(
  sql: SqlTag,
  orgId: string,
  filters: ArtifactFilters = {},
): Promise<{ artifacts: Array<Record<string, unknown> | null>; total: number }> {
  const { action_id, step_id, agent_id, artifact_type, limit = 50, offset = 0 } = filters;
  const parsedLimit = Math.min(parseInt(String(limit), 10) || 50, 200);
  const parsedOffset = parseInt(String(offset), 10) || 0;

  const rows = await sql`
    SELECT * FROM artifacts
    WHERE org_id = ${orgId}
      ${action_id ? sql`AND source_action_id = ${action_id}` : sql``}
      ${step_id ? sql`AND source_step_id = ${step_id}` : sql``}
      ${agent_id ? sql`AND source_agent_id = ${agent_id}` : sql``}
      ${artifact_type ? sql`AND artifact_type = ${artifact_type}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${parsedLimit}
    OFFSET ${parsedOffset}
  `;

  const countRows = await sql`
    SELECT COUNT(*)::int AS total FROM artifacts
    WHERE org_id = ${orgId}
      ${action_id ? sql`AND source_action_id = ${action_id}` : sql``}
      ${step_id ? sql`AND source_step_id = ${step_id}` : sql``}
      ${agent_id ? sql`AND source_agent_id = ${agent_id}` : sql``}
      ${artifact_type ? sql`AND artifact_type = ${artifact_type}` : sql``}
  `;

  return {
    artifacts: rows.map((r) => shapeArtifact(r as ArtifactRow)),
    total: (countRows[0]?.total as number | undefined) || 0,
  };
}

/**
 * Newest 'patch' artifact per action, reduced to its evidence ref — one query
 * for the whole /approvals containment list instead of one artifact fetch per
 * card. A key is present only when a patch artifact exists for that action;
 * ref is null when the artifact predates ref capture (content has no ref).
 */
export async function getLatestPatchRefs(
  sql: SqlTag,
  orgId: string,
  actionIds: string[],
): Promise<Record<string, { ref: string | null }>> {
  if (actionIds.length === 0) return {};
  const rows = await sql.query(
    `SELECT DISTINCT ON (source_action_id) source_action_id, content_json
     FROM artifacts
     WHERE org_id = $1 AND artifact_type = 'patch' AND source_action_id = ANY($2)
     ORDER BY source_action_id, created_at DESC`,
    [orgId, actionIds],
  );
  const out: Record<string, { ref: string | null }> = {};
  for (const row of rows) {
    const content = safeJsonParse(row.content_json) as { ref?: unknown } | null;
    out[String(row.source_action_id)] = {
      ref: content && typeof content.ref === 'string' ? content.ref : null,
    };
  }
  return out;
}

export async function getArtifact(
  sql: SqlTag,
  orgId: string,
  artifactId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT * FROM artifacts
    WHERE org_id = ${orgId} AND artifact_id = ${artifactId}
    LIMIT 1
  `;
  return shapeArtifact((rows[0] as ArtifactRow | undefined) || null);
}

export async function deleteArtifact(
  sql: SqlTag,
  orgId: string,
  artifactId: string,
): Promise<{ deleted: boolean } | null> {
  const rows = await sql`
    DELETE FROM artifacts
    WHERE org_id = ${orgId} AND artifact_id = ${artifactId}
    RETURNING artifact_id
  `;
  return rows.length > 0 ? { deleted: true } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence bundle builder
// ─────────────────────────────────────────────────────────────────────────────

export async function buildEvidenceBundle(
  sql: SqlTag,
  orgId: string,
  actionId: string,
): Promise<Record<string, unknown> | null> {
  // Load action
  const actionRows = await sql`
    SELECT action_id, status, agent_id, declared_goal, action_type,
           risk_score, reasoning, output_summary, error_message,
           timestamp_start, timestamp_end, duration_ms
    FROM action_records
    WHERE org_id = ${orgId} AND action_id = ${actionId}
    LIMIT 1
  `;
  if (actionRows.length === 0) return null;

  const action = actionRows[0] as Record<string, unknown>;

  // Load child steps
  const stepRows = await sql`
    SELECT action_id, action_type, status, declared_goal, output_summary, error_message, duration_ms
    FROM action_records
    WHERE org_id = ${orgId} AND parent_action_id = ${actionId}
    ORDER BY timestamp_start ASC
  `;

  // Load linked artifacts
  const artifactRows = await sql`
    SELECT * FROM artifacts
    WHERE org_id = ${orgId} AND source_action_id = ${actionId}
    ORDER BY created_at ASC
  `;

  return {
    artifact_type: 'evidence_bundle',
    action: {
      action_id: action.action_id,
      status: action.status,
      agent_id: action.agent_id,
      declared_goal: action.declared_goal,
      action_type: action.action_type,
      risk_score: action.risk_score,
      output_summary: action.output_summary,
      error_message: action.error_message,
      duration_ms: action.duration_ms,
      started_at: action.timestamp_start,
      finished_at: action.timestamp_end,
    },
    steps: stepRows.map((s) => ({
      action_id: s.action_id,
      action_type: s.action_type,
      status: s.status,
      declared_goal: s.declared_goal,
      output_summary: s.output_summary,
      error_message: s.error_message,
      duration_ms: s.duration_ms,
    })),
    artifacts: artifactRows.map((r) => shapeArtifact(r as ArtifactRow)),
    generated_at: new Date().toISOString(),
  };
}
