/**
 * Repository for governed_secrets — agent/org-scoped secret rotation metadata,
 * plus OPTIONAL managed values (encrypted at rest, write-only, delivered to
 * agents only when delivery_enabled is set per secret).
 *
 * Managed-value security model:
 * - Values are encrypted with AES-256-GCM (app/lib/encryption.ts) using
 *   AAD `${orgId}:${secretId}`. One shared ENCRYPTION_KEY encrypts ALL orgs'
 *   data; AAD binding is the accepted mitigation — ciphertext cannot be
 *   spliced across orgs or across rows within an org.
 * - WRITE-ONLY: no function here (or any route) returns plaintext to a
 *   browser or admin. The only decrypt path is getDeliverableSecrets, used
 *   exclusively by the API-key-authed delivery endpoint.
 *
 * Follows the existing repository pattern: every function takes
 * `(sql, orgId, ...)`, SQL is written as tagged templates, no raw
 * concatenation. UNIQUE NULLS NOT DISTINCT on (org_id, agent_id, name)
 * means org-wide secrets (agent_id IS NULL) can't duplicate names within
 * an org.
 */
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../encryption';
import type { SqlTag } from '../types/db';

const VALUE_ALGO = 'aes-256-gcm-v2';

/**
 * Env-var-safe secret name: required for delivery-enabled values, since
 * delivered secrets become process environment variable names.
 */
export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function isEnvSafeName(name: unknown): boolean {
  return typeof name === 'string' && SECRET_NAME_PATTERN.test(name);
}

interface ListFilter {
  agentId?: string | null;
}

interface CreateSecretInput {
  name?: string;
  agentId?: string | null;
  rotationIntervalDays?: number | string | null;
  lastRotatedAt?: unknown;
  notes?: string | null;
}

interface UpdateSecretPatch {
  lastRotatedAt?: unknown;
  rotationIntervalDays?: number | string | null;
  notes?: string | null;
}

interface RotationDueFilter {
  agentId?: string | null;
  withinDays?: number | string | null;
}

function secretId(): string {
  return 'sec_' + randomBytes(8).toString('hex');
}

/**
 * List secrets for an org. If filter.agentId is provided, returns secrets
 * scoped to that agent. Otherwise returns org-wide secrets (agent_id IS NULL).
 * Each row includes a computed `next_rotation_due` derived from
 * `last_rotated_at + rotation_interval_days`.
 */
export async function listSecrets(
  sql: SqlTag,
  orgId: string,
  filter: ListFilter = {}
): Promise<Record<string, unknown>[]> {
  // SECURITY: never select value_encrypted itself here — list responses
  // expose only the has_value flag (write-only managed values).
  if (filter.agentId) {
    return sql`
      SELECT id, org_id, agent_id, name, last_rotated_at, rotation_interval_days,
             notes, created_at, updated_at,
             (value_encrypted IS NOT NULL) AS has_value, value_set_at, delivery_enabled,
             (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) AS next_rotation_due
      FROM governed_secrets
      WHERE org_id = ${orgId} AND agent_id = ${filter.agentId}
      ORDER BY name ASC
    `;
  }
  return sql`
    SELECT id, org_id, agent_id, name, last_rotated_at, rotation_interval_days,
           notes, created_at, updated_at,
           (value_encrypted IS NOT NULL) AS has_value, value_set_at, delivery_enabled,
           (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) AS next_rotation_due
    FROM governed_secrets
    WHERE org_id = ${orgId} AND agent_id IS NULL
    ORDER BY name ASC
  `;
}

/**
 * Insert a new secret rotation record. `name` is required. `lastRotatedAt`
 * defaults to NOW() via the column default when not provided; the Neon HTTP
 * driver does not accept tagged-template fragments inline, so we branch
 * into two INSERT queries.
 */
