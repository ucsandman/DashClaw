// app/lib/doctor/checks/deployment.mjs
import { getEnvVar } from '../shape.mjs';

// Env var names come from the generated shape snapshot so a rename in
// app/lib/ or middleware.js propagates here — keeping the names aligned with
// what the codebase actually reads. Both are optional (no fallback → warn).
const NEXTAUTH_URL_VAR = getEnvVar('NEXTAUTH_URL')?.name || 'NEXTAUTH_URL';
const ALLOWED_ORIGIN_VAR = getEnvVar('ALLOWED_ORIGIN')?.name || 'ALLOWED_ORIGIN';
const EXPECTED_NEXTAUTH_URL = (host) => (host ? `https://${host}` : 'the public DashClaw URL');

/**
 * @param {{ env?: object, host?: string }} options
 */
export async function runChecks({ env = process.env, host = '' } = {}) {
  const checks = [];

  // NEXTAUTH_URL
  const nextauthUrl = env[NEXTAUTH_URL_VAR];
  if (!nextauthUrl) {
    checks.push({
      id: 'deploy_nextauth_url',
      category: 'deployment',
      status: 'warn',
      title: 'NEXTAUTH_URL',
      message: 'Not set — OAuth callbacks may fail in production',
      likelyCause: `${NEXTAUTH_URL_VAR} is missing from the deployment environment.`,
      nextAction: `Set ${NEXTAUTH_URL_VAR} to ${EXPECTED_NEXTAUTH_URL(host)} and redeploy before enabling OAuth sign-in.`,
      fix: null,
    });
  } else if (host && !nextauthUrl.includes(host)) {
    checks.push({
      id: 'deploy_nextauth_url',
      category: 'deployment',
      status: 'warn',
      title: 'NEXTAUTH_URL',
      message: `Set to ${nextauthUrl} but current host is ${host} — possible mismatch`,
      likelyCause: `${NEXTAUTH_URL_VAR} still points at a different host than the current deployment.`,
      nextAction: `Update ${NEXTAUTH_URL_VAR} to https://${host}, then redeploy so callback URLs match the production host.`,
      fix: null,
    });
  } else {
    checks.push({
      id: 'deploy_nextauth_url',
      category: 'deployment',
      status: 'pass',
      title: 'NEXTAUTH_URL',
      message: `Set to ${nextauthUrl}`,
      fix: null,
    });
  }

  // CORS
  const allowedOrigin = env[ALLOWED_ORIGIN_VAR];
  if (!allowedOrigin) {
    checks.push({
      id: 'deploy_cors',
      category: 'deployment',
      status: 'warn',
      title: 'CORS (ALLOWED_ORIGIN)',
      message: 'Not set — cross-origin agent requests may be blocked',
      likelyCause: `${ALLOWED_ORIGIN_VAR} is unset, so browser clients from another origin will not receive an allow-origin response.`,
      nextAction: `Set ${ALLOWED_ORIGIN_VAR} to the browser origin that will call DashClaw APIs, or document why same-origin use is intentional.`,
      fix: null,
    });
  } else {
    checks.push({
      id: 'deploy_cors',
      category: 'deployment',
      status: 'pass',
      title: 'CORS (ALLOWED_ORIGIN)',
      message: `Set to ${allowedOrigin}`,
      fix: null,
    });
  }

  return checks;
}
