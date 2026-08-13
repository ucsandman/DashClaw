/**
 * ALL module-level mutable state for the guard engine lives here: the policy,
 * risk-template, predictive-settings and org-halt caches, their invalidation
 * hooks, and the loaders that fill them. `__resetGuardCaches()` clears every
 * one of them, so tests can provably reset the whole guard's mutable state
 * (see __tests__/unit/guard-hotpath.test.js and guard-halt-cache.test.js).
 */

import { baseAgentId } from '../agent-identity-resolve';
import type { GuardSql, PolicyRow } from './types';
import type { CalibrationSettings, CalibrationState } from './calibration';
import { parseCalibrationSettings } from './calibration';

// Hot-path caches (pattern: middleware apiKeyCache). Guard is invoked on every
// governed tool call; policies and the predictive-risk settings change rarely.
// TTL is short (≤60s per the enforcement contract) and policy mutations
// invalidate eagerly via invalidateGuardPolicyCache().
const GUARD_CACHE_TTL_MS = 30_000;

// Policies do NOT ride the 30s TTL: eager invalidation only reaches the
// instance that served the policy write, so on multi-instance deploys a warm
// lambda kept enforcing the OLD policy set for up to 30s (observed live
// 2026-08-13: a freshly created require_approval policy answered `allow` with
// zero matched policies until another instance's cache expired). Same
// rationale and bound as the halt cache below: cross-instance policy lag is
// held at human-reaction scale (~3s) for ≤1 policy query per org per 3s per
// instance. Pinned by guard-hotpath.test.js ("ANOTHER instance").
const POLICY_CACHE_TTL_MS = 3_000;
const policyCache = new Map<string, { rows: PolicyRow[]; expires: number }>();
export interface OrgHaltState {
  halted: boolean;
  actor?: string;
  reason?: string;
  at?: string;
}

const predictiveSettingsCache = new Map<string, { enabled: boolean; threshold: number; expires: number }>();
const riskTemplateCache = new Map<string, { rows: Array<Record<string, unknown>>; expires: number }>();

// Calibrated interruption controller (calibration.ts). Settings ride the same
// single settings read as the predictive cache; the θ/e-process state row is
// loaded lazily ONLY when the controller mode is shadow|active, so the
// default-off path costs zero extra round trips.
const calibrationSettingsCache = new Map<string, { settings: CalibrationSettings; expires: number }>();
const calibrationStateCache = new Map<string, { state: CalibrationState | null; expires: number }>();

// The org kill switch gets its OWN short cache, not the 30s settings TTL:
// /api/halt invalidates eagerly only on the instance that served the request,
// so on multi-instance deploys the other warm lambdas honor a halt only when
// their cache expires. 3s bounds that cross-instance lag at human-reaction
// scale while keeping the hot path at ≤1 halt query per org per 3s per
// instance. Pinned by __tests__/unit/guard-halt-cache.test.js.
const HALT_CACHE_TTL_MS = 3_000;
const orgHaltCache = new Map<string, { halt: OrgHaltState | null; expires: number }>();

/**
 * Operator-set approval pause: while `until` is in the future, require_approval
 * verdicts proceed instead of queueing for a human (see applyApprovalPause in
 * evaluate.ts for what it deliberately does NOT cover). Shares the halt cache's
 * 3s TTL rather than the 30s settings TTL, for the same reason: RESUMING
 * governance is a safety action and must not lag a warm instance by half a
 * minute. It rides the settings read halt already forces, so it costs no extra
 * round trip.
 */
export const APPROVAL_PAUSE_KEY = 'DASHCLAW_APPROVAL_PAUSE';
export interface ApprovalPauseState {
  /** ISO timestamp. The pause is inert once this passes — expiry is evaluated
   *  on every read, so a stale cache entry can never extend it. */
  until: string;
  actor?: string | null;
  reason?: string | null;
  at?: string | null;
}
const approvalPauseCache = new Map<string, { pause: ApprovalPauseState | null; expires: number }>();