export async function createSecret(
  sql: SqlTag,
  orgId: string,
  input: CreateSecretInput
): Promise<Record<string, unknown>> {
  if (!input?.name) throw new Error('createSecret: name is required');
  const id = secretId();
  // Default 90 when omitted; explicit values must be a positive whole number
  // of days (a 0/negative interval would make the secret permanently overdue).
  let rotationIntervalDays = 90;
  if (input.rotationIntervalDays !== undefined && input.rotationIntervalDays !== null && input.rotationIntervalDays !== '') {
    const n = Number(input.rotationIntervalDays);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error('createSecret: rotation_interval_days must be >= 1');
    }
    rotationIntervalDays = Math.floor(n);
  }
  const lastRotatedAt = input.lastRotatedAt || null;

  const rows = lastRotatedAt
    ? await sql`
        INSERT INTO governed_secrets (
          id, org_id, agent_id, name, last_rotated_at, rotation_interval_days, notes
        ) VALUES (
          ${id}, ${orgId}, ${input.agentId || null}, ${input.name},
          ${lastRotatedAt}, ${rotationIntervalDays}, ${input.notes || null}
        )
        RETURNING id, name, last_rotated_at, rotation_interval_days
      `
    : await sql`
        INSERT INTO governed_secrets (
          id, org_id, agent_id, name, rotation_interval_days, notes
        ) VALUES (
          ${id}, ${orgId}, ${input.agentId || null}, ${input.name},
          ${rotationIntervalDays}, ${input.notes || null}
        )
        RETURNING id, name, last_rotated_at, rotation_interval_days
      `;
  return rows[0] || { id };
}

/**
 * Patch lastRotatedAt, rotationIntervalDays, or notes. Unspecified fields
 * keep their current values; `notes` accepts an EXPLICIT null to clear
 * (COALESCE alone made `{notes: null}` a silent no-op).
 */
export async function updateSecret(
  sql: SqlTag,
  orgId: string,
  id: string,
  patch: UpdateSecretPatch
): Promise<Record<string, unknown> | null> {
  const rotationIntervalDays = patch.rotationIntervalDays != null
    ? Number(patch.rotationIntervalDays)
    : null;
  const notesProvided = patch.notes !== undefined;

  const rows = await sql`
    UPDATE governed_secrets
       SET last_rotated_at = COALESCE(${patch.lastRotatedAt || null}, last_rotated_at),
           rotation_interval_days = COALESCE(${rotationIntervalDays}, rotation_interval_days),
           notes = CASE WHEN ${notesProvided} THEN ${notesProvided ? patch.notes : null} ELSE notes END,
           updated_at = NOW()
     WHERE org_id = ${orgId} AND id = ${id}
     RETURNING id, last_rotated_at, rotation_interval_days, notes, updated_at
  `;
  return rows[0] || null;
}

/**
 * Fetch a single secret's metadata (never the encrypted value).
 */
export async function getSecret(
  sql: SqlTag,
  orgId: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT id, org_id, agent_id, name, last_rotated_at, rotation_interval_days,
           notes, created_at, updated_at,
           (value_encrypted IS NOT NULL) AS has_value, value_set_at, delivery_enabled
    FROM governed_secrets
    WHERE org_id = ${orgId} AND id = ${id}
  `;
  return rows[0] || null;
}

/**
 * Set (or overwrite) the managed value for a secret. Encrypts with AAD
 * `${orgId}:${id}` — the row's identity, so ciphertext is bound to this exact
 * secret. Setting a value IS a rotation, so last_rotated_at resets too.
 * Returns the updated row metadata (never the value) or null when not found.
 */
export async function setSecretValue(
  sql: SqlTag,
  orgId: string,
  id: string,
  plaintext: string
): Promise<Record<string, unknown> | null> {
  const valueEncrypted = encrypt(plaintext, `${orgId}:${id}`);
  const rows = await sql`
    UPDATE governed_secrets
       SET value_encrypted = ${valueEncrypted},
           value_algo = ${VALUE_ALGO},
           value_set_at = NOW(),
           last_rotated_at = NOW(),
           updated_at = NOW()
     WHERE org_id = ${orgId} AND id = ${id}
     RETURNING id, name, value_set_at, delivery_enabled, last_rotated_at
  `;
  return rows[0] || null;
}

/**
 * Clear a managed value. delivery_enabled is left as-is — delivery requires
 * value_encrypted IS NOT NULL, so a cleared secret is never delivered.
 */
export async function clearSecretValue(
  sql: SqlTag,
  orgId: string,
  id: string
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    UPDATE governed_secrets
       SET value_encrypted = NULL,
           value_algo = NULL,
           value_set_at = NULL,
           updated_at = NOW()
     WHERE org_id = ${orgId} AND id = ${id}
     RETURNING id, name, delivery_enabled
  `;
  return rows[0] || null;
}

