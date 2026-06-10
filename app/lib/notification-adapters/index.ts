import { slackAdapter } from './slack';
import { discordAdapter } from './discord';
import { linearAdapter } from './linear';
import { githubAdapter } from './github';
import { emailAdapter } from './email';
import { decrypt } from '../encryption';

/**
 * A governance signal as surfaced to native notification adapters. Field
 * shapes mirror what the adapters read; optional fields are absent on some
 * signal kinds.
 */
export interface GovernanceSignal {
  severity: string;
  label: string;
  detail: string;
  agent_id?: string;
  help?: string;
}

/** Decrypted credential bag keyed by settings key. */
export type AdapterCreds = Record<string, string | undefined>;

/** Per-adapter delivery outcome (sans the injected `provider`). */
export interface AdapterResult {
  success: boolean;
  message: string;
}

/** Aggregate delivery outcome returned to callers. */
export interface NotificationResult extends AdapterResult {
  provider: string;
}

/** Shape of a native notification adapter. */
export interface NotificationAdapter {
  name: string;
  requiredKeys: string[];
  send(
    signals: GovernanceSignal[],
    creds: AdapterCreds,
    orgId?: string,
  ): Promise<AdapterResult>;
}

/** Raw settings row as stored (encrypted values are ciphertext). */
export interface SettingRow {
  key: string;
  value: string | null;
  encrypted?: boolean | null;
}

export const ADAPTERS: NotificationAdapter[] = [
  slackAdapter,
  discordAdapter,
  linearAdapter,
  githubAdapter,
  emailAdapter,
];

/**
 * Deliver signals through all configured and enabled native adapters.
 */
export async function deliverNativeNotifications(
  orgId: string,
  signals: GovernanceSignal[],
  settings: SettingRow[],
  sql?: unknown,
): Promise<NotificationResult[]> {
  // Settings rows are stored raw (encrypted values are ciphertext); decrypt
  // sensitive values before handing them to adapters, mirroring the read-site
  // decryption in integration-health.js / GET /api/settings. Non-encrypted
  // rows pass through unchanged.
  const creds: AdapterCreds = {};
  for (const s of settings) {
    let val = s.value;
    if (s.encrypted && val) {
      const decrypted = decrypt(val, `${orgId}:${s.key}`);
      if (decrypted) val = decrypted;
    }
    creds[s.key] = val ?? undefined;
  }

  const results: NotificationResult[] = [];
  for (const adapter of ADAPTERS) {
    const hasKey = adapter.requiredKeys.some((k) => creds[k]);
    if (!hasKey) continue;

    const enabledKey = `DASHCLAW_ALERTS_${adapter.name.toUpperCase()}`;
    if (creds[enabledKey] === 'false') continue;

    try {
      const result = await adapter.send(signals, creds, orgId);
      results.push({ provider: adapter.name, ...result });
    } catch (err) {
      results.push({
        provider: adapter.name,
        success: false,
        message: (err as Error)?.message,
      });
    }
  }
  return results;
}