// Bound cache growth: nothing removed these maps between the targeted
// invalidate* calls below and __resetGuardCaches() (test-only), so an org
// evaluated once and never touched again left an entry resident for the
// process lifetime — six per org across the maps below. Mirrors
// middleware.js's pruneApiKeyCache: only does work once a map exceeds the
// cap (cheap on every .set() otherwise), drops expired entries first, then
// oldest-by-insertion-order if still over.
export const GUARD_CACHE_MAX_ENTRIES = 5_000;
function pruneCache<V extends { expires: number }>(cache: Map<string, V>, now: number): void {
  if (cache.size <= GUARD_CACHE_MAX_ENTRIES) return;
  for (const [k, v] of cache.entries()) {
    if (v.expires <= now) cache.delete(k);
  }
  if (cache.size > GUARD_CACHE_MAX_ENTRIES) {
    let toDelete = cache.size - GUARD_CACHE_MAX_ENTRIES;
    for (const key of cache.keys()) {
      cache.delete(key);
      toDelete--;
      if (toDelete <= 0) break;
    }
  }
}

/** Called by policy mutation paths so a changed policy takes effect immediately. */
export function invalidateGuardPolicyCache(orgId?: string): void {
  if (orgId) policyCache.delete(orgId);
  else policyCache.clear();
}

/** Called by risk-template mutation paths so edited weights apply immediately. */
export function invalidateGuardRiskTemplateCache(orgId?: string): void {
  if (orgId) riskTemplateCache.delete(orgId);
  else riskTemplateCache.clear();
}

/**
 * Called by the /api/halt endpoint so the org kill switch takes effect
 * immediately instead of after the ~30s settings-cache TTL.
 */
export function invalidateGuardSettingsCache(orgId?: string): void {
  if (orgId) {
    predictiveSettingsCache.delete(orgId);
    orgHaltCache.delete(orgId);
    approvalPauseCache.delete(orgId);
    calibrationSettingsCache.delete(orgId);
    calibrationStateCache.delete(orgId);
  } else {
    predictiveSettingsCache.clear();
    orgHaltCache.clear();
    approvalPauseCache.clear();
    calibrationSettingsCache.clear();
    calibrationStateCache.clear();
  }
}

/**
 * Called by the calibration feedback path and the controller route so a θ
 * update / mode flip / alarm reset reaches the guard within the instance
 * immediately (other warm instances converge within the 30s TTL; policy
 * edits converge faster — see POLICY_CACHE_TTL_MS).
 */
export function invalidateGuardCalibrationCache(orgId?: string): void {
  if (orgId) {
    calibrationSettingsCache.delete(orgId);
    calibrationStateCache.delete(orgId);
  } else {
    calibrationSettingsCache.clear();
    calibrationStateCache.clear();
  }
}

/**
 * Read just the org kill-switch (halt) state, from its own dedicated 3s
 * cache (NOT the 30s predictive-settings cache — a halt must reach every
 * warm instance within human-reaction time, and eager invalidation only
 * covers the instance that served /api/halt). Used by evaluateGuard and by
 * the guard route's pre-replay halt check: the idempotency replay
 * short-circuit must NOT absorb an emergency halt the way it deliberately
 * absorbs ordinary retries (halt is an override with its own immediate-block
 * guarantee, not a policy change).
 */
export async function getOrgHaltState(sql: GuardSql, orgId: string): Promise<OrgHaltState | null> {
  const hit = orgHaltCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.halt;
  return (await loadGeneralSettings(sql, orgId)).halt;
}

/**
 * The org's approval pause, or null when none is set OR the set one has
 * expired. Expiry is decided here, on every read, against `until` — so a
 * forgotten pause turns itself off without a cron, a reaper, or a write, and
 * a warm cache entry can never keep an expired pause alive.
 */
export async function getActiveApprovalPause(sql: GuardSql, orgId: string): Promise<ApprovalPauseState | null> {
  const hit = approvalPauseCache.get(orgId);
  const pause = hit && hit.expires > Date.now()
    ? hit.pause
    : (await loadGeneralSettings(sql, orgId)).approvalPause;
  return approvalPauseIsActive(pause) ? pause : null;
}

/** Shared by the guard pass, the API route and the UI, so "is it on?" is
 *  answered the same way everywhere. */
export function approvalPauseIsActive(pause: ApprovalPauseState | null | undefined): pause is ApprovalPauseState {
  if (!pause || typeof pause.until !== 'string') return false;
  const until = Date.parse(pause.until);
  return Number.isFinite(until) && until > Date.now();
}

