// app/lib/doctor/checks/write-canary.mjs
//
// Write-path canary: actively exercises the platform's core write paths by
// running the REAL repository writers against a reserved canary org, then
// deleting the rows. Exists because two subsystems died silently behind
// best-effort catches this era (the fresh-install presence heartbeat being
// the canonical case) — a staleness probe cannot tell "no traffic yet" from
// "write path broken" on a fresh install; only an actual write can.
// A write path that errors is a FAIL, never a benign warn.
import { getSql } from '../../db';
import { getSetupStatus } from '../../setupStatus.mjs';
import { upsertAgentPresence } from '../../repositories/agents.repository';
import { createActionRecord } from '../../repositories/actions.repository';
import { persistGuardDecision, evaluateGuard, invalidateGuardPolicyCache } from '../../guard';

// The canary org satisfies the org_id foreign keys and isolates every canary
// row from real org-scoped surfaces (posture, mining, rate_limit windows,
// Mission Control). Global org iterators (e.g. the learning loop) do see the
// canary org itself; it is deliberately left in place — deleting it would
// race concurrent canary runs into FK failures — and it is empty outside a
// run's insert→delete window, so iterating it is a no-op.
export const CANARY_ORG_ID = 'org_doctor_canary';
const CANARY_AGENT_ID = 'doctor_write_canary';

const MIGRATE_FIX = {
  type: 'auto',
  description: 'Run database migrations to reconcile the schema with the code',
  action: 'migrate',
};

function check(id, status, title, message, fix = null) {
  return { id, category: 'write-canary', status, title, message, fix: status === 'fail' ? fix : null };
}

/**
 * Best-effort sweep of leftover canary rows from runs that died between
 * insert and cleanup. Missing tables are fine here — the canary write for
 * that table will produce the meaningful verdict.
 */
async function sweepLeftovers(sql) {
  for (const table of ['agent_presence', 'action_records', 'guard_decisions', 'guard_policies']) {
    try {
      if (table === 'agent_presence') await sql`DELETE FROM agent_presence WHERE org_id = ${CANARY_ORG_ID}`;
      if (table === 'action_records') await sql`DELETE FROM action_records WHERE org_id = ${CANARY_ORG_ID}`;
      if (table === 'guard_decisions') await sql`DELETE FROM guard_decisions WHERE org_id = ${CANARY_ORG_ID}`;
      if (table === 'guard_policies') await sql`DELETE FROM guard_policies WHERE org_id = ${CANARY_ORG_ID}`;
    } catch (err) {
      console.warn(`[Doctor] write-canary: leftover sweep of ${table} failed:`, err?.message || err);
    }
  }
}

/**
 * @param {{ env?: object }} options
 */
