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
 * Atomically claim which of the current signals are NEW for this org, and
 * refresh the snapshot rows for the ones that already existed — replacing the
 * old two-round-trip getExistingSignalHashes() SELECT + upsertSignalSnapshots()
 * write. That split let two overlapping cron runs (Vercel retry, manual
 * re-trigger) both SELECT before either had written, so both classified the
 * same signals as new and both fired operator notifications.
 *
 * Making the claim atomic: each chunk's INSERT ... ON CONFLICT (org_id,
 * signal_hash) DO NOTHING RETURNING signal_hash is the only statement that
 * decides "new" — only the run whose INSERT actually lands a row wins that
 * signal_hash for notification purposes. A concurrent run's INSERT for the
 * same hash conflicts, inserts nothing, and gets nothing back in RETURNING.
 * The rows that lost the INSERT race (already existed before this call) are
 * then refreshed by a second UPDATE statement per chunk, preserving the prior
 * ON CONFLICT DO UPDATE semantics: last_seen_at and severity refresh,
 * first_seen_at is left untouched.
 *
 * De-dupes by signal_hash within the input keeping the LAST occurrence, same
 * as the prior upsertSignalSnapshots — a multi-row statement errors if the
 * same conflict key appears twice, and distinct signals hash distinctly in
 * practice.
 *
 * Returns only the signal_hashes this call actually inserted (i.e. genuinely
 * new for this org) — callers must gate notifications on membership in this
 * result, not on absence from a prior SELECT.
 */
export async function claimNewSignalSnapshots(
  sql: SqlClient,
  orgId: string,
  snapshots: SignalSnapshotInput[],
  now: string
): Promise<string[]> {
  if (!snapshots.length) return [];

  const byHash = new Map<string, SignalSnapshotInput>();
  for (const s of snapshots) byHash.set(s._hash, s);
  const deduped = [...byHash.values()];

  const insertedHashes: string[] = [];

  for (let i = 0; i < deduped.length; i += SNAPSHOT_CHUNK) {
    const batch = deduped.slice(i, i + SNAPSHOT_CHUNK);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    batch.forEach((s, j) => {
      const b = j * 7;
      placeholders.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      params.push(orgId, s._hash, s.type, s.severity, s.agent_id || null, now, now);
    });
    const rows = await sql.query(
      `INSERT INTO signal_snapshots (org_id, signal_hash, signal_type, severity, agent_id, first_seen_at, last_seen_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (org_id, signal_hash) DO NOTHING
       RETURNING signal_hash`,
      params
    );
    insertedHashes.push(...rows.map((r) => r.signal_hash as string));
  }

  const insertedSet = new Set(insertedHashes);
  const toRefresh = deduped.filter((s) => !insertedSet.has(s._hash));

  for (let i = 0; i < toRefresh.length; i += SNAPSHOT_CHUNK) {
    const batch = toRefresh.slice(i, i + SNAPSHOT_CHUNK);
    const params: unknown[] = [now];
    const values: string[] = [];
    batch.forEach((s) => {
      values.push(`($${params.length + 1}, $${params.length + 2})`);
      params.push(s._hash, s.severity);
    });
    const orgIdIdx = params.length + 1;
    params.push(orgId);
    await sql.query(
      `UPDATE signal_snapshots AS s
       SET last_seen_at = $1, severity = v.severity
       FROM (VALUES ${values.join(', ')}) AS v(signal_hash, severity)
       WHERE s.org_id = $${orgIdIdx} AND s.signal_hash = v.signal_hash`,
      params
    );
  }

  return insertedHashes;
}