/** Test-only: clear all guard hot-path caches. */
export function __resetGuardCaches(): void {
  policyCache.clear();
  predictiveSettingsCache.clear();
  riskTemplateCache.clear();
  orgHaltCache.clear();
  approvalPauseCache.clear();
  calibrationSettingsCache.clear();
  calibrationStateCache.clear();
}

// Active org risk templates, served from the short-TTL cache (same pattern as
// loadOrgPolicies — guard is the hot path, templates change rarely).
// Best-effort: a template-load failure must never block guard.
export async function loadOrgRiskTemplates(sql: GuardSql, orgId: string): Promise<Array<Record<string, unknown>>> {
  const hit = riskTemplateCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.rows;
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = await sql`
      SELECT id, name, action_type, base_risk, rules, status
      FROM risk_templates
      WHERE org_id = ${orgId} AND status = 'active'
    `;
  } catch (err) {
    console.warn('[Guard] risk_templates load failed (continuing without templates):', (err as Error).message);
  }
  const now = Date.now();
  riskTemplateCache.set(orgId, { rows, expires: now + GUARD_CACHE_TTL_MS });
  pruneCache(riskTemplateCache, now);
  return rows;
}

// Active org policies, served from their own 3s cache (one DB round-trip per
// org per 3s window instead of one per governed call — see POLICY_CACHE_TTL_MS
// for why this is shorter than the 30s settings TTL).
async function loadOrgPolicies(sql: GuardSql, orgId: string): Promise<PolicyRow[]> {
  const hit = policyCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.rows;
  // created_at rides along for the allow_grant TTL (F1): a legacy grant with
  // no rules.expires_at ages out from its row age — see grantExpiresAt.
  const allPolicies = await sql`
    SELECT id, name, policy_type, rules, agent_ids, created_at
    FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
  ` as PolicyRow[];
  const now = Date.now();
  policyCache.set(orgId, { rows: allPolicies, expires: now + POLICY_CACHE_TTL_MS });
  pruneCache(policyCache, now);
  return allPolicies;
}

// Load active org policies and filter to those that apply to this agent
// (null/empty agent_ids = all agents; malformed scope fails closed).
export async function loadApplicablePolicies(sql: GuardSql, orgId: string, currentAgentId: string | null): Promise<PolicyRow[]> {
  const allPolicies = await loadOrgPolicies(sql, orgId);
  return (allPolicies as PolicyRow[]).filter((p) => {
    if (!p.agent_ids) return true; // null/empty = applies to all
    try {
      const scoped = JSON.parse(p.agent_ids);
      if (!Array.isArray(scoped) || scoped.length === 0) return true;
      if (!currentAgentId) return false;
      // Composed sub-agent ids (<parent>:<type>) inherit the parent's
      // targeted policies — without this, flipping the sub-agent identity
      // default to `distinct` would silently detach every agent-targeted
      // policy from delegated work. Exact composed entries also match.
      const base = baseAgentId(currentAgentId);
      return scoped.includes(currentAgentId) || Boolean(base && scoped.includes(base));
    } catch (parseErr) {
      // Fail closed on malformed scope data: skip the policy rather than silently
      // widening a targeted rule to govern every agent in the org.
      console.error('[GUARD] Skipping policy with malformed agent_ids:', p.id, (parseErr as Error).message);
      return false;
    }
  });
}

// Predictive-risk org settings, served from the short-TTL cache so the
// settings table is read at most once per org per TTL window. (The org kill
// switch deliberately does NOT ride this entry — it has its own 3s cache in
// getOrgHaltState so a halt reaches every warm instance fast.)
function parseJsonSetting<T>(value: unknown): T | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function parseHaltSetting(value: unknown): OrgHaltState | null {
  return parseJsonSetting<OrgHaltState>(value);
}

