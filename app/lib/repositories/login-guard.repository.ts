/**
 * Brute-force guard for the local admin login (/api/auth/local).
 *
 * The middleware rate limiter is per-instance (in-memory fallback when
 * Upstash is absent), so a distributed guesser could grind
 * DASHCLAW_LOCAL_ADMIN_PASSWORD into a 7-day admin JWT. This repository
 * persists a single failure counter in the settings table (same home as
 * other system state like DASHCLAW_ORG_HALT) so the lockout holds across
 * serverless instances.
 *
 * Policy: LOGIN_GUARD_MAX_FAILS consecutive failures lock the login for
 * LOGIN_GUARD_LOCKOUT_MS from the last failure. A success clears the
 * counter. Storage failures fail OPEN (the env password is still the
 * authentication) — callers log loudly instead of breaking login.
 */
import type { SqlTag } from '../types/db';

export const LOGIN_GUARD_KEY = 'LOCAL_ADMIN_LOGIN_GUARD';
export const LOGIN_GUARD_MAX_FAILS = 5;
export const LOGIN_GUARD_LOCKOUT_MS = 15 * 60 * 1000;

interface GuardState {
  fails: number;
  last_fail_at: string;
}

export interface LoginLockState {
  locked: boolean;
  retryAfterSeconds?: number;
}

async function readState(sql: SqlTag, orgId: string): Promise<GuardState | null> {
  const rows = await sql`
    SELECT value FROM settings
    WHERE org_id = ${orgId} AND key = ${LOGIN_GUARD_KEY} AND agent_id IS NULL
    LIMIT 1
  `;
  if (rows.length === 0 || !rows[0]!.value) return null;
  try {
    const parsed = JSON.parse(rows[0]!.value as string);
    if (typeof parsed?.fails === 'number' && typeof parsed?.last_fail_at === 'string') {
      return parsed as GuardState;
    }
  } catch { /* best-effort: corrupt value — treat as no failures rather than locking out the operator */ }
  return null;
}

function windowExpired(state: GuardState): boolean {
  const last = Date.parse(state.last_fail_at);
  return !Number.isFinite(last) || Date.now() - last >= LOGIN_GUARD_LOCKOUT_MS;
}

export async function getLoginLockState(sql: SqlTag, orgId: string): Promise<LoginLockState> {
  const state = await readState(sql, orgId);
  if (!state || state.fails < LOGIN_GUARD_MAX_FAILS || windowExpired(state)) {
    return { locked: false };
  }
  const elapsed = Date.now() - Date.parse(state.last_fail_at);
  return {
    locked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((LOGIN_GUARD_LOCKOUT_MS - elapsed) / 1000)),
  };
}

export async function recordLoginFailure(sql: SqlTag, orgId: string): Promise<void> {
  const state = await readState(sql, orgId);
  const fails = state && !windowExpired(state) ? state.fails + 1 : 1;
  const value = JSON.stringify({ fails, last_fail_at: new Date().toISOString() });
  await sql`
    INSERT INTO settings (org_id, agent_id, key, value, category, encrypted, updated_at)
    VALUES (${orgId}, ${null}, ${LOGIN_GUARD_KEY}, ${value}, 'system', false, NOW())
    ON CONFLICT (org_id, COALESCE(agent_id, ''), key) DO UPDATE SET
      value = ${value},
      updated_at = NOW()
  `;
}

export async function clearLoginFailures(sql: SqlTag, orgId: string): Promise<void> {
  await sql`
    DELETE FROM settings
    WHERE org_id = ${orgId} AND key = ${LOGIN_GUARD_KEY} AND agent_id IS NULL
  `;
}
