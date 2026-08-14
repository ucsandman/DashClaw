/**
 * Repository for settings
 * Handles all database operations for settings table
 */
import type { SqlTag } from '../types/db';

// Allowlist of valid setting keys (security: prevent arbitrary key injection)
export const VALID_SETTING_KEYS = [
  // AI Providers
  'OPENAI_API_KEY', 'OPENAI_ORG_ID', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
  'TOGETHER_API_KEY', 'REPLICATE_API_TOKEN', 'HUGGINGFACE_API_KEY',
  'PERPLEXITY_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID',
  // Databases
  'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY',
  'PLANETSCALE_URL', 'MONGODB_URI', 'REDIS_URL', 'PINECONE_API_KEY', 'PINECONE_ENVIRONMENT',
  // Communication
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID', 'DASHCLAW_ALERTS_TELEGRAM', 'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID', 'SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SENDGRID_API_KEY',
  // Productivity
  'GOOGLE_ACCOUNT', 'GOOGLE_CREDENTIALS_PATH', 'NOTION_API_KEY', 'NOTION_PARENT_PAGE_ID',
  'LINEAR_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'CALENDLY_API_KEY',
  // Development
  'GITHUB_TOKEN', 'GITHUB_USERNAME', 'VERCEL_TOKEN', 'VERCEL_PROJECT_ID',
  'RAILWAY_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'SENTRY_DSN', 'SENTRY_AUTH_TOKEN',
  // Social
  'TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET',
  'BRAVE_API_KEY', 'MOLTBOOK_API_KEY',
  // Payments
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
  'LEMONSQUEEZY_API_KEY',
  // Native governance alert settings
  'DASHCLAW_ALERTS_SLACK', 'DASHCLAW_ALERTS_DISCORD', 'DASHCLAW_ALERTS_LINEAR',
  'DASHCLAW_ALERTS_GITHUB', 'DASHCLAW_ALERTS_EMAIL',
  'DASHCLAW_ALERT_EMAIL', 'SLACK_CHANNEL_ID', 'SLACK_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL', 'GITHUB_REPO',
  'SENDGRID_DEFAULT_TO', 'SENDGRID_FROM_EMAIL',
  // Cost alerts — per-action cost cap in USD. When a PATCH resolves with
  // cost_estimate > threshold, the action.cost_exceeded event fires and
  // webhooks + native adapters deliver a signal. Empty/unset = disabled.
  'DASHCLAW_ACTION_COST_THRESHOLD',
  // System configuration
  'MODEL_PRICING',
  'ENFORCE_AGENT_SIGNATURES',
  // Predictive risk scoring
  'PREDICTIVE_RISK_ENABLED',
  'PREDICTIVE_RISK_THRESHOLD',
  // Durable execution finality — minutes a pending outcome may live before the
  // sweep marks it lost_confirmation. Default 15. See
  // docs/architecture/durable-execution-finality.md.
  'DASHCLAW_OUTCOME_TIMEOUT_MINUTES',
  // Policy Coach behavior recorder — UI-controlled enablement + optional
  // auto-stop window. The local agent hook reads these (GET /api/behavior/
  // recorder) to decide whether to capture samples; an explicit
  // DASHCLAW_BEHAVIOR_SAMPLES_ENABLED env var still overrides them.
  'BEHAVIOR_RECORDER_ENABLED',
  'BEHAVIOR_RECORDER_UNTIL',
  // Opt-in ANONYMIZED behavior-sample upload (default off). When 'true', the
  // local recorder may POST allowlist-sanitized, path-hashed samples to
  // /api/behavior/samples/ingest so a hosted Policy Coach can analyze them.
  'BEHAVIOR_UPLOAD_ENABLED',
  // Policy Coach "learning in the background" insights — a SAFE aggregate
  // snapshot (counts, per-agent tallies, signal totals, timestamps) the local
  // agent machine pushes so a hosted dashboard can show that DashClaw is alive
  // and learning. Never contains raw behavior (no command shapes, paths, or
  // goals). Written by POST /api/behavior/insights, read by the hosted UI.
  'BEHAVIOR_INSIGHTS_SNAPSHOT',
  // Auto-scan: when 'true', the guard hard-blocks an action whose outbound
  // content contains a detected secret/credential. Default (unset) = warn only.
  'DASHCLAW_AUTOSCAN_BLOCK',
  // Opportunistic drift tick debounce marker — ISO timestamp of the last
  // auto-run (app/lib/drift-tick.ts). Written by the system, not the UI.
  'DRIFT_TICK_LAST_RUN_AT',
  // Policy review state — persisted per-org by /api/policies/review/verdict.
  // policy_review_cursor:   ISO timestamp; every warn decision before this time
  //                         counts as reviewed (advance with "mark all reviewed").
  // policy_review_dismissed: JSON object { "<shapeKey>": "<ISO timestamp>" }
  //                          of per-shape dismissals ("fine" verdict).
  'policy_review_cursor',
  'policy_review_dismissed',
  // Approvals expired-section cursor — ISO timestamp; expired approvals whose
  // wait window ended at/before this time are hidden from the /approvals
  // Expired list ("Clear expired"). View state only — the action_records rows
  // are untouched. Written by the admin-gated settings API from /approvals.
  'approvals_expired_cleared_at',
  // Policy-tuning proposal loop — JSON object keyed by proposal fingerprint
  // ("ptp_<16hex>") holding { reason, by, at } dismissal records. Written by
  // POST /api/policies/proposals; pruned on write (newest 200 entries, then
  // by serialized size to respect the 10k value cap).
  'policy_tuning_dismissed',
  // W3 interruption budget / digest (close-the-loop spec 2026-06-11)
  'DASHCLAW_INTERRUPT_BUDGET',
  'DASHCLAW_INTERRUPT_WINDOW_MIN',
  'DASHCLAW_INTERRUPT_BUDGET_FLEET',
  'APPROVAL_FLOOD_STATE',
  'DASHCLAW_DIGEST_INTERVAL_HOURS',
  'DIGEST_TICK_LAST_RUN_AT',
  // Org kill switch (Organ 3 Phase 4) — JSON {halted, actor, reason, at}.
  // Written ONLY by the admin-gated /api/halt route; read on the guard hot
  // path (piggybacked on the cached settings read in guard.ts).
  'DASHCLAW_ORG_HALT',
  // Approval pause — JSON {until, actor, reason, at}. Written ONLY by the
  // admin-gated /api/approval-pause route; read on the guard hot path
  // (rides the same cached category-general settings read as the halt key).
  'DASHCLAW_APPROVAL_PAUSE',
  // Calibrated interruption controller (governance-core-theory §1). MODE is
  // 'off' (default) | 'shadow' | 'active'; TARGET_RATE is the operator-set
  // false-interruption bound α as a decimal string ('0.10'). Written by the
  // admin-gated /api/calibration/controller route; read on the guard hot
  // path (piggybacked on the same cached settings read as the halt flag).
  'CALIBRATION_CONTROLLER_MODE',
  'CALIBRATION_TARGET_RATE',
  // Local admin login brute-force guard — JSON {fails, last_fail_at}.
  // Written by the system (login-guard.repository via /api/auth/local);
  // listed here so an admin can inspect/clear a lockout via the settings API.
  'LOCAL_ADMIN_LOGIN_GUARD',
  // Preflight plan authorization (governed-autonomy feature 1). TTL_MAX is
  // the server clamp on agent-requested plan TTLs (minutes); MAX_STEPS caps
  // steps per submitted plan. Read by the /api/plans routes (NOT on the
  // guard hot path — the consumption query needs no settings).
  'PLAN_GRANT_TTL_MAX_MINUTES',
  'PLAN_MAX_STEPS',
  // External policy verdict provider (RFC docs/rfcs/2026-08-13-external-policy-
  // verdict-input.md, #219). One optional per-org provider whose verdict joins
  // the local guard result stricter-wins. Written by the admin-gated settings
  // API from /policies; read on the guard hot path (rides the same cached
  // category-general settings read as the halt key). URL and token auto-encrypt
  // via shouldAutoEncrypt suffix rules; PROVIDER deliberately avoids an _ID
  // suffix so the display label stays readable.
  'EXTERNAL_VERDICT_ENABLED',
  'EXTERNAL_VERDICT_PROVIDER',
  'EXTERNAL_VERDICT_PROVIDER_URL',
  'EXTERNAL_VERDICT_AUTH_TOKEN',
  'EXTERNAL_VERDICT_TIMEOUT_MS',
  'EXTERNAL_VERDICT_POSTURE',
  // Applicability scope (#219 follow-up): comma-separated exact action_types
  // the provider governs; empty = every act. Plain-text on purpose — it must
  // stay readable when the encrypted URL cannot be recovered.
  'EXTERNAL_VERDICT_ACTION_TYPES',
];

