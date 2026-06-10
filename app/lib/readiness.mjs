/**
 * Canonical readiness and verification checks for the /setup page.
 * Repackaged into modular files under app/lib/readiness/
 */

import { getSetupStatus } from './setupStatus.mjs';
import { getAuthConfig } from './authConfig.mjs';
import { getSql } from './db';

import { REQUIRED_ENV_VARS, ADVISORY_ENV_VARS } from './readiness/constants.mjs';
import { buildApplicationSection } from './readiness/applicationCheck.mjs';
import { buildDatabaseSection } from './readiness/databaseCheck.mjs';
import { checkConfiguration, buildConfigurationSection } from './readiness/configurationCheck.mjs';
import { buildAuthSection } from './readiness/authCheck.mjs';
import { buildDeploySection } from './readiness/deployCheck.mjs';
import { getSdkCommands, projectConnectNextStep, buildSdkSection } from './readiness/sdkCheck.mjs';
import { buildWorkflow, buildRecommendations, buildVerificationState, buildProofArtifact, projectAuthConfig, projectCheck, projectStep } from './readiness/workflow.mjs';

export { REQUIRED_ENV_VARS, ADVISORY_ENV_VARS, getSdkCommands, projectConnectNextStep };

export async function getReadinessReport(env = process.env, options = {}) {
  const { host = '', liveProof = null } = options;

  const [dbStatus, authConfig, config] = await Promise.all([
    getSetupStatus(env),
    Promise.resolve(getAuthConfig(env)),
    Promise.resolve(checkConfiguration(env)),
  ]);

  const application = buildApplicationSection(env);
  const db = buildDatabaseSection(dbStatus);
  const configuration = buildConfigurationSection(config);
  const auth = buildAuthSection(authConfig, env);
  const deploy = buildDeploySection(env, host);

  // Check for workspace API keys and recorded actions in the database.
  // Env var alone isn't enough when users generate keys through the dashboard.
  let hasWorkspaceApiKey = false;
  let hasRecordedActions = false;
  if (dbStatus.configured) {
    try {
      const sql = getSql();
      const [keyRows, actionRows] = await Promise.all([
        auth.hasAgentApiKey ? [] : sql`SELECT 1 FROM api_keys WHERE revoked_at IS NULL LIMIT 1`,
        sql`SELECT 1 FROM action_records LIMIT 1`,
      ]);
      if (!auth.hasAgentApiKey && keyRows.length > 0) {
        auth.hasAgentApiKey = true;
        hasWorkspaceApiKey = true;
      }
      hasRecordedActions = actionRows.length > 0;
    } catch { /* best-effort */ }
  }

  const baseReport = {
    checkedAt: new Date().toISOString(),
    application,
    db,
    config: configuration,
    auth,
  };

  const sdk = buildSdkSection(host, baseReport, liveProof);
  const sections = [application, db, configuration, auth, deploy, sdk];

  let overall = 'healthy';
  if (!db.ok || !configuration.ok || !deploy.ok) {
    overall = 'blocked';
  } else if (!auth.ok || configuration.missingAdvisory.length > 0 || auth.status === 'warn' || deploy.status === 'warn') {
    overall = 'needs_attention';
  }

  const report = {
    overall,
    checkedAt: baseReport.checkedAt,
    application,
    db,
    config: configuration,
    auth,
    deploy,
    sdk,
    sections,
    hasRecordedActions,
  };

  const verification = buildVerificationState(report);

  return {
    ...report,
    verification,
    workflow: buildWorkflow(report),
    recommendations: buildRecommendations(report),
  };
}


export function projectReadinessReport(report, { isAuthenticated = false, host = '' } = {}) {
  const projectedSections = report.sections.map((section) => ({
    ...section,
    checks: section.checks.map((check) => projectCheck(check, isAuthenticated)),
  }));

  const projectedSdk = projectedSections.find((section) => section.id === 'sdk') || report.sdk;
  const view = {
    ...report,
    isAuthenticated,
    mode: isAuthenticated ? 'operator' : 'public',
    notice: isAuthenticated
      ? ''
      : 'This page is intentionally safe to open before login. Some operator details stay hidden until you sign in.',
    db: {
      ...report.db,
      missing: isAuthenticated ? report.db.missing : [],
    },
    auth: projectAuthConfig(report.auth, isAuthenticated),
    sdk: projectedSdk,
    sections: projectedSections,
    workflow: report.workflow.map((step) => ({ ...step })),
    recommendations: report.recommendations.map((step) => projectStep(step, isAuthenticated)),
  };

  return {
    ...view,
    proofArtifact: buildProofArtifact(view, host),
  };
}


