// app/lib/doctor/checks/governance.mjs
import { getSql } from '../../db';
import { getSetupStatus } from '../../setupStatus.mjs';
import { getGovernanceTables, getTable } from '../shape.mjs';
import { KNOWN_POLICY_TYPES } from '../../guard';

const STALENESS_DAYS = 7;

// Static integrity validation for one policy row: the same three conditions
// under which the guard engine silently skips an ACTIVE policy at evaluation
// time (unknown type / malformed rules / malformed agent_ids). A policy that
// trips any of these is on in the UI while enforcing nothing.
function policyIntegrityProblems(policy) {
  const problems = [];
  if (!KNOWN_POLICY_TYPES.includes(policy.policy_type)) {
    problems.push(`unknown policy_type "${policy.policy_type}"`);
  }
  try {
    JSON.parse(policy.rules);
  } catch {
    problems.push('rules is not valid JSON');
  }
  if (policy.agent_ids) {
    try {
      const scoped = JSON.parse(policy.agent_ids);
      if (!Array.isArray(scoped)) problems.push('agent_ids is not a JSON array');
    } catch {
      problems.push('agent_ids is not valid JSON');
    }
  }
  return problems;
}

/**
 * @param {{ env?: object, orgId?: string|null }} options
 */
export async function runChecks({ env = process.env, orgId = null } = {}) {
  const checks = [];

  // Tenant scope: API callers carry x-org-id; operator-local runs default to
  // org_default. Previously this file hardcoded org_default, so any other org
  // was shown org_default's governance state — a silent misreport.
  const scopeOrg = orgId || 'org_default';

  // The degraded-decision knob is env-level and instance-wide: if the guard
  // engine overruns its deadline or fails fast, this is what it answers.
  // 'allow' means governance FAILS OPEN on degradation — legal, but the
  // operator must see it as a standing posture, not discover it in a ledger.
  const fallback = String(env.DASHCLAW_GUARD_FALLBACK || '').toLowerCase();
  if (fallback === 'allow') {
    checks.push({
      id: 'gov_fallback_open',
      category: 'governance',
      status: 'warn',
      title: 'Guard degradation fallback',
      message:
        'DASHCLAW_GUARD_FALLBACK=allow — when guard evaluation degrades (deadline/error), actions PROCEED ungoverned (marked degraded in the ledger). Unset it or use require_approval/block to fail closed.',
      fix: null,
    });
  }

  // Only run DB-backed governance checks if DB is configured
  const dbStatus = await getSetupStatus(env);
  if (!dbStatus.configured) return checks;

  let sql;
  try {
    sql = getSql();
  } catch {
    return checks;
  }

  // Governance-domain tables come from the generated shape so renaming a table
  // in schema.js auto-propagates here. Names are committed strings — safe to
  // interpolate into template literals (Neon driver lacks sql.identifier()).
  const govTables = new Map(getGovernanceTables().map((t) => [t.name, t]));
  const policiesTable = govTables.get('guard_policies');
  const actionsTable = govTables.get('action_records');
  // guard_decisions carries no domain tag in the generated shape — look it up
  // by name so the degraded-decision probe doesn't silently no-op.
  const decisionsTable = getTable('guard_decisions');

  // Policies exist — and can actually enforce?
  if (policiesTable) {
    try {
      const activePolicies = await sql`
        SELECT id, name, policy_type, rules, agent_ids
        FROM guard_policies
        WHERE org_id = ${scopeOrg} AND active = 1
      `;
      const policyCount = activePolicies.length;

      checks.push({
        id: 'gov_policies',
        category: 'governance',
        status: policyCount > 0 ? 'pass' : 'warn',
        title: 'Governance Policies',
        message:
          policyCount > 0
            ? `${policyCount} active polic${policyCount === 1 ? 'y' : 'ies'}`
            : 'No governance policies configured — all actions will be allowed by default',
        fix:
          policyCount > 0
            ? null
            : {
                type: 'auto',
                description: 'Create a default log-all governance policy',
                action: 'create_default_policy',
              },
      });

      // Policy integrity: an ACTIVE policy the engine cannot run is the
      // worst governance lie — it shows as on while enforcing nothing.
      const broken = [];
      for (const p of activePolicies) {
        const problems = policyIntegrityProblems(p);
        if (problems.length) broken.push(`"${p.name}" (${p.id}): ${problems.join('; ')}`);
      }
      if (policyCount > 0) {
        checks.push({
          id: 'gov_policy_integrity',
          category: 'governance',
          status: broken.length === 0 ? 'pass' : 'fail',
          title: 'Policy Integrity',
          message:
            broken.length === 0
              ? 'Every active policy parses and dispatches — none are silently skipped at evaluation time'
              : `${broken.length} ACTIVE polic${broken.length === 1 ? 'y is' : 'ies are'} silently NOT enforcing: ${broken.slice(0, 5).join(' | ')}${broken.length > 5 ? ` (+${broken.length - 5} more)` : ''}. Fix or deactivate them in /policies.`,
          fix: null,
        });
      }
    } catch {
      // Table may not exist — covered by database checks
    }
  }

  // Degraded decisions: evaluations that overran the deadline or failed and
  // answered with the fallback instead of a full policy pass. A quiet trickle
  // of these means the org is partially governed and nobody is looking.
  if (decisionsTable) {
    try {
      const degraded = await sql`
        SELECT COUNT(*)::int AS count FROM guard_decisions
        WHERE org_id = ${scopeOrg}
          AND degraded = TRUE
          AND created_at::timestamptz > NOW() - INTERVAL '24 hours'
      `;
      const degradedCount = degraded[0]?.count ?? 0;
      if (degradedCount > 0) {
        checks.push({
          id: 'gov_degraded_decisions',
          category: 'governance',
          status: 'warn',
          title: 'Degraded Guard Decisions (24h)',
          message: `${degradedCount} guard decision${degradedCount === 1 ? '' : 's'} in the last 24h ${degradedCount === 1 ? 'was' : 'were'} degraded (deadline overrun or evaluation failure — the fallback answered, not the full policy pass). Inspect them in /decisions.`,
          fix: null,
        });
      }
    } catch {
      // degraded column may predate this schema — covered by shape checks
    }
  }

  // Observe-mode agents: hooks that report guard decisions but do not enforce
  // them (DASHCLAW_HOOK_MODE=observe — the installer default). The agent's
  // LATEST decision in 24h decides its posture, so a fleet flipped to enforce
  // clears immediately. Rows without the field (SDKs, MCP, old hooks) are
  // simply not counted — absence is "unreported", never "observe".
  if (decisionsTable) {
    try {
      const latestPerAgent = await sql`
        SELECT DISTINCT ON (agent_id) agent_id, context
        FROM guard_decisions
        WHERE org_id = ${scopeOrg}
          AND agent_id IS NOT NULL
          AND created_at::timestamptz > NOW() - INTERVAL '24 hours'
        ORDER BY agent_id, created_at::timestamptz DESC
      `;
      const observeAgents = [];
      for (const row of latestPerAgent) {
        try {
          const ctx = typeof row.context === 'string' ? JSON.parse(row.context) : row.context;
          if (ctx?.enforcement_mode === 'observe') observeAgents.push(row.agent_id);
        } catch { /* malformed context — not countable either way */ }
      }
      if (observeAgents.length > 0) {
        checks.push({
          id: 'gov_observe_mode',
          category: 'governance',
          status: 'warn',
          title: 'Agents in observe mode',
          message: `${observeAgents.length} agent${observeAgents.length === 1 ? '' : 's'} (${observeAgents.slice(0, 5).join(', ')}${observeAgents.length > 5 ? ', …' : ''}) ${observeAgents.length === 1 ? 'is' : 'are'} reporting guard decisions in OBSERVE mode — blocks and approval gates are logged but do NOT stop tool calls. Set DASHCLAW_HOOK_MODE=enforce on those agents when ready to enforce.`,
          fix: null,
        });
      }
    } catch {
      // context column shape may predate this — skip silently
    }
  }

  // Actions recorded?
  if (actionsTable) {
    try {
      const actions = await sql`SELECT COUNT(*)::int AS count FROM action_records WHERE org_id = ${scopeOrg}`;
      const actionCount = actions[0]?.count ?? 0;

      checks.push({
        id: 'gov_actions',
        category: 'governance',
        status: actionCount > 0 ? 'pass' : 'warn',
        title: 'Recorded Actions',
        message:
          actionCount > 0
            ? `${actionCount} action${actionCount === 1 ? '' : 's'} recorded`
            : 'No actions recorded yet — agents have not sent any governed actions',
        fix: null,
      });

      // Zombie running rows: actions stuck in 'running' well past any
      // plausible outcome window. The outcome sweep (cron + the lazy trigger
      // on the actions list) reconciles these to status='unknown'; if any
      // remain older than 24h, the sweep is not running on this instance.
      try {
        const zombies = await sql`
          SELECT COUNT(*)::int AS count FROM action_records
          WHERE org_id = ${scopeOrg}
            AND status = 'running'
            AND created_at < NOW() - INTERVAL '24 hours'
        `;
        const zombieCount = zombies[0]?.count ?? 0;
        if (zombieCount > 0) {
          checks.push({
            id: 'gov_zombie_running',
            category: 'governance',
            status: 'warn',
            title: 'Zombie running actions',
            message: `${zombieCount} action${zombieCount === 1 ? '' : 's'} ${zombieCount === 1 ? 'has' : 'have'} been stuck in 'running' for over 24h with no reported outcome — the ledger is implying work that is not happening. Opening /decisions triggers the reconciliation sweep; for continuous healing schedule the /api/cron/outcome-sweep job.`,
            fix: null,
          });
        }
      } catch { /* column drift — covered by shape checks */ }

      // Staleness check (only meaningful if some actions exist)
      if (actionCount > 0) {
        const recent = await sql`
          SELECT COUNT(*)::int AS count FROM action_records
          WHERE org_id = ${scopeOrg}
            AND created_at > NOW() - make_interval(days => ${STALENESS_DAYS})
        `;
        const recentCount = recent[0]?.count ?? 0;

        if (recentCount === 0) {
          checks.push({
            id: 'gov_stale',
            category: 'governance',
            status: 'warn',
            title: 'Governance Activity',
            message: `No actions recorded in the last ${STALENESS_DAYS} days — agents may have stopped reporting`,
            fix: null,
          });
        }
      }
    } catch {
      // Table may not exist
    }
  }

  return checks;
}
