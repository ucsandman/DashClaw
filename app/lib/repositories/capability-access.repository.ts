import type { SqlTag } from '../types/db';

interface AccessRuleRow {
  rule_id: unknown;
  org_id: unknown;
  capability_id: unknown;
  agent_id?: unknown;
  access: unknown;
  reason?: unknown;
  created_by?: unknown;
  created_at: unknown;
  [k: string]: unknown;
}

export function shapeAccessRule(row: AccessRuleRow | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    rule_id: row.rule_id,
    org_id: row.org_id,
    capability_id: row.capability_id,
    agent_id: row.agent_id || null,
    access: row.access,
    reason: row.reason || null,
    created_by: row.created_by || null,
    created_at: row.created_at,
  };
}

// Lower = more permissive. Unknown access values rank as deny (fail closed).
const ACCESS_SEVERITY: Record<string, number> = { allow: 0, require_approval: 1, deny: 2 };
const severityOf = (access: string): number => ACCESS_SEVERITY[access] ?? 2;

export interface AccessEvaluation {
  access: unknown;
  rule: Record<string, unknown> | null;
  identity_downgrade?: { asserted_access: string; reason: string };
}

export async function evaluateAccess(
  sql: SqlTag,
  orgId: string,
  capabilityId: string,
  agentId: string | null,
  { verified = false }: { verified?: boolean } = {},
): Promise<AccessEvaluation> {
  // Both candidate rules in one query: the agent-specific rule (if any) and
  // the org-wide default (agent_id IS NULL). The partial unique indexes
  // guarantee at most one of each.
  const rows = (await sql`
    SELECT rule_id, org_id, capability_id, agent_id, access, reason, created_by, created_at
    FROM capability_access_rules
    WHERE org_id = ${orgId}
      AND capability_id = ${capabilityId}
      AND (agent_id = ${agentId} OR agent_id IS NULL)
    ORDER BY agent_id IS NULL ASC
    LIMIT 2
  `) as AccessRuleRow[];

  const agentRule = rows.find((r) => r.agent_id != null);
  const orgRule = rows.find((r) => r.agent_id == null);
  const baselineAccess = String(orgRule?.access ?? 'allow');

  if (!agentRule) {
    return orgRule
      ? { access: orgRule.access, rule: shapeAccessRule(orgRule) }
      : { access: 'allow', rule: null };
  }

  const agentAccess = String(agentRule.access);
  // D1 identity gate (docs/architecture/trust-and-failure-model.md): agent_id
  // is self-asserted unless a JWKS JWT verified it. An UNVERIFIED assertion
  // must never obtain a MORE permissive outcome than the org default —
  // per-agent allowances require verified identity. Restrictive agent rules
  // still apply to the asserted id (they bind honest-but-drifting agents,
  // the actual threat model).
  if (!verified && severityOf(agentAccess) < severityOf(baselineAccess)) {
    return {
      access: baselineAccess,
      rule: orgRule ? shapeAccessRule(orgRule) : null,
      identity_downgrade: {
        asserted_access: agentAccess,
        reason: `Agent-specific '${agentAccess}' requires verified identity (JWT); unverified callers get the org default '${baselineAccess}'.`,
      },
    };
  }

  return { access: agentAccess, rule: shapeAccessRule(agentRule) };
}
