import crypto from 'node:crypto';
import { importPolicyPack } from '../guardrails/import-pack';
import type { SqlTag } from '../types/db';

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function generateApiKey(): { plaintext: string; keyHash: string; keyPrefix: string } {
  const raw = crypto.randomBytes(16).toString('hex');
  const plaintext = `oc_live_${raw}`;
  const keyHash = crypto.createHash('sha256').update(plaintext).digest('hex');
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
  { trialDays, trialActionCap, label = 'trial' }: { trialDays: number; trialActionCap: number; label?: string },
): Promise<{ orgId: string; apiKey: string; keyPrefix: string; expiresAt: string }> {
  const orgId = generateId('org');
  const slug = `trial-${orgId.slice(4, 12)}`;
  const expiresAt = new Date(Date.now() + trialDays * 86_400_000).toISOString();

  await sql`
    INSERT INTO organizations (id, name, slug, plan, hosted_mode, trial_ends_at, trial_action_cap, trial_actions_used)
    VALUES (${orgId}, ${'Trial workspace'}, ${slug}, ${'free'}, TRUE, ${expiresAt}, ${trialActionCap}, 0)
  `;
  try {
    const { apiKey, keyPrefix } = await mintOrgApiKey(sql, orgId, { label });

    // Seed the day-one starter policies so the first governed session feels
    // governed (a fresh org with zero policies allows everything). Failure
    // logs loudly but never fails provisioning — a workspace without
    // policies beats a 500.
    try {
      const seeded = await importPolicyPack(sql, orgId, 'claude-code-starter');
      if (seeded.errors.length > 0) {
        console.error(`[HOSTED] starter-pack seeding for ${orgId} had errors:`, seeded.errors);
      }
    } catch (err) {
      console.error(`[HOSTED] starter-pack seeding failed for ${orgId}:`, (err as Error).message);
    }

    return { orgId, apiKey, keyPrefix, expiresAt };
  } catch (err) {
    // Best-effort cleanup — prevents orphaned trial orgs when key insert fails.
    // If this also fails, the sweep job will collect it once trial_ends_at passes.
    await sql`DELETE FROM organizations WHERE id = ${orgId} AND hosted_mode = TRUE`.catch(() => {});
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
    SELECT hosted_mode FROM organizations WHERE id = ${orgId} LIMIT 1
  `;
  if (existing.length === 0) return { deleted: false, reason: 'not_found' };
  if (!existing[0]?.hosted_mode) {
    throw new Error(`org ${orgId} is not a hosted trial workspace — refusing to delete`);
  }
  // Revoke first so the workspace is dead immediately even if a later step fails.
  await sql`UPDATE api_keys SET revoked_at = NOW() WHERE org_id = ${orgId} AND revoked_at IS NULL`;

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
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at < ${cutoff}
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

export async function incrementTrialActionCount(sql: SqlTag, orgId: string): Promise<void> {
  await sql`
    UPDATE organizations
    SET trial_actions_used = trial_actions_used + 1
    WHERE id = ${orgId} AND hosted_mode = TRUE
  `;
}
