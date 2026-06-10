// app/lib/doctor/checks/governance.mjs
import { getSql } from '../../db';
import { getSetupStatus } from '../../setupStatus.mjs';
import { getGovernanceTables } from '../shape.mjs';

const STALENESS_DAYS = 7;

/**
 * @param {{ env?: object }} options
 */
export async function runChecks({ env = process.env } = {}) {
  const checks = [];

  // Only run governance checks if DB is configured
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

  // Policies exist?
  if (policiesTable) {
    try {
      const policies = await sql`SELECT COUNT(*)::int AS count FROM guard_policies WHERE org_id = 'org_default'`;
      const policyCount = policies[0]?.count ?? 0;

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
    } catch {
      // Table may not exist — covered by database checks
    }
  }

  // Actions recorded?
  if (actionsTable) {
    try {
      const actions = await sql`SELECT COUNT(*)::int AS count FROM action_records WHERE org_id = 'org_default'`;
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

      // Staleness check (only meaningful if some actions exist)
      if (actionCount > 0) {
        const recent = await sql`
          SELECT COUNT(*)::int AS count FROM action_records
          WHERE org_id = 'org_default'
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
