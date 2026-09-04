// Durable execution finality (docs/architecture/durable-execution-finality.md).
// Shared by both outcome-sweep routes and the lazy sweep in
// actions.repository.ts so this resolution logic exists once.
import type { SqlTag } from './types/db';
import { getSettings } from './repositories/settings.repository';

const DEFAULT_TIMEOUT_MINUTES = 15;
const FLOOR_TIMEOUT_MINUTES = 1;
const CEILING_TIMEOUT_MINUTES = 24 * 60;

/**
 * Resolve an org's outcome timeout from DASHCLAW_OUTCOME_TIMEOUT_MINUTES,
 * clamped to [FLOOR_TIMEOUT_MINUTES, CEILING_TIMEOUT_MINUTES]. Falls back to
 * DEFAULT_TIMEOUT_MINUTES on a missing/invalid value or lookup failure.
 */
export async function getOutcomeTimeoutMinutes(sql: SqlTag, orgId: string): Promise<number> {
  try {
    const rows = await getSettings(sql, orgId, { key: 'DASHCLAW_OUTCOME_TIMEOUT_MINUTES' });
    const raw = rows?.[0]?.value;
    if (raw == null || raw === '') return DEFAULT_TIMEOUT_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MINUTES;
    return Math.min(CEILING_TIMEOUT_MINUTES, Math.max(FLOOR_TIMEOUT_MINUTES, Math.floor(n)));
  } catch {
    return DEFAULT_TIMEOUT_MINUTES;
  }
}
