/**
 * Guard decisions repository.
 *
 * Centralises all SQL for guard_decisions, including compat shims for
 * legacy schemas that used 'reason' instead of 'reasons', and graceful
 * handling of 42P01 (table not found) on fresh self-host installs.
 *
 * Column compat + 42P01 catch ported from Elpolini's fork
 * (elpolini/DashClaw commit dbf5463).
 */

type Row = Record<string, unknown>;

/** SQL client exposing the parameterized `.query()` method (postgres driver shape). */
interface SqlQueryClient {
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
}

interface ListGuardDecisionsOptions {
  agentId?: string;
  decision?: string;
  limit?: number;
  offset?: number;
}

interface ListGuardDecisionsResult {
  decisions: Row[];
  total: number;
  stats: Row;
}

/**
 * Introspect whether the guard_decisions table uses the 'reasons' column
 * (current schema) or the legacy 'reason' column.
 */
async function hasReasonsColumn(sql: SqlQueryClient): Promise<boolean> {
  const rows = await sql.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'guard_decisions' AND column_name IN ('reasons', 'reason')",
    []
  );
  return rows.some((r) => r.column_name === 'reasons');
}

/**
 * List guard decisions for an org with optional filters.
 */
export async function listGuardDecisions(
  sql: SqlQueryClient,
  orgId: string,
  { agentId, decision, limit = 20, offset = 0 }: ListGuardDecisionsOptions = {},
): Promise<ListGuardDecisionsResult> {
  try {
    const useReasons = await hasReasonsColumn(sql);
    const reasonCol = useReasons ? 'reasons' : 'reason AS reasons';

    const conditions = ['org_id = $1'];
    const params: unknown[] = [orgId];

    if (agentId) {
      conditions.push(`agent_id = $${params.push(agentId)}`);
    }
    if (decision) {
      conditions.push(`decision = $${params.push(decision)}`);
    }

    const where = conditions.join(' AND ');
    const query = `
      SELECT id, org_id, agent_id, agent_name, verification_status, replay_status, jti, act_status, act_hash, action_type, risk_score, decision, ${reasonCol}, matched_policies, created_at,
             context->'_risk_breakdown' AS risk_breakdown
      FROM guard_decisions
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.push(limit)}
      OFFSET $${params.push(offset)}
    `;

    const countQuery = `SELECT COUNT(*) as total FROM guard_decisions WHERE ${where}`;
    const countParams = params.slice(0, conditions.length);

    const [decisions, countResult, statsRows] = await Promise.all([
      sql.query(query, params),
      sql.query(countQuery, countParams),
      sql.query(
        `SELECT
          COUNT(*) as total_24h,
          COUNT(*) FILTER (WHERE decision = 'block') as blocks_24h,
          COUNT(*) FILTER (WHERE decision = 'warn') as warns_24h,
          COUNT(*) FILTER (WHERE decision = 'require_approval') as approvals_24h
        FROM guard_decisions
        WHERE org_id = $1
          AND created_at::timestamptz > NOW() - INTERVAL '24 hours'`,
        [orgId]
      ),
    ]);

    return {
      decisions,
      total: parseInt((countResult[0]?.total as string) || '0', 10),
      stats: (statsRows[0] as Row) || {},
    };
  } catch (err) {
    // 42P01 = table not found — fresh self-host install before migration has run.
    // Return empty results instead of crashing the dashboard.
    if ((err as { code?: string }).code === '42P01') {
      return {
        decisions: [],
        total: 0,
        stats: { total_24h: 0, blocks_24h: 0, warns_24h: 0, approvals_24h: 0 },
      };
    }
    throw err;
  }
}

/**
 * Look up a recent guard decision by idempotency key (Organ 3 Phase 3).
 *
 * Replay short-circuiting exists to absorb blind client retries (seconds
 * apart), not to cache decisions against policy changes — hence the
 * 10-minute bound. `context` is a text column holding JSON, so the key is
 * matched via a per-row jsonb cast inside the bounded window. Fails open:
 * a lookup error means a replay miss, and the caller re-evaluates — the
 * pre-idempotency behavior.
 */
/**
 * True when the decision id exists in this org. Validates client-supplied
 * guard_decision_id stamps on POST /api/actions so tuning evidence cannot be
 * pointed at foreign or nonexistent decisions (2026-07-01 security review).
 */
export async function guardDecisionExists(
  sql: SqlQueryClient,
  orgId: string,
  decisionId: string,
): Promise<boolean> {
  const rows = await sql.query(
    `SELECT 1 FROM guard_decisions WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, decisionId],
  );
  return rows.length > 0;
}

export async function getGuardDecisionByIdempotencyKey(
  sql: SqlQueryClient,
  orgId: string,
  idempotencyKey: string | null | undefined,
): Promise<Row | null> {
  if (!idempotencyKey) return null;
  try {
    const rows = await sql.query(
      `SELECT * FROM guard_decisions
       WHERE org_id = $1
         AND created_at > NOW() - INTERVAL '10 minutes'
         AND context::jsonb->>'idempotency_key' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [orgId, idempotencyKey]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn('[Guard] idempotency replay lookup failed (re-evaluating):', (err as Error).message);
    return null;
  }
}