export async function runChecks({ env = process.env } = {}) {
  const checks = [];

  const dbStatus = await getSetupStatus(env);
  if (!dbStatus.configured) return checks;

  let sql;
  try {
    sql = getSql();
  } catch {
    return checks;
  }

  await sweepLeftovers(sql);

  const now = new Date().toISOString();
  const runId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}`).replace(/-/g, '').slice(0, 12);

  // Bootstrap: the canary org row. Itself a canary for the organizations
  // write path; everything downstream FK-references it, so a failure here
  // stops the run instead of cascading confusing FK errors.
  try {
    await sql`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES (${CANARY_ORG_ID}, 'Doctor write-path canary', 'doctor-write-canary', 'internal')
      ON CONFLICT (id) DO NOTHING
    `;
    checks.push(check('canary_organizations', 'pass', 'Organizations write path',
      'Canary org row upserted — organizations accepts writes.'));
  } catch (err) {
    checks.push(check('canary_organizations', 'fail', 'Organizations write path',
      `Organizations write path is dead on this schema: ${err?.message || err}`, MIGRATE_FIX));
    return checks;
  }

  // Presence heartbeat — the historical silent death. Exercises the exact
  // upsert (columns + conflict target) the heartbeat route runs.
  try {
    const rows = await upsertAgentPresence(sql, CANARY_ORG_ID, {
      agent_id: CANARY_AGENT_ID,
      agent_name: 'Doctor write-path canary',
      status: 'online',
      current_task_id: null,
      metadata: { canary: true },
      timestamp: now,
    });
    if (!rows || rows.length === 0) throw new Error('upsert returned no row');
    checks.push(check('canary_agent_presence', 'pass', 'Agent presence write path (heartbeats)',
      'Live heartbeat upsert landed and was cleaned up.'));
  } catch (err) {
    checks.push(check('canary_agent_presence', 'fail', 'Agent presence write path (heartbeats)',
      `Heartbeat write path is dead — agents cannot report presence: ${err?.message || err}`, MIGRATE_FIX));
  } finally {
    try {
      await sql`DELETE FROM agent_presence WHERE org_id = ${CANARY_ORG_ID} AND agent_id = ${CANARY_AGENT_ID}`;
    } catch (err) {
      console.warn('[Doctor] write-canary: agent_presence cleanup failed:', err?.message || err);
    }
  }

  // Action ledger — the same INSERT shape POST /api/actions runs.
  const actionId = `act_doctor_canary_${runId}`;
  try {
    const row = await createActionRecord(sql, {
      orgId: CANARY_ORG_ID,
      action_id: actionId,
      actionStatus: 'completed',
      costEstimate: 0,
      signature: null,
      verified: false,
      timestamp_start: now,
      data: {
        agent_id: CANARY_AGENT_ID,
        action_type: 'other',
        declared_goal: 'Doctor write-path canary (synthetic, deleted immediately)',
        reversible: true,
      },
    });
    if (!row) throw new Error('insert returned no row');
    checks.push(check('canary_action_records', 'pass', 'Action ledger write path',
      'Live action-record insert landed and was cleaned up.'));
  } catch (err) {
    checks.push(check('canary_action_records', 'fail', 'Action ledger write path',
      `Action ledger write path is dead — agents cannot record actions: ${err?.message || err}`, MIGRATE_FIX));
  } finally {
    try {
      await sql`DELETE FROM action_records WHERE org_id = ${CANARY_ORG_ID} AND action_id = ${actionId}`;
    } catch (err) {
      console.warn('[Doctor] write-canary: action_records cleanup failed:', err?.message || err);
    }
  }

  // Guard audit ledger — the row evaluateGuard refuses to decide without.
  const decisionId = `gd_doctor_canary_${runId}`;
  try {
    await persistGuardDecision(sql, {
      decisionId,
      orgId: CANARY_ORG_ID,
      agentId: CANARY_AGENT_ID,
      agentName: 'Doctor write-path canary',
      verificationStatus: 'unverified',
      replayStatus: 'none',
      jti: null,
      actStatus: 'none',
      actHash: null,
      decision: 'allow',
      reason: 'Doctor write-path canary (synthetic, deleted immediately)',
      matchedPolicies: [],
      context: { canary: true },
      evidence: null,
      riskScore: 0,
      actionType: 'other',
      createdAt: now,
      degraded: false,
    });
    const rows = await sql`SELECT id FROM guard_decisions WHERE id = ${decisionId} AND org_id = ${CANARY_ORG_ID}`;
    if (!rows || rows.length === 0) throw new Error('audit row not readable after insert');
    checks.push(check('canary_guard_decisions', 'pass', 'Guard audit write path',
      'Live guard-decision insert landed, read back, and was cleaned up.'));
  } catch (err) {
    checks.push(check('canary_guard_decisions', 'fail', 'Guard audit write path',
      `Guard audit write path is dead — every guard evaluation on this instance will 5xx: ${err?.message || err}`, MIGRATE_FIX));
  } finally {
    try {
      await sql`DELETE FROM guard_decisions WHERE id = ${decisionId} AND org_id = ${CANARY_ORG_ID}`;
    } catch (err) {
      console.warn('[Doctor] write-canary: guard_decisions cleanup failed:', err?.message || err);
    }
  }

  // Enforcement canary — the check the others can't make: an ACTIVE policy
  // actually flips a live decision. Inserts a block policy in the canary org,
  // runs the REAL evaluateGuard (policy load → evaluation → decision → audit
  // persist), and requires the decision to come back `block` with its audit
  // row readable. "Policies configured" and "tables writable" can both pass
  // while evaluation silently allows everything; only this proves enforcement.
  const canaryPolicyId = `gp_doctor_canary_${runId}`;
  try {
    await sql`
      INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active)
      VALUES (${canaryPolicyId}, ${CANARY_ORG_ID}, 'Doctor enforcement canary', 'block_action_type',
              ${JSON.stringify({ action_types: ['doctor_canary_probe'] })}, 1)
    `;
    invalidateGuardPolicyCache(CANARY_ORG_ID);
    const result = await evaluateGuard(CANARY_ORG_ID, {
      agent_id: CANARY_AGENT_ID,
      agent_name: 'Doctor write-path canary',
      action_type: 'doctor_canary_probe',
      declared_goal: 'Doctor enforcement canary probe (synthetic, deleted immediately)',
      reversible: true,
    }, sql);
    if (result.decision !== 'block') {
      throw new Error(`expected decision "block", got "${result.decision}"${result.degraded ? ' (evaluation was DEGRADED — fallback answered, not the policy pass)' : ''}`);
    }
    const auditRows = await sql`SELECT id FROM guard_decisions WHERE id = ${result.decision_id} AND org_id = ${CANARY_ORG_ID}`;
    if (!auditRows || auditRows.length === 0) throw new Error('block decision returned but its audit row is not readable');
    checks.push(check('canary_guard_enforcement', 'pass', 'Guard enforcement (end to end)',
      'A live block policy was loaded, evaluated, enforced (decision: block), and audited — governance is actually governing.'));
  } catch (err) {
    checks.push(check('canary_guard_enforcement', 'fail', 'Guard enforcement (end to end)',
      `Enforcement canary did NOT produce an audited block — active policies may not be enforcing: ${err?.message || err}`));
  } finally {
    try {
      await sql`DELETE FROM guard_policies WHERE id = ${canaryPolicyId} AND org_id = ${CANARY_ORG_ID}`;
      invalidateGuardPolicyCache(CANARY_ORG_ID);
      await sql`DELETE FROM guard_decisions WHERE org_id = ${CANARY_ORG_ID}`;
    } catch (err) {
      console.warn('[Doctor] write-canary: enforcement canary cleanup failed:', err?.message || err);
    }
  }

  return checks;
}