/**
 * Toggle per-secret delivery opt-in (stored as integer 0/1).
 */
export async function setDeliveryEnabled(
  sql: SqlTag,
  orgId: string,
  id: string,
  enabled: boolean
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    UPDATE governed_secrets
       SET delivery_enabled = ${enabled ? 1 : 0},
           updated_at = NOW()
     WHERE org_id = ${orgId} AND id = ${id}
     RETURNING id, name, delivery_enabled
  `;
  return rows[0] || null;
}

/**
 * Decrypt and return the deliverable secret bundle for an agent:
 * delivery_enabled = 1 AND value_encrypted IS NOT NULL, merging org-wide
 * rows (agent_id IS NULL) with agent-specific rows — agent-specific wins
 * per name. Each row decrypts with its OWN AAD (`${org_id}:${id}`), so a
 * row copied across orgs/ids fails authentication and is skipped.
 *
 * One corrupt row never fails the whole bundle: decrypt failures and
 * non-env-safe names are skipped with a name-only log (never values).
 */
export async function getDeliverableSecrets(
  sql: SqlTag,
  orgId: string,
  agentId: string
): Promise<{ name: string; value: string }[]> {
  const rows = await sql`
    SELECT id, org_id, agent_id, name, value_encrypted
    FROM governed_secrets
    WHERE org_id = ${orgId}
      AND delivery_enabled = 1
      AND value_encrypted IS NOT NULL
      AND (agent_id IS NULL OR agent_id = ${agentId})
    ORDER BY name ASC
  `;

  // Merge: agent-specific overrides org-wide per name.
  const byName = new Map<string, Record<string, unknown>>();
  for (const row of rows as Record<string, unknown>[]) {
    const name = String(row.name);
    const existing = byName.get(name);
    if (!existing || (row.agent_id && !existing.agent_id)) byName.set(name, row);
  }

  const out: { name: string; value: string }[] = [];
  for (const row of byName.values()) {
    const name = String(row.name);
    if (!isEnvSafeName(name)) {
      console.warn(`[SECRETS] Skipping delivery of non-env-safe secret name: ${name}`);
      continue;
    }
    let value: string | null = null;
    try {
      value = decrypt(row.value_encrypted, `${row.org_id}:${row.id}`);
    } catch {
      value = null;
    }
    if (value === null) {
      // Log the NAME only — never ciphertext or plaintext.
      console.warn(`[SECRETS] Skipping undecryptable secret: ${name}`);
      continue;
    }
    out.push({ name, value });
  }
  return out;
}

export async function deleteSecret(sql: SqlTag, orgId: string, id: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM governed_secrets
    WHERE org_id = ${orgId} AND id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Return secrets whose next rotation date falls within `withinDays` of now
 * (default 14). Each row includes `days_until_due` as an integer (can be
 * negative for already-overdue secrets). Scoped by agent if provided.
 */
export async function listRotationDue(
  sql: SqlTag,
  orgId: string,
  filter: RotationDueFilter = {}
): Promise<Record<string, unknown>[]> {
  const withinDays = Number(filter.withinDays) || 14;
  if (filter.agentId) {
    return sql`
      SELECT id, name, agent_id, last_rotated_at, rotation_interval_days,
             EXTRACT(DAY FROM (last_rotated_at + (rotation_interval_days * INTERVAL '1 day') - NOW()))::int AS days_until_due
      FROM governed_secrets
      WHERE org_id = ${orgId}
        AND agent_id = ${filter.agentId}
        AND (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) <= NOW() + (${withinDays} * INTERVAL '1 day')
      ORDER BY last_rotated_at + (rotation_interval_days * INTERVAL '1 day') ASC
    `;
  }
  return sql`
    SELECT id, name, agent_id, last_rotated_at, rotation_interval_days,
           EXTRACT(DAY FROM (last_rotated_at + (rotation_interval_days * INTERVAL '1 day') - NOW()))::int AS days_until_due
    FROM governed_secrets
    WHERE org_id = ${orgId}
      AND (last_rotated_at + (rotation_interval_days * INTERVAL '1 day')) <= NOW() + (${withinDays} * INTERVAL '1 day')
    ORDER BY last_rotated_at + (rotation_interval_days * INTERVAL '1 day') ASC
  `;
}
