import crypto from 'node:crypto';
import { generateApiKey as mintApiKey, hashKey } from '../api-keys';
import { seedCatastrophePack } from '../setup/catastrophe-pack.mjs';
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../calibration-mining.js';
import { BROWSER_FIRST_ACTION_AGENT_ID } from '../hosted/browser-action.js';
import type { SqlTag } from '../types/db';
import {
  invalidateGuardPolicyCache,
  invalidateGuardRiskTemplateCache,
  invalidateGuardSettingsCache,
  invalidateGuardCalibrationCache,
} from '../guard/caches';

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function generateApiKey(): { plaintext: string; keyHash: string; keyPrefix: string } {
  const plaintext = mintApiKey();
  const keyHash = hashKey(plaintext);
  const keyPrefix = plaintext.slice(0, 8);
  return { plaintext, keyHash, keyPrefix };
}

export async function mintOrgApiKey(
  sql: SqlTag,
  orgId: string,
  { label = 'trial', role = 'admin', scope = 'trial' }: { label?: string; role?: string; scope?: string } = {},
): Promise<{ apiKey: string; keyPrefix: string }> {
  const keyId = generateId('key');
  const key = generateApiKey();
  await sql`
    INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role, scope)
    VALUES (${keyId}, ${orgId}, ${key.keyHash}, ${key.keyPrefix}, ${label}, ${role}, ${scope})
  `;
  return { apiKey: key.plaintext, keyPrefix: key.keyPrefix };
}

export async function applyHostedTrial(
  sql: SqlTag,
  orgId: string,
  { trialDays, trialActionCap }: { trialDays: number; trialActionCap: number },
): Promise<{ expiresAt: string }> {
  const expiresAt = new Date(Date.now() + trialDays * 86_400_000).toISOString();
  await sql`
    UPDATE organizations
    SET hosted_mode = TRUE, trial_ends_at = ${expiresAt}, trial_action_cap = ${trialActionCap}, trial_actions_used = 0
    WHERE id = ${orgId}
  `;
  return { expiresAt };
}

export async function markTrialFull(sql: SqlTag, orgId: string): Promise<void> {
  const past = new Date().toISOString();
  await sql`
    UPDATE organizations
    SET hosted_mode = TRUE, trial_ends_at = ${past}, trial_action_cap = 0, trial_actions_used = 0
    WHERE id = ${orgId}
  `;
}

export async function countActiveTrials(
  sql: SqlTag,
  { now = new Date() }: { now?: Date } = {},
): Promise<number> {
  const cutoff = now.toISOString();
  const rows = await sql`
    SELECT COUNT(*)::int AS count FROM organizations
    WHERE hosted_mode = TRUE AND trial_action_cap > 0 AND trial_ends_at > ${cutoff}
  `;
  return Number(rows[0]?.count || 0);
}