// ONE settings read fills the predictive (30s), halt (3s) AND calibration
// (30s) caches. The halt entry expiring first is what bounds cross-instance
// halt lag at ~3s; each halt refresh re-fills the other entries too (fresher
// than their TTL requires, never staler). Cold evaluations still cost exactly
// one settings query — the guard-hotpath round-trip budget counts on it.
async function loadGeneralSettings(sql: GuardSql, orgId: string): Promise<{ enabled: boolean; threshold: number; halt: OrgHaltState | null; approvalPause: ApprovalPauseState | null }> {
  const { getSettings } = await import('../repositories/settings.repository');
  const riskSettings = await getSettings(sql, orgId, { category: 'general' });
  const settingsList = riskSettings as Array<Record<string, unknown>>;
  const now = Date.now();
  const predictive = {
    enabled: settingsList.find((s) => s.key === 'PREDICTIVE_RISK_ENABLED')?.value === 'true',
    threshold: parseInt(String(settingsList.find((s) => s.key === 'PREDICTIVE_RISK_THRESHOLD')?.value ?? ''), 10) || 60,
    expires: now + GUARD_CACHE_TTL_MS,
  };
  const halt = parseHaltSetting(settingsList.find((s) => s.key === 'DASHCLAW_ORG_HALT')?.value);
  const approvalPause = parseJsonSetting<ApprovalPauseState>(
    settingsList.find((s) => s.key === APPROVAL_PAUSE_KEY)?.value,
  );
  predictiveSettingsCache.set(orgId, predictive);
  pruneCache(predictiveSettingsCache, now);
  orgHaltCache.set(orgId, { halt, expires: now + HALT_CACHE_TTL_MS });
  pruneCache(orgHaltCache, now);
  approvalPauseCache.set(orgId, { pause: approvalPause, expires: now + HALT_CACHE_TTL_MS });
  pruneCache(approvalPauseCache, now);
  calibrationSettingsCache.set(orgId, {
    settings: parseCalibrationSettings(settingsList as Array<{ key?: unknown; value?: unknown }>),
    expires: now + GUARD_CACHE_TTL_MS,
  });
  pruneCache(calibrationSettingsCache, now);
  return { enabled: predictive.enabled, threshold: predictive.threshold, halt, approvalPause };
}

async function getCalibrationSettings(sql: GuardSql, orgId: string): Promise<CalibrationSettings> {
  const hit = calibrationSettingsCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.settings;
  await loadGeneralSettings(sql, orgId);
  // loadGeneralSettings always fills the entry; fall back defensively anyway.
  return calibrationSettingsCache.get(orgId)?.settings ?? parseCalibrationSettings([]);
}

/**
 * Hot-path runtime for the calibrated interruption controller: null when the
 * controller is off (the default — costs at most the shared settings read).
 * When shadow|active, the org's θ/e-process state row is loaded through its
 * own 30s cache; a missing row (org never adjudicated anything) yields a
 * fresh default state so shadow assessment still records. Best-effort: a
 * state-load failure returns null and never blocks guard.
 */
export async function getCalibrationRuntime(
  sql: GuardSql,
  orgId: string,
): Promise<{ settings: CalibrationSettings; state: CalibrationState } | null> {
  const settings = await getCalibrationSettings(sql, orgId);
  if (settings.mode === 'off') return null;
  const hit = calibrationStateCache.get(orgId);
  if (hit && hit.expires > Date.now()) {
    return hit.state ? { settings, state: hit.state } : null;
  }
  try {
    const [{ getCalibrationState }, { freshCalibrationState }] = await Promise.all([
      import('../repositories/calibration-state.repository'),
      import('./calibration'),
    ]);
    const state = (await getCalibrationState(sql, orgId)) ?? freshCalibrationState();
    const now = Date.now();
    calibrationStateCache.set(orgId, { state, expires: now + GUARD_CACHE_TTL_MS });
    pruneCache(calibrationStateCache, now);
    return { settings, state };
  } catch (err) {
    console.warn('[Guard] calibration state load failed (continuing without):', (err as Error).message);
    const now = Date.now();
    calibrationStateCache.set(orgId, { state: null, expires: now + GUARD_CACHE_TTL_MS });
    pruneCache(calibrationStateCache, now);
    return null;
  }
}

export async function getPredictiveSettings(sql: GuardSql, orgId: string): Promise<{ enabled: boolean; threshold: number }> {
  const hit = predictiveSettingsCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit;
  return loadGeneralSettings(sql, orgId);
}
