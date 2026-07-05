/**
 * The mandatory audit-persist path: the guard_decisions row IS the evidence.
 */

import type { GuardSql, GuardDecisionInsert } from './types';

// SECURITY (R2): the guard_decisions row IS the audit evidence — losing it means
// the platform cannot prove what it decided. Await it and fail loudly.
// Exported for the doctor write-path canary, which must exercise this exact
// INSERT (column list included) to prove the audit path on fresh schemas.
export async function persistGuardDecision(sql: GuardSql, row: GuardDecisionInsert): Promise<void> {
  try {
    await sql`
      INSERT INTO guard_decisions (id, org_id, agent_id, agent_name, verification_status, replay_status, jti, act_status, act_hash, decision, reason, matched_policies, context, evidence, risk_score, action_type, created_at, degraded)
      VALUES (
        ${row.decisionId},
        ${row.orgId},
        ${row.agentId},
        ${row.agentName},
        ${row.verificationStatus},
        ${row.replayStatus},
        ${row.jti},
        ${row.actStatus},
        ${row.actHash},
        ${row.decision},
        ${row.reason},
        ${JSON.stringify(row.matchedPolicies)},
        ${JSON.stringify(row.context)},
        ${row.evidence},
        ${row.riskScore},
        ${row.actionType},
        ${row.createdAt},
        ${row.degraded}
      )
    `;
  } catch (err) {
    console.error('[Guard] CRITICAL: failed to persist required guard_decisions audit row:', (err as Error)?.message || err);
    throw Object.assign(
      new Error('Guard decision could not be durably recorded; refusing to return an unaudited decision.'),
      { code: 'GUARD_AUDIT_PERSIST_FAILED' },
    );
  }
}