export async function provisionHostedWorkspace(
  sql: SqlTag,
  {
    trialDays,
    trialActionCap,
    label = 'trial',
    mintSource = null,
    mintSourceRaw = null,
  }: {
    trialDays: number;
    trialActionCap: number;
    label?: string;
    /** v6.4 reach attribution: resolved channel label + sanitized raw strings. One write, never updated. */
    mintSource?: string | null;
    mintSourceRaw?: Record<string, string> | null;
  },
): Promise<{ orgId: string; apiKey: string; keyPrefix: string; expiresAt: string }> {
  const orgId = generateId('org');
  const slug = `trial-${orgId.slice(4, 12)}`;
  const expiresAt = new Date(Date.now() + trialDays * 86_400_000).toISOString();

  await sql`
    INSERT INTO organizations (id, name, slug, plan, hosted_mode, trial_ends_at, trial_action_cap, trial_actions_used, trial_mint_source, trial_mint_source_raw)
    VALUES (${orgId}, ${'Trial workspace'}, ${slug}, ${'free'}, TRUE, ${expiresAt}, ${trialActionCap}, 0, ${mintSource}, ${mintSourceRaw === null ? null : JSON.stringify(mintSourceRaw)})
  `;
  try {
    const { apiKey, keyPrefix } = await mintOrgApiKey(sql, orgId, { label });

    // Seed the Short List (catastrophe-only pack) so the first governed
    // session feels governed (a fresh org with zero policies allows
    // everything). Failure logs loudly but never fails provisioning — a
    // workspace without policies beats a 500.
    try {
      await seedCatastrophePack(sql, orgId);
    } catch (err) {
      console.error(`[HOSTED] short-list seeding failed for ${orgId}:`, (err as Error).message);
    }

    return { orgId, apiKey, keyPrefix, expiresAt };
  } catch (err) {
    // Best-effort cleanup — prevents orphaned trial orgs when key insert fails.
    // If this also fails, the sweep job will collect it once trial_ends_at passes.
    await sql`DELETE FROM organizations WHERE id = ${orgId} AND hosted_mode = TRUE`.catch((cleanupErr) =>
      console.error(`[HOSTED] Cleanup failed for orphan org ${orgId}:`, (cleanupErr as Error)?.message),
    );
    throw err;
  }
}

