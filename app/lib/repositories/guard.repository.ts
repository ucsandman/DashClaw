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
  /** Window the list + `total` to the last N days (mirrors GET /api/actions). */
  days?: number;
  limit?: number;
  offset?: number;
}

interface ListGuardDecisionsResult {
  decisions: Row[];
  total: number;
  stats: Row;
}

// Memoized at module scope (same short-TTL-cache shape as the guard hot-path
// caches, app/lib/guard/caches.ts): GET /api/guard was hitting
// information_schema on every list call to answer a question that only
// changes across a migration. A found 'reasons' column never reverts (schema
// only moves forward), so a true result is cached indefinitely; a
// not-yet-migrated false result stays on the short TTL so a live db:migrate
// is picked up without a restart.
const REASONS_COLUMN_CACHE_TTL_MS = 30_000;
let reasonsColumnCache: { value: boolean; expires: number } | null = null;

/**
 * Introspect whether the guard_decisions table uses the 'reasons' column
 * (current schema) or the legacy 'reason' column.
 */
async function hasReasonsColumn(sql: SqlQueryClient): Promise<boolean> {
  if (reasonsColumnCache && (reasonsColumnCache.value === true || reasonsColumnCache.expires > Date.now())) {
    return reasonsColumnCache.value;
  }
  const rows = await sql.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'guard_decisions' AND column_name IN ('reasons', 'reason')",
    []
  );
  const value = rows.some((r) => r.column_name === 'reasons');
  reasonsColumnCache = { value, expires: Date.now() + REASONS_COLUMN_CACHE_TTL_MS };
  return value;
}

/** Test-only: clear the memoized hasReasonsColumn() result. */
export function __resetHasReasonsColumnCache(): void {
  reasonsColumnCache = null;
}

/**
 * List guard decisions for an org with optional filters.
 */
export async function listGuardDecisions(
  sql: SqlQueryClient,
  orgId: string,
  { agentId, decision, days, limit = 20, offset = 0 }: ListGuardDecisionsOptions = {},
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
    if (days) {
      // Windows both the row list and the COUNT(*) `total`, so
      // `?decision=block&days=7` returns the true weekly denied count.
      conditions.push(`created_at::timestamptz > NOW() - INTERVAL '1 day' * $${params.push(days)}`);
    }

    const where = conditions.join(' AND ');
    // context is selected raw and _risk_breakdown lifted in JS below:
    // guard_decisions.context is a TEXT column, so `context->'...'` fails
    // (42883 text -> unknown), and a ::jsonb cast rejects contexts carrying
    // literal backslash-u0000 escapes (22P05).
    const query = `
      SELECT id, org_id, agent_id, agent_name, verification_status, replay_status, jti, act_status, act_hash, action_type, risk_score, decision, ${reasonCol}, matched_policies, created_at, context
      FROM guard_decisions
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.push(limit)}
      OFFSET $${params.push(offset)}
    `;

    const countQuery = `SELECT COUNT(*) as total FROM guard_decisions WHERE ${where}`;
    const countParams = params.slice(0, conditions.length);

    const [rawDecisions, countResult, statsRows] = await Promise.all([
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

    // Lift context._risk_breakdown to the top-level column the consumers
    // expect, and drop the raw context blob from the list payload (it was
    // never part of the list response shape).
    const decisions = (rawDecisions as Row[]).map((row) => {
      const { context, ...rest } = row;
      let breakdown: unknown = null;
      if (typeof context === 'string') {
        try { breakdown = (JSON.parse(context) as Record<string, unknown>)?._risk_breakdown ?? null; } catch { /* best-effort: malformed context JSON — no breakdown */ }
      } else if (context && typeof context === 'object') {
        breakdown = (context as Record<string, unknown>)._risk_breakdown ?? null;
      }
      return { ...rest, risk_breakdown: breakdown };
    });

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
  // created_at is TEXT on fresh drizzle-chain installs (drizzle/0000) and
  // timestamp on setup/migrate installs — the cast is the one form that
  // works on both. Bare `created_at >` raises 42883 on TEXT, the catch
  // below returns null, and idempotency silently never fires.
  // Column list is exactly what the replay response builder consumes, plus
  // `context` — SELECT * here shipped the evidence blob too (KBs per row) on
  // every hook call for nothing. `context` is NOT optional: idempotency_key is
  // ordinary client input, so the caller has to re-bind the cached verdict to
  // the request that asks for it (the stored context is the only record of
  // WHICH act was decided) before it may serve the replay.
  const columns = `id, decision, reason, risk_score, matched_policies,
              verification_status, agent_id, agent_name, created_at, context`;
  try {
    // Fast path (drizzle/0058): the key is a real column served by a partial
    // index — the previous context::jsonb->>'idempotency_key' predicate was a
    // per-row jsonb-cast seq scan over the whole window, on every hook call.
    const rows = await sql.query(
      `SELECT ${columns}
       FROM guard_decisions
       WHERE org_id = $1
         AND idempotency_key = $2
         AND created_at::timestamptz > NOW() - INTERVAL '10 minutes'
       ORDER BY created_at::timestamptz DESC
       LIMIT 1`,
      [orgId, idempotencyKey]
    );
    return rows[0] || null;
  } catch (err) {
    // 42703 = the idempotency_key column doesn't exist yet (deploy ahead of
    // migration). Fall back to the legacy jsonb-extract scan so replay
    // dedupe keeps working until db:migrate runs.
    if ((err as { code?: string }).code === '42703') {
      try {
        const rows = await sql.query(
          `SELECT ${columns}
           FROM guard_decisions
           WHERE org_id = $1
             AND created_at::timestamptz > NOW() - INTERVAL '10 minutes'
             AND context::jsonb->>'idempotency_key' = $2
           ORDER BY created_at::timestamptz DESC
           LIMIT 1`,
          [orgId, idempotencyKey]
        );
        return rows[0] || null;
      } catch (fallbackErr) {
        console.warn('[Guard] idempotency replay lookup failed (re-evaluating):', (fallbackErr as Error).message);
        return null;
      }
    }
    console.warn('[Guard] idempotency replay lookup failed (re-evaluating):', (err as Error).message);
    return null;
  }
}
