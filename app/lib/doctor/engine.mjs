// app/lib/doctor/engine.mjs
import { runChecks as databaseChecks } from './checks/database.mjs';
import { runChecks as configChecks } from './checks/config.mjs';
import { runChecks as authChecks } from './checks/auth.mjs';
import { runChecks as deploymentChecks } from './checks/deployment.mjs';
import { runChecks as sdkChecks } from './checks/sdk.mjs';
import { runChecks as governanceChecks } from './checks/governance.mjs';
import { runChecks as driftChecks } from './checks/drift.mjs';
import { runChecks as openclawPluginChecks } from './checks/openclawPlugin.mjs';
import { runChecks as hostedChecks } from './checks/hosted.mjs';
import { runChecks as dataHygieneChecks } from './checks/data-hygiene.mjs';
import { runShapeChecks } from './generated/checks-from-shape.mjs';

const CHECK_RUNNERS = {
  database: databaseChecks,
  config: configChecks,
  auth: authChecks,
  deployment: deploymentChecks,
  sdk: sdkChecks,
  governance: governanceChecks,
  shape: runShapeChecks,
  drift: driftChecks,
  'openclaw-plugin': openclawPluginChecks,
  hosted: hostedChecks,
  'data-hygiene': dataHygieneChecks,
};

const CATEGORY_ORDER = ['database', 'config', 'auth', 'deployment', 'sdk', 'governance', 'shape', 'drift', 'openclaw-plugin', 'hosted', 'data-hygiene'];

/**
 * @param {Object} [options]
 * @param {string[]} [options.categories] - Filter to specific categories
 * @param {boolean} [options.includeFixes=true] - Include fix metadata
 * @param {Object} [options.env=process.env] - Environment to check
 * @param {string} [options.host=''] - Host for deploy/SDK checks
 * @param {string|null} [options.orgId=null] - Tenant scope for data probes
 *   (set from x-org-id for API callers; null = operator-local, instance-wide)
 */
export async function runDoctor(options = {}) {
  const {
    categories = null,
    includeFixes = true,
    env = process.env,
    host = '',
    orgId = null,
  } = options;

  const activeCategories = categories
    ? CATEGORY_ORDER.filter((c) => categories.includes(c))
    : CATEGORY_ORDER;

  const checkArrays = await Promise.all(
    activeCategories.map((cat) => CHECK_RUNNERS[cat]({ env, host, orgId })),
  );

  let checks = checkArrays.flat();

  if (!includeFixes) {
    checks = checks.map((c) => ({ ...c, fix: null }));
  }

  const summary = computeSummary(checks);
  const status = summary.fail > 0 ? 'unhealthy' : summary.warn > 0 ? 'needs_attention' : 'healthy';

  return {
    status,
    summary,
    checks,
    timestamp: new Date().toISOString(),
  };
}

/**
 * @param {Array<{status: string}>} checks
 */
export function computeSummary(checks) {
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) {
    if (check.status in summary) summary[check.status]++;
  }
  return summary;
}

export { applyFix } from './fixes/index.mjs';