export async function getHostedWorkspace(
  sql: SqlTag,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT id, name, hosted_mode, trial_ends_at, trial_action_cap, trial_actions_used
    FROM organizations
    WHERE id = ${orgId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  if (!r) return null;
  return {
    orgId: r.id,
    name: r.name,
    hostedMode: r.hosted_mode,
    trialEndsAt: r.trial_ends_at,
    trialActionCap: r.trial_action_cap,
    trialActionsUsed: r.trial_actions_used,
  };
}

export async function deleteHostedWorkspace(
  sql: SqlTag,
  orgId: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const existing = await sql`
    SELECT hosted_mode, claimed_at FROM organizations WHERE id = ${orgId} LIMIT 1
  `;
  if (existing.length === 0) return { deleted: false, reason: 'not_found' };
  if (!existing[0]?.hosted_mode) {
    throw new Error(`org ${orgId} is not a hosted trial workspace — refusing to delete`);
  }
  // v5.13: a claimed org is owned. Claiming clears trial_ends_at so the sweep
  // never selects it, but this guard must hold even for a direct call.
  if (existing[0]?.claimed_at) {
    throw new Error(`org ${orgId} has been claimed by a user — refusing to delete`);
  }
  // Revoke first so the workspace is dead immediately even if a later step fails.
  await sql`UPDATE api_keys SET revoked_at = NOW() WHERE org_id = ${orgId} AND revoked_at IS NULL`;

  // v4.6 funnel truth: freeze this trial's funnel milestones BEFORE the FK
  // child sweep destroys the evidence. REQUIRED, not best-effort — a failed
  // snapshot throws and aborts the delete (the cleanup sweep retries next
  // run); a best-effort write would silently recreate the survivorship bias
  // this table exists to prevent. Keys are already revoked, so the workspace
  // stays dead either way.
  await snapshotTrialFunnelFacts(sql, orgId);

  // Most org FKs predate cascade rules (32 of 47 are NO ACTION), and every org
  // has at least its api_keys row, so a bare DELETE FROM organizations always
  // failed with 23503 once the trial saw any activity. Discover the referencing
  // tables from the catalog (so new tables can't silently break cleanup) and
  // delete child rows first; the retry passes resolve child-of-child FK
  // ordering without hardcoding the dependency graph.
  const children = await sql`
    SELECT DISTINCT tc.table_name AS table_name, kcu.column_name AS column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'organizations'
      AND tc.table_name <> 'organizations'
  `;
  const isSafeIdent = (s: unknown): s is string => typeof s === 'string' && /^[a-z0-9_]+$/i.test(s);
  let pending = children.filter((c) => isSafeIdent(c.table_name) && isSafeIdent(c.column_name));
  for (let pass = 0; pass < 5 && pending.length > 0; pass += 1) {
    const failed: typeof pending = [];
    for (const child of pending) {
      try {
        await sql.query(
          `DELETE FROM "${child.table_name}" WHERE "${child.column_name}" = $1`,
          [orgId],
        );
      } catch {
        // FK ordering: a child of another child — retry on the next pass.
        failed.push(child);
      }
    }
    if (failed.length === pending.length) break; // no progress; let the org delete surface the real error
    pending = failed;
  }
  await sql`DELETE FROM organizations WHERE id = ${orgId} AND hosted_mode = TRUE`;
  // A deleted org's warm-instance guard caches otherwise ride out their TTL
  // (up to 30s) instead of clearing immediately, and never clear at all if
  // this org is never evaluated again — same six caches the size-capped
  // sweep in guard/caches.ts bounds for orgs nobody explicitly deletes.
  invalidateGuardPolicyCache(orgId);
  invalidateGuardRiskTemplateCache(orgId);
  invalidateGuardSettingsCache(orgId);
  invalidateGuardCalibrationCache(orgId);
  return { deleted: true };
}

export async function findExpiredWorkspaces(
  sql: SqlTag,
  { now = new Date(), limit = 100 }: { now?: Date; limit?: number } = {},
): Promise<unknown[]> {
  const cutoff = now.toISOString();
  const rows = await sql`
    SELECT id FROM organizations
    WHERE hosted_mode = TRUE
      AND claimed_at IS NULL
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at < ${cutoff}
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

// ── v4.6 funnel truth ───────────────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-07-05-funnel-truth-design.md

const WEEK_MS = 7 * 86_400_000;

export type TrialFunnelFacts = {
  orgId: string;
  mintedAtMs: number;
  keyUsed: boolean;
  firstActionAtMs: number | null;
  lastActionAtMs: number | null;
  actionCount: number;
  /** Frozen at deletion time on archived rows; null on live rows (computed on read). */
  frozenRetainedWeek1: boolean | null;
  archived: boolean;
  // v5.3 sharpened facts. All nullable: NULL = unknown (pre-v5.3 evidence),
  // never guessed — first_used_at is not backfilled and visit stamps only
  // exist since trial sessions started stamping.
  firstKeyUsedAtMs: number | null;
  firstSeenAtMs: number | null;
  lastSeenAtMs: number | null;
  /** v6.4 channel label captured at mint; null = pre-v6.4 mint (unknown, never guessed). */
  mintSource: string | null;
  /** Which door the first governed action came through; null when unknown or no action. */
  firstActionVia: 'browser' | 'agent' | null;
  /** v7.2: first workspace export (graduation). NULL = never exported / pre-v7.2 unknown. */
  graduatedAtMs: number | null;
};

/** 'browser' | 'agent' | null from a raw agent id, given the org acted at all. */
function firstActionViaFromAgentId(agentId: unknown, acted: boolean): 'browser' | 'agent' | null {
  if (!acted) return null;
  return agentId === BROWSER_FIRST_ACTION_AGENT_ID ? 'browser' : 'agent';
}

function toMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Funnel facts for live trial orgs (all when orgId is null, one otherwise).
 * A mint = hosted_mode AND trial_action_cap > 0 — cap-0 rows are
 * markTrialFull capacity placeholders that can never act, not mints.
 * Timestamps come back as epoch ms (float8): pg text timestamps are not
 * safely Date.parse-able, and guard_decisions.created_at is TEXT on fresh
 * schemas — hence the ::timestamptz casts.
 */
export async function queryLiveTrialFacts(
  sql: SqlTag,
  orgId: string | null,
): Promise<TrialFunnelFacts[]> {
  const rows = await sql`
    SELECT
      o.id AS org_id,
      (EXTRACT(EPOCH FROM COALESCE(o.created_at, NOW())::timestamptz) * 1000)::float8 AS minted_at_ms,
      EXISTS(
        SELECT 1 FROM api_keys k
        WHERE k.org_id = o.id AND k.last_used_at IS NOT NULL
      ) AS key_used,
      (SELECT (EXTRACT(EPOCH FROM MIN(k.first_used_at::timestamptz)) * 1000)::float8
         FROM api_keys k
         WHERE k.org_id = o.id AND k.first_used_at IS NOT NULL) AS first_key_used_at_ms,
      (EXTRACT(EPOCH FROM o.trial_first_seen_at) * 1000)::float8 AS first_seen_at_ms,
      (EXTRACT(EPOCH FROM o.trial_last_seen_at) * 1000)::float8 AS last_seen_at_ms,
      o.trial_mint_source AS mint_source,
      (EXTRACT(EPOCH FROM o.trial_exported_at) * 1000)::float8 AS exported_at_ms,
      (EXTRACT(EPOCH FROM activity.first_action_at) * 1000)::float8 AS first_action_at_ms,
      (EXTRACT(EPOCH FROM activity.last_action_at) * 1000)::float8 AS last_action_at_ms,
      activity.first_action_agent_id,
      COALESCE(activity.action_count, 0)::int AS action_count
    FROM organizations o
    LEFT JOIN LATERAL (
      SELECT MIN(ts) AS first_action_at, MAX(ts) AS last_action_at, COUNT(*)::int AS action_count,
             (ARRAY_AGG(agent_id ORDER BY ts))[1] AS first_action_agent_id
      FROM (
        SELECT gd.created_at::timestamptz AS ts, gd.agent_id AS agent_id
        FROM guard_decisions gd
        WHERE gd.org_id = o.id
          AND (gd.action_type IS NULL OR gd.action_type NOT LIKE ALL(${SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS}::text[]))
          AND (gd.agent_id IS NULL OR gd.agent_id NOT LIKE ALL(${SYNTHETIC_AGENT_LIKE_PATTERNS}::text[]))
        UNION ALL
        SELECT ar.created_at::timestamptz AS ts, ar.agent_id AS agent_id
        FROM action_records ar
        WHERE ar.org_id = o.id
          AND (ar.action_type IS NULL OR ar.action_type NOT LIKE ALL(${SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS}::text[]))
          AND (ar.agent_id IS NULL OR ar.agent_id NOT LIKE ALL(${SYNTHETIC_AGENT_LIKE_PATTERNS}::text[]))
      ) evts
    ) activity ON TRUE
    WHERE o.hosted_mode = TRUE
      AND o.trial_action_cap > 0
      AND (${orgId}::text IS NULL OR o.id = ${orgId})
  `;
  return rows.map((r) => {
    const firstActionAtMs = toMs(r.first_action_at_ms);
    return {
      orgId: String(r.org_id),
      mintedAtMs: toMs(r.minted_at_ms) ?? 0,
      keyUsed: r.key_used === true,
      firstActionAtMs,
      lastActionAtMs: toMs(r.last_action_at_ms),
      actionCount: Number(r.action_count) || 0,
      frozenRetainedWeek1: null,
      archived: false,
      firstKeyUsedAtMs: toMs(r.first_key_used_at_ms),
      firstSeenAtMs: toMs(r.first_seen_at_ms),
      lastSeenAtMs: toMs(r.last_seen_at_ms),
      mintSource: typeof r.mint_source === 'string' && r.mint_source.length > 0 ? r.mint_source : null,
      firstActionVia: firstActionViaFromAgentId(r.first_action_agent_id, firstActionAtMs !== null),
      graduatedAtMs: toMs(r.exported_at_ms),
    };
  });
}

/**
 * Freeze a trial's funnel milestones before deletion destroys the evidence.
 * Returns snapshotted:false for cap-0 capacity placeholders (not mints).
 * Idempotent (ON CONFLICT DO NOTHING) so cleanup retries are safe.
 */
export async function snapshotTrialFunnelFacts(
  sql: SqlTag,
  orgId: string,
): Promise<{ snapshotted: boolean }> {
  const facts = await queryLiveTrialFacts(sql, orgId);
  const f = facts[0];
  if (!f) return { snapshotted: false };
  const retainedWeek1 =
    f.lastActionAtMs !== null && f.lastActionAtMs - f.mintedAtMs >= WEEK_MS;
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  // v6.4: freeze the raw source strings alongside the label — the org row
  // (and its raw evidence) is about to be deleted.
  const rawRows = await sql`
    SELECT trial_mint_source_raw AS raw FROM organizations WHERE id = ${orgId} LIMIT 1
  `;
  const mintSourceRaw = rawRows[0]?.raw ?? null;
  await sql`
    INSERT INTO hosted_trial_snapshots
      (org_id, minted_at, key_used, first_action_at, last_action_at, action_count, retained_week1,
       first_key_used_at, first_seen_at, last_seen_at, first_action_via, mint_source, mint_source_raw,
       exported_at)
    VALUES (
      ${orgId},
      to_timestamp(${f.mintedAtMs} / 1000.0),
      ${f.keyUsed},
      ${iso(f.firstActionAtMs)},
      ${iso(f.lastActionAtMs)},
      ${f.actionCount},
      ${retainedWeek1},
      ${iso(f.firstKeyUsedAtMs)},
      ${iso(f.firstSeenAtMs)},
      ${iso(f.lastSeenAtMs)},
      ${f.firstActionVia},
      ${f.mintSource},
      ${mintSourceRaw === null ? null : JSON.stringify(mintSourceRaw)},
      ${iso(f.graduatedAtMs)}
    )
    ON CONFLICT (org_id) DO NOTHING
  `;
  return { snapshotted: true };
}

export type TrialFunnelCounts = {
  minted: number;
  keyUsed: number;
  firstAction: number;
  retainedWeek1: number;
  week1Eligible: number;
};

// v5.3 annotations — sharpened distinctions rendered UNDER the funnel, never
// new steps. Unknowns (pre-v5.3 NULLs) count in no bucket.
export type TrialFunnelAnnotations = {
  /** Seen again more than RETURN_GAP_MS after mint — one sitting is not a return. */
  returned: number;
  /** Returned, but never used the key and never acted. */
  returnedNeverConnected: number;
  medianHoursToFirstKeyUse: number | null;
  /** Which door activated orgs came through; unknowns in neither bucket. */
  firstActionVia: { browser: number; agent: number };
  /**
   * v7.2 graduation: orgs that took their record out (first workspace
   * export). An annotation under the funnel, not a new step; truthful
   * zeros; pre-v7.2 NULLs count nowhere.
   */
  graduated: number;
  /**
   * v6.4 reach attribution: per-channel mints + first actions, minted-desc.
   * 'direct' = captured with no referrer/UTM; 'unknown' = pre-v6.4 mint
   * (never guessed); labels beyond the top ten roll up into 'other' (labels
   * are attacker-mintable strings on a public route). Truthful zeros: a
   * source with mints and no first actions renders exactly that.
   */
  bySource: Array<{ source: string; minted: number; firstAction: number }>;
};

/** Top-N cap before 'other' rollup on the public per-source annotation. */
export const SOURCE_ROLLUP_CAP = 10;

export type TrialFunnel = {
  computedAt: string;
  funnel: TrialFunnelCounts & { week1Pending: number };
  medianHoursToFirstAction: number | null;
  annotations: TrialFunnelAnnotations;
  cohorts: Array<TrialFunnelCounts & { weekStart: string }>;
  source: { live: number; archived: number; truthfulSince: string | null };
};

/** A visit that starts more than this after mint counts as a return, not the mint sitting. */
export const RETURN_GAP_MS = 60 * 60 * 1000;

function weekStartUtc(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
    .toISOString()
    .slice(0, 10);
}

/**
 * Pure funnel math over merged live + archived facts. Truthful zeros: an
 * org younger than 7 days is week1Pending, never counted as not-retained.
 * Archived rows use the retained_week1 boolean frozen at deletion time.
 */
export function computeFunnelAggregates(facts: TrialFunnelFacts[], now: Date): TrialFunnel {
  const nowMs = now.getTime();
  const isEligible = (f: TrialFunnelFacts) => nowMs - f.mintedAtMs >= WEEK_MS;
  const isRetained = (f: TrialFunnelFacts) =>
    f.archived
      ? f.frozenRetainedWeek1 === true
      : isEligible(f) && f.lastActionAtMs !== null && f.lastActionAtMs - f.mintedAtMs >= WEEK_MS;
  const count = (list: TrialFunnelFacts[]): TrialFunnelCounts => ({
    minted: list.length,
    keyUsed: list.filter((f) => f.keyUsed).length,
    firstAction: list.filter((f) => f.firstActionAtMs !== null).length,
    retainedWeek1: list.filter(isRetained).length,
    week1Eligible: list.filter(isEligible).length,
  });

  const overall = count(facts);
  const medianHoursSinceMint = (getMs: (f: TrialFunnelFacts) => number | null): number | null => {
    const deltas = facts
      .map((f) => {
        const ms = getMs(f);
        return ms === null ? null : (ms - f.mintedAtMs) / 3_600_000;
      })
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b);
    if (deltas.length === 0) return null;
    const raw =
      deltas.length % 2 === 1
        ? deltas[(deltas.length - 1) / 2]!
        : (deltas[deltas.length / 2 - 1]! + deltas[deltas.length / 2]!) / 2;
    return Math.round(raw * 10) / 10;
  };
  const median = medianHoursSinceMint((f) => f.firstActionAtMs);

  // v5.3 annotations. "Returned" needs a positive seen-stamp beyond the mint
  // sitting; NULL stamps (pre-v5.3 mints, archived unknowns) are unknown and
  // count nowhere — truthful zeros, never guessed.
  const isReturned = (f: TrialFunnelFacts) =>
    f.lastSeenAtMs !== null && f.lastSeenAtMs - f.mintedAtMs > RETURN_GAP_MS;
  // v6.4: per-channel resolution. Aggregate by label, top-N + 'other' rollup;
  // null labels (pre-v6.4 mints) are an explicit 'unknown' bucket.
  const bySourceMap = new Map<string, { minted: number; firstAction: number }>();
  for (const f of facts) {
    const label = f.mintSource ?? 'unknown';
    const entry = bySourceMap.get(label) ?? { minted: 0, firstAction: 0 };
    entry.minted += 1;
    if (f.firstActionAtMs !== null) entry.firstAction += 1;
    bySourceMap.set(label, entry);
  }
  const bySourceAll = [...bySourceMap.entries()]
    .map(([source, counts]) => ({ source, ...counts }))
    .sort((a, b) => b.minted - a.minted || (a.source < b.source ? -1 : 1));
  const bySource = bySourceAll.slice(0, SOURCE_ROLLUP_CAP);
  const overflow = bySourceAll.slice(SOURCE_ROLLUP_CAP);
  if (overflow.length > 0) {
    bySource.push({
      source: 'other',
      minted: overflow.reduce((n, s) => n + s.minted, 0),
      firstAction: overflow.reduce((n, s) => n + s.firstAction, 0),
    });
  }

  const annotations: TrialFunnelAnnotations = {
    returned: facts.filter(isReturned).length,
    returnedNeverConnected: facts.filter(
      (f) => isReturned(f) && !f.keyUsed && f.firstActionAtMs === null,
    ).length,
    medianHoursToFirstKeyUse: medianHoursSinceMint((f) => f.firstKeyUsedAtMs),
    firstActionVia: {
      browser: facts.filter((f) => f.firstActionVia === 'browser').length,
      agent: facts.filter((f) => f.firstActionVia === 'agent').length,
    },
    graduated: facts.filter((f) => f.graduatedAtMs !== null).length,
    bySource,
  };

  const byWeek = new Map<string, TrialFunnelFacts[]>();
  for (const f of facts) {
    const ws = weekStartUtc(f.mintedAtMs);
    const list = byWeek.get(ws) ?? [];
    list.push(f);
    byWeek.set(ws, list);
  }
  const cohorts = [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 8)
    .map(([weekStart, list]) => ({ weekStart, ...count(list) }));

  return {
    computedAt: now.toISOString(),
    funnel: { ...overall, week1Pending: overall.minted - overall.week1Eligible },
    medianHoursToFirstAction: median,
    annotations,
    cohorts,
    source: {
      live: facts.filter((f) => !f.archived).length,
      archived: facts.filter((f) => f.archived).length,
      truthfulSince: facts.length
        ? new Date(Math.min(...facts.map((f) => f.mintedAtMs))).toISOString()
        : null,
    },
  };
}

async function querySnapshotFacts(sql: SqlTag): Promise<TrialFunnelFacts[]> {
  const rows = await sql`
    SELECT
      org_id,
      (EXTRACT(EPOCH FROM minted_at) * 1000)::float8 AS minted_at_ms,
      key_used,
      (EXTRACT(EPOCH FROM first_action_at) * 1000)::float8 AS first_action_at_ms,
      (EXTRACT(EPOCH FROM last_action_at) * 1000)::float8 AS last_action_at_ms,
      action_count,
      retained_week1,
      (EXTRACT(EPOCH FROM first_key_used_at) * 1000)::float8 AS first_key_used_at_ms,
      (EXTRACT(EPOCH FROM first_seen_at) * 1000)::float8 AS first_seen_at_ms,
      (EXTRACT(EPOCH FROM last_seen_at) * 1000)::float8 AS last_seen_at_ms,
      first_action_via,
      mint_source,
      (EXTRACT(EPOCH FROM exported_at) * 1000)::float8 AS exported_at_ms
    FROM hosted_trial_snapshots
  `;
  return rows.map((r) => ({
    orgId: String(r.org_id),
    mintedAtMs: toMs(r.minted_at_ms) ?? 0,
    keyUsed: r.key_used === true,
    firstActionAtMs: toMs(r.first_action_at_ms),
    lastActionAtMs: toMs(r.last_action_at_ms),
    actionCount: Number(r.action_count) || 0,
    frozenRetainedWeek1: r.retained_week1 === true,
    archived: true,
    firstKeyUsedAtMs: toMs(r.first_key_used_at_ms),
    firstSeenAtMs: toMs(r.first_seen_at_ms),
    lastSeenAtMs: toMs(r.last_seen_at_ms),
    // Pre-v5.3/v6.4/v7.2 snapshots carry NULL = unknown; never guessed on read.
    mintSource: typeof r.mint_source === 'string' && r.mint_source.length > 0 ? r.mint_source : null,
    firstActionVia: r.first_action_via === 'browser' || r.first_action_via === 'agent' ? r.first_action_via : null,
    graduatedAtMs: toMs(r.exported_at_ms),
  }));
}

/** Live trial orgs + deletion-time snapshots, aggregated. Aggregate-only: no org ids leave this function. */
export async function getTrialFunnel(
  sql: SqlTag,
  { now = new Date() }: { now?: Date } = {},
): Promise<TrialFunnel> {
  const live = await queryLiveTrialFacts(sql, null);
  const archived = await querySnapshotFacts(sql);
  return computeFunnelAggregates([...live, ...archived], now);
}

export async function incrementTrialActionCount(sql: SqlTag, orgId: string): Promise<void> {
  await sql`
    UPDATE organizations
    SET trial_actions_used = trial_actions_used + 1
    WHERE id = ${orgId} AND hosted_mode = TRUE
  `;
}
