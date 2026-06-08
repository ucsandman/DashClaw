/**
 * Repository for signal_snapshots — the dedup fingerprints the cron signal
 * detector uses to decide which signals are NEW (worth alerting) vs already
 * seen. Extracted from app/api/cron/signals/route.ts so the route holds no
 * direct SQL (route-sql guardrail) and the per-tick snapshot upsert can batch
 * into one round-trip per chunk instead of one per signal.
 */

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// One multi-row INSERT per chunk over the Neon HTTP driver instead of one HTTP
// round-trip per signal. Mirrors reputation.repository persistEvents.
const SNAPSHOT_CHUNK = 500;

export interface SignalSnapshotInput {
  _hash: string;
  type: string;
  severity: string;
  agent_id?: string | null;
  [k: string]: unknown;
}

/**
 * Return which of `hashes` already have a snapshot for this org. Bounded by the
 * candidate set itself (signal_hash IN (...)), so the scan can never grow with
 * table size — the prior `SELECT signal_hash WHERE org_id = ...` returned every
 * snapshot the org had ever produced. The candidate set is small (it is the
 * current signal count from computeSignals), and the explicit LIMIT equal to
 * that count makes the bound visible while never truncating.
 *
 * This is exact: the caller only ever tests membership for hashes in this same
 * candidate set, so filtering to it changes nothing about the dedup result.
 */
export async function getExistingSignalHashes(
  sql: SqlClient,
  orgId: string,
  hashes: string[]
): Promise<string[]> {
  if (!hashes.length) return [];
  const placeholders = hashes.map((_, i) => `$${i + 2}`).join(', ');
  const rows = await sql.query(
    `SELECT signal_hash FROM signal_snapshots
     WHERE org_id = $1 AND signal_hash IN (${placeholders})
     LIMIT ${hashes.length}`,
    [orgId, ...hashes]
  );
  return rows.map((r) => r.signal_hash as string);
}

/**
 * Upsert every current signal snapshot in chunked multi-row INSERTs, preserving
 * the prior ON CONFLICT (org_id, signal_hash) DO UPDATE semantics (refresh
 * last_seen_at + severity; first_seen_at untouched on conflict). EXCLUDED.x is
 * exactly the value the old per-row statement interpolated, so the written rows
 * are identical.
 *
 * De-dupes by signal_hash within the input keeping the LAST occurrence: a
 * multi-row ON CONFLICT DO UPDATE errors if the same conflict key appears twice
 * in one statement, and the prior per-row loop let the last write win. Because
 * `now` is shared across the batch and first_seen_at is set on INSERT, the net
 * stored row is identical to the loop's whether or not duplicates exist (they
 * do not in practice — distinct signals hash distinctly).
 */
export async function upsertSignalSnapshots(
  sql: SqlClient,
  orgId: string,
  snapshots: SignalSnapshotInput[],
  now: string
): Promise<void> {
  if (!snapshots.length) return;

  const byHash = new Map<string, SignalSnapshotInput>();
  for (const s of snapshots) byHash.set(s._hash, s);
  const deduped = [...byHash.values()];

  for (let i = 0; i < deduped.length; i += SNAPSHOT_CHUNK) {
    const batch = deduped.slice(i, i + SNAPSHOT_CHUNK);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    batch.forEach((s, j) => {
      const b = j * 7;
      placeholders.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      params.push(orgId, s._hash, s.type, s.severity, s.agent_id || null, now, now);
    });
    await sql.query(
      `INSERT INTO signal_snapshots (org_id, signal_hash, signal_type, severity, agent_id, first_seen_at, last_seen_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (org_id, signal_hash) DO UPDATE SET
         last_seen_at = EXCLUDED.last_seen_at,
         severity = EXCLUDED.severity`,
      params
    );
  }
}
