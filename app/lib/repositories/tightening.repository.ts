// app/lib/repositories/tightening.repository.ts
// Tightening proposals (roadmap v3.2: findings become proposals).
// Spec: docs/superpowers/specs/2026-07-03-findings-become-proposals-design.md
//
// Two halves, mirroring calibration.repository.ts:
//  1. The ungoverned-allow evidence loader — the same predicate posture's
//     getRecentDecisions uses (decision='allow' at risk_score>=50, synthetic
//     traffic excluded in SQL BEFORE the LIMIT — the v3.1 lesson), but with a
//     parameterized window/limit and a smoke-harness-only synthetic toggle.
//  2. CRUD for tightening_proposal_decisions (drizzle/0042): the human's
//     ratify/dismiss judgment, keyed by the engine's content-stable tp_ id.

import type { SqlTag } from '../types/db';
import {
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
  SYNTHETIC_AGENT_LIKE_PATTERNS,
} from '../calibration-mining.js';
import type { UngovernedDecisionRow } from '../posture/tightening';

/** Wider than posture's incident LIMIT 100 — proposal evidence counts should
 *  stay truthful on busy orgs; one week of high-risk allows fits well under it. */
const DEFAULT_ROW_LIMIT = 2000;

export interface TighteningDecisionRow {
  id: number;
  org_id: string;
  proposal_id: string;
  rule: string;
  decision: 'ratified' | 'dismissed';
  action_type: string | null;
  risk_level: string | null;
  finding_key: string | null;
  snapshot: Record<string, unknown> | null;
  policy_id: string | null;
  reason: string | null;
  decided_by: string | null;
  decided_at: string;
}

export interface TighteningDecisionInput {
  proposalId: string;
  rule: string;
  decision: 'ratified' | 'dismissed';
  actionType: string | null;
  riskLevel: string | null;
  findingKey: string | null;
  snapshot: Record<string, unknown> | null;
  policyId: string | null;
  reason: string | null;
  decidedBy: string | null;
}

/**
 * Ungoverned-allow decisions for the window (the tightening evidence).
 * includeSynthetic exists ONLY for the policy-smoke harness (?include_synthetic=1)
 * — it affects one response, never posture, and lets smoke prove the pipeline
 * with its own marked traffic without polluting the real proposal queue.
 */
export async function getUngovernedAllowDecisions(
  sql: SqlTag,
  orgId: string,
  days: number,
  opts: { includeSynthetic?: boolean; limit?: number } = {},
): Promise<UngovernedDecisionRow[]> {
  const limit = opts.limit ?? DEFAULT_ROW_LIMIT;
  const rows = await sql.query(
    `SELECT id, risk_score, action_type, agent_id, created_at
     FROM guard_decisions
     WHERE org_id = $1
       AND decision = 'allow'
       AND risk_score >= 50
       -- ::timestamptz matters: created_at is TEXT on fresh drizzle schemas
       -- (posture.repository.ts convention).
       AND created_at::timestamptz > NOW() - make_interval(days => $2::int)
       AND ($3::boolean OR (
         (action_type IS NULL OR action_type NOT LIKE ALL($4::text[]))
         AND (agent_id IS NULL OR agent_id NOT LIKE ALL($5::text[]))
       ))
     ORDER BY created_at::timestamptz DESC
     LIMIT $6`,
    [
      orgId,
      days,
      opts.includeSynthetic === true,
      SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
      SYNTHETIC_AGENT_LIKE_PATTERNS,
      limit,
    ],
  );
  return rows as unknown as UngovernedDecisionRow[];
}

/** All decision rows for the org, newest judgment first. */
export async function getTighteningDecisions(
  sql: SqlTag,
  orgId: string,
): Promise<TighteningDecisionRow[]> {
  const rows = await sql.query(
    `SELECT * FROM tightening_proposal_decisions
     WHERE org_id = $1
     ORDER BY decided_at DESC`,
    [orgId],
  );
  return rows as unknown as TighteningDecisionRow[];
}

/** Record (or overwrite) the human's judgment on a proposal. */
export async function upsertTighteningDecision(
  sql: SqlTag,
  orgId: string,
  input: TighteningDecisionInput,
): Promise<TighteningDecisionRow | undefined> {
  const rows = await sql.query(
    `INSERT INTO tightening_proposal_decisions
       (org_id, proposal_id, rule, decision, action_type, risk_level,
        finding_key, snapshot, policy_id, reason, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (org_id, proposal_id) DO UPDATE SET
       rule = EXCLUDED.rule,
       decision = EXCLUDED.decision,
       action_type = EXCLUDED.action_type,
       risk_level = EXCLUDED.risk_level,
       finding_key = EXCLUDED.finding_key,
       snapshot = EXCLUDED.snapshot,
       policy_id = EXCLUDED.policy_id,
       reason = EXCLUDED.reason,
       decided_by = EXCLUDED.decided_by,
       decided_at = now()
     RETURNING *`,
    [
      orgId,
      input.proposalId,
      input.rule,
      input.decision,
      input.actionType,
      input.riskLevel,
      input.findingKey,
      input.snapshot == null ? null : JSON.stringify(input.snapshot),
      input.policyId,
      input.reason,
      input.decidedBy,
    ],
  );
  return (rows as unknown as TighteningDecisionRow[])[0];
}

/** Undo — removes the judgment entirely (the created policy, if any, stays:
 *  it is a first-class guard policy now, managed at /policies). */
export async function deleteTighteningDecision(
  sql: SqlTag,
  orgId: string,
  proposalId: string,
): Promise<TighteningDecisionRow | null> {
  const rows = await sql.query(
    `DELETE FROM tightening_proposal_decisions
     WHERE org_id = $1 AND proposal_id = $2
     RETURNING *`,
    [orgId, proposalId],
  );
  return (rows as unknown as TighteningDecisionRow[])[0] ?? null;
}
