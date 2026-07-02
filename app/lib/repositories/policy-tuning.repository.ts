// app/lib/repositories/policy-tuning.repository.ts
// Policy-tuning proposal loop data access (owner roadmap item 1).
// Spec: docs/superpowers/specs/2026-07-01-policy-tuning-proposal-loop.md
//
// Two aggregate reads over guard_decisions (+ the drizzle/0035 join to
// action_records for approval outcomes) and the dismissal-blob helpers.
// Per-policy evidence windows are clipped at guard_policies.updated_at in
// SQL: a config change resets the evidence, which also prevents an accepted
// proposal from immediately re-proposing off stale rows.

import type { SqlTag } from '../types/db';
import { getSettings, upsertSetting } from './settings.repository';
import type { DecisionMixRow, ApprovalOutcomeRow } from '../policy-tuning/engine';

const DISMISSED_KEY = 'policy_tuning_dismissed';
/** Entry-count cap; see also the serialized-size prune below (settings
 *  values are capped at 10k chars by upsertSetting). */
const DISMISSED_MAX_ENTRIES = 200;
const DISMISSED_MAX_CHARS = 9000;

export interface TuningDismissal {
  reason: string;
  by: string;
  at: string;
}

/**
 * Per-(policy, decision) fire counts over the last `days` days, clipped per
 * policy at updated_at. Same defensive unnest as getDecisionCountsByPolicy
 * (guardrails.repository.ts): only array-shaped JSON text is cast.
 */
export async function getDecisionMixByPolicy(
  sql: SqlTag,
  orgId: string,
  days = 30,
): Promise<DecisionMixRow[]> {
  const rows = await sql.query(
    `SELECT sub.policy_id AS policy_id,
            sub.decision AS decision,
            COUNT(*)::int AS cnt,
            MAX(sub.fired_at) AS last_fired
     FROM (
       SELECT jsonb_array_elements_text(gd.matched_policies::jsonb) AS policy_id,
              gd.decision AS decision,
              gd.created_at::timestamptz AS fired_at
       FROM guard_decisions gd
       WHERE gd.org_id = $1
         AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
         AND gd.matched_policies IS NOT NULL
         AND gd.matched_policies LIKE '[%'
     ) sub
     JOIN guard_policies gp ON gp.id = sub.policy_id AND gp.org_id = $1
     WHERE sub.fired_at > GREATEST(
       NOW() - make_interval(days => $2::int),
       COALESCE(gp.updated_at::timestamptz, '-infinity'::timestamptz)
     )
     GROUP BY sub.policy_id, sub.decision`,
    [orgId, days],
  );
  return rows as unknown as DecisionMixRow[];
}

/**
 * Approval outcomes of require_approval interruptions per policy, joined via
 * action_records.guard_decision_id (drizzle/0035; stamped going forward —
 * decisions without a linked record simply never appear here).
 *
 * Outcome predicates mirror recordApproval (actions.repository.ts):
 *   approved — approved_by set (only the admin approval routes set it, only
 *              on ALLOW);
 *   denied   — the '[HITL Decision: DENY' marker both single and bulk
 *              approval writes append to reasoning;
 *   pending  — still pending_approval.
 */
export async function getApprovalOutcomesByPolicy(
  sql: SqlTag,
  orgId: string,
  days = 30,
): Promise<ApprovalOutcomeRow[]> {
  const rows = await sql.query(
    `SELECT sub.policy_id AS policy_id,
            COUNT(*) FILTER (WHERE ar.approved_by IS NOT NULL)::int AS approved,
            COUNT(*) FILTER (
              WHERE ar.approved_by IS NULL
                AND ar.reasoning LIKE '%[HITL Decision: DENY%'
            )::int AS denied,
            COUNT(*) FILTER (WHERE ar.status = 'pending_approval')::int AS pending,
            MIN(sub.risk_score) FILTER (WHERE ar.approved_by IS NOT NULL)::int AS approved_min,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY sub.risk_score)
              FILTER (WHERE ar.approved_by IS NOT NULL)) AS approved_p50,
            MAX(sub.risk_score) FILTER (WHERE ar.approved_by IS NOT NULL)::int AS approved_max
     FROM (
       SELECT gd.id AS decision_id,
              jsonb_array_elements_text(gd.matched_policies::jsonb) AS policy_id,
              gd.created_at::timestamptz AS fired_at,
              gd.risk_score AS risk_score
       FROM guard_decisions gd
       WHERE gd.org_id = $1
         AND gd.decision = 'require_approval'
         AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
         AND gd.matched_policies IS NOT NULL
         AND gd.matched_policies LIKE '[%'
     ) sub
     JOIN action_records ar
       ON ar.guard_decision_id = sub.decision_id AND ar.org_id = $1
     JOIN guard_policies gp ON gp.id = sub.policy_id AND gp.org_id = $1
     WHERE sub.fired_at > GREATEST(
       NOW() - make_interval(days => $2::int),
       COALESCE(gp.updated_at::timestamptz, '-infinity'::timestamptz)
     )
     GROUP BY sub.policy_id`,
    [orgId, days],
  );
  return rows as unknown as ApprovalOutcomeRow[];
}

/** Read the dismissal blob ({} on missing/corrupt setting). */
export async function getTuningDismissals(
  sql: SqlTag,
  orgId: string,
): Promise<Record<string, TuningDismissal>> {
  const rows = await getSettings(sql, orgId, { key: DISMISSED_KEY });
  try {
    const parsed = JSON.parse((rows[0]?.value as string | null | undefined) || '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, TuningDismissal>) : {};
  } catch {
    return {};
  }
}

/**
 * Prune newest-first: entry-count cap, then serialized-size cap so the write
 * never trips upsertSetting's 10k value limit.
 */
export function pruneDismissals(
  blob: Record<string, TuningDismissal>,
): Record<string, TuningDismissal> {
  let entries = Object.entries(blob).sort(
    ([, a], [, b]) => String(b?.at || '').localeCompare(String(a?.at || '')),
  );
  if (entries.length > DISMISSED_MAX_ENTRIES) entries = entries.slice(0, DISMISSED_MAX_ENTRIES);
  while (entries.length > 0 && JSON.stringify(Object.fromEntries(entries)).length > DISMISSED_MAX_CHARS) {
    entries = entries.slice(0, -1);
  }
  return Object.fromEntries(entries);
}

export async function recordTuningDismissal(
  sql: SqlTag,
  orgId: string,
  proposalId: string,
  entry: TuningDismissal,
): Promise<void> {
  const blob = await getTuningDismissals(sql, orgId);
  blob[proposalId] = entry;
  await upsertSetting(sql, orgId, {
    key: DISMISSED_KEY,
    value: JSON.stringify(pruneDismissals(blob)),
    category: 'general',
  });
}

export async function removeTuningDismissal(
  sql: SqlTag,
  orgId: string,
  proposalId: string,
): Promise<boolean> {
  const blob = await getTuningDismissals(sql, orgId);
  if (!(proposalId in blob)) return false;
  delete blob[proposalId];
  await upsertSetting(sql, orgId, {
    key: DISMISSED_KEY,
    value: JSON.stringify(blob),
    category: 'general',
  });
  return true;
}
