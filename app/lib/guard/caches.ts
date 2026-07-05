/**
 * ALL module-level mutable state for the guard engine lives here: the policy,
 * risk-template, predictive-settings and org-halt caches, their invalidation
 * hooks, and the loaders that fill them. `__resetGuardCaches()` clears every
 * one of them, so tests can provably reset the whole guard's mutable state
 * (see __tests__/unit/guard-hotpath.test.js and guard-halt-cache.test.js).
 */

import { baseAgentId } from '../agent-identity-resolve';
import type { GuardSql, PolicyRow } from './types';

// Hot-path caches (pattern: middleware apiKeyCache). Guard is invoked on every
// governed tool call; policies and the predictive-risk settings change rarely.
// TTL is short (≤60s per the enforcement contract) and policy mutations
// invalidate eagerly via invalidateGuardPolicyCache().
const GUARD_CACHE_TTL_MS = 30_000;
const policyCache = new Map<string, { rows: PolicyRow[]; expires: number }>();
export interface OrgHaltState {
  halted: boolean;
  actor?: string;
  reason?: string;
  at?: string;
}

const predictiveSettingsCache = new Map<string, { enabled: boolean; threshold: number; expires: number }>();
const riskTemplateCache = new Map<string, { rows: Array<Record<string, unknown>>; expires: number }>();

// The org kill switch gets its OWN short cache, not the 30s settings TTL:
// /api/halt invalidates eagerly only on the instance that served the request,
// so on multi-instance deploys the other warm lambdas honor a halt only when
// their cache expires. 3s bounds that cross-instance lag at human-reaction
// scale while keeping the hot path at ≤1 halt query per org per 3s per
// instance. Pinned by __tests__/unit/guard-halt-cache.test.js.
const HALT_CACHE_TTL_MS = 3_000;
const orgHaltCache = new Map<string, { halt: OrgHaltState | null; expires: number }>();

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
  } else {
    predictiveSettingsCache.clear();
    orgHaltCache.clear();
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

/** Test-only: clear all guard hot-path caches. */
export function __resetGuardCaches(): void {
  policyCache.clear();
  predictiveSettingsCache.clear();
  riskTemplateCache.clear();
  orgHaltCache.clear();
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
  riskTemplateCache.set(orgId, { rows, expires: Date.now() + GUARD_CACHE_TTL_MS });
  return rows;
}

// Active org policies, served from the short-TTL cache (one DB round-trip per
// org per TTL window instead of one per governed call).
async function loadOrgPolicies(sql: GuardSql, orgId: string): Promise<PolicyRow[]> {
  const hit = policyCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.rows;
  const allPolicies = await sql`
    SELECT id, name, policy_type, rules, agent_ids
    FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
  ` as PolicyRow[];
  policyCache.set(orgId, { rows: allPolicies, expires: Date.now() + GUARD_CACHE_TTL_MS });
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
function parseHaltSetting(value: unknown): OrgHaltState | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as OrgHaltState) : null;
  } catch {
    return null;
  }
}

// ONE settings read fills BOTH caches — predictive (30s) and halt (3s). The
// halt entry expiring first is what bounds cross-instance halt lag at ~3s;
// each halt refresh re-fills the predictive entry too (fresher than its TTL
// requires, never staler). Cold evaluations still cost exactly one settings
// query — the guard-hotpath round-trip budget counts on it.
async function loadGeneralSettings(sql: GuardSql, orgId: string): Promise<{ enabled: boolean; threshold: number; halt: OrgHaltState | null }> {
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
  predictiveSettingsCache.set(orgId, predictive);
  orgHaltCache.set(orgId, { halt, expires: now + HALT_CACHE_TTL_MS });
  return { enabled: predictive.enabled, threshold: predictive.threshold, halt };
}

export async function getPredictiveSettings(sql: GuardSql, orgId: string): Promise<{ enabled: boolean; threshold: number }> {
  const hit = predictiveSettingsCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit;
  return loadGeneralSettings(sql, orgId);
}
