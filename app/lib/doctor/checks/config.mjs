// app/lib/doctor/checks/config.mjs
import { checkConfiguration } from '../../readiness/configurationCheck.mjs';

const GENERATE_FIXES = {
  NEXTAUTH_SECRET: { action: 'generate_secret', description: 'Generate a random NEXTAUTH_SECRET' },
  DASHCLAW_API_KEY: { action: 'generate_api_key', description: 'Generate a new API key' },
};

/**
 * @param {{ env?: object }} options
 */
export async function runChecks({ env = process.env } = {}) {
  const config = checkConfiguration(env);
  const checks = [];

  for (const check of config.checks) {
    const envVarName = check.label || check.id;
    const fixInfo = GENERATE_FIXES[envVarName];
    checks.push({
      id: `env_${envVarName}`,
      category: 'config',
      status: check.status,
      title: envVarName,
      message: check.detail,
      likelyCause: check.likelyCause || '',
      nextAction: check.nextAction || '',
      fix:
        check.status === 'fail' && fixInfo
          ? { type: 'auto', description: fixInfo.description, action: fixInfo.action }
          : null,
    });
  }

  return checks;
}