export const VALID_CATEGORIES = ['integration', 'general', 'system'];

interface GetSettingsFilter {
  key?: string;
  category?: string;
  agentId?: string | null;
}

interface UpsertSettingInput {
  key?: string;
  value?: string | null;
  category?: string;
  encrypted?: boolean;
  agent_id?: string | null;
}

/**
 * Ensure settings table exists
 */
export async function ensureSettingsTable(sql: SqlTag): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT 'org_default',
      agent_id TEXT,
      key TEXT NOT NULL,
      value TEXT,
      category TEXT DEFAULT 'general',
      encrypted BOOLEAN DEFAULT false,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS settings_org_agent_key_unique
    ON settings (org_id, COALESCE(agent_id, ''), key)
  `;
}

/**
 * Get settings with optional filters
 * When agentId is provided, returns merged settings (agent overrides org defaults)
 */
export async function getSettings(
  sql: SqlTag,
  orgId: string,
  { key, category, agentId }: GetSettingsFilter = {}
): Promise<Record<string, unknown>[]> {
  let settings;

  if (agentId) {
    // Merged query: agent-specific rows override org-level defaults
    // DISTINCT ON (key) with ORDER BY agent_id NULLS LAST means agent-specific wins
    if (key) {
      settings = await sql`
        SELECT DISTINCT ON (key) *,
          CASE WHEN agent_id IS NULL THEN true ELSE false END AS is_inherited
        FROM settings
        WHERE org_id = ${orgId} AND (agent_id = ${agentId} OR agent_id IS NULL) AND key = ${key}
        ORDER BY key, agent_id NULLS LAST
      `;
    } else if (category) {
      settings = await sql`
        SELECT DISTINCT ON (key) *,
          CASE WHEN agent_id IS NULL THEN true ELSE false END AS is_inherited
        FROM settings
        WHERE org_id = ${orgId} AND (agent_id = ${agentId} OR agent_id IS NULL) AND category = ${category}
        ORDER BY key, agent_id NULLS LAST
      `;
    } else {
      settings = await sql`
        SELECT DISTINCT ON (key) *,
          CASE WHEN agent_id IS NULL THEN true ELSE false END AS is_inherited
        FROM settings
        WHERE org_id = ${orgId} AND (agent_id = ${agentId} OR agent_id IS NULL)
        ORDER BY key, agent_id NULLS LAST
      `;
    }
  } else {
    // Org-level only (no agent filter)
    if (key) {
      settings = await sql`SELECT *, false AS is_inherited FROM settings WHERE key = ${key} AND org_id = ${orgId} AND agent_id IS NULL`;
    } else if (category) {
      settings = await sql`SELECT *, false AS is_inherited FROM settings WHERE category = ${category} AND org_id = ${orgId} AND agent_id IS NULL ORDER BY key`;
    } else {
      settings = await sql`SELECT *, false AS is_inherited FROM settings WHERE org_id = ${orgId} AND agent_id IS NULL ORDER BY category, key`;
    }
  }

  return settings;
}

/**
 * Upsert a setting
 */
export async function upsertSetting(
  sql: SqlTag,
  orgId: string,
  { key, value, category = 'general', encrypted = false, agent_id = null }: UpsertSettingInput
): Promise<void> {
  // Validation
  if (!key) {
    throw new Error('Key is required');
  }
  if (!VALID_SETTING_KEYS.includes(key)) {
    throw new Error(`Invalid setting key: ${key}`);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }
  if (value && value.length > 10000) {
    throw new Error('Value too long (max 10000 chars)');
  }
  if (agent_id && agent_id.length > 255) {
    throw new Error('agent_id too long (max 255 chars)');
  }

  // Use COALESCE-based conflict target matching the functional unique index
  await sql`
    INSERT INTO settings (org_id, agent_id, key, value, category, encrypted, updated_at)
    VALUES (${orgId}, ${agent_id}, ${key}, ${value}, ${category}, ${encrypted}, NOW())
    ON CONFLICT (org_id, COALESCE(agent_id, ''), key) DO UPDATE SET
      value = ${value},
      category = ${category},
      encrypted = ${encrypted},
      updated_at = NOW()
  `;
}

/**
 * Delete a setting
 * When agentId is provided, deletes agent-specific row only
 */
export async function deleteSetting(
  sql: SqlTag,
  orgId: string,
  key: string,
  agentId: string | null = null
): Promise<void> {
  if (!key) {
    throw new Error('Key is required');
  }

  if (agentId) {
    await sql`DELETE FROM settings WHERE key = ${key} AND org_id = ${orgId} AND agent_id = ${agentId}`;
  } else {
    await sql`DELETE FROM settings WHERE key = ${key} AND org_id = ${orgId} AND agent_id IS NULL`;
  }
}

/**
 * Load custom model pricing for an org.
 * Returns a parsed pricing array or null if none is configured.
 */
export async function getModelPricing(sql: SqlTag, orgId: string): Promise<unknown[] | null> {
  try {
    const rows = await sql`SELECT value FROM settings WHERE org_id = ${orgId} AND key = 'MODEL_PRICING' AND agent_id IS NULL LIMIT 1`;
    if (rows.length > 0 && rows[0]!.value) {
      const parsed = JSON.parse(rows[0]!.value as string);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* best-effort: fall back to default pricing on any error */ }
  return null;
}

/**
 * Helper to mask sensitive values
 */
export function maskValue(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return value.substring(0, 4) + '••••••••' + value.substring(value.length - 4);
}

/**
 * Check if a key should be auto-encrypted
 */
export function shouldAutoEncrypt(key: string, encrypted: boolean): boolean {
  if (encrypted) return true; // Already marked for encryption

  const SENSITIVE_SUFFIXES = ['_KEY', '_TOKEN', '_SECRET', '_URL', '_URI', '_DSN', '_PASSWORD', '_ID', '_CREDENTIALS_PATH'];
  const EXCEPTIONS = ['TELEGRAM_ADMIN_CHAT_ID', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'VERCEL_PROJECT_ID', 'CLOUDFLARE_ACCOUNT_ID', 'AIRTABLE_BASE_ID', 'ELEVENLABS_VOICE_ID', 'OPENAI_ORG_ID'];

  return SENSITIVE_SUFFIXES.some(s => key.endsWith(s)) && !EXCEPTIONS.includes(key);
}
