import { REQUIRED_ENV_VARS, ADVISORY_ENV_VARS } from './constants.mjs';
import { createSection, createCheck } from './factories.mjs';

export function checkConfiguration(env = process.env) {
  const required = REQUIRED_ENV_VARS.map(({ key, description, help }) => ({
    key,
    description,
    help,
    present: Boolean(env[key]),
    required: true,
  }));

  const advisory = ADVISORY_ENV_VARS.map(({ key, description, help }) => ({
    key,
    description,
    help,
    present: Boolean(env[key]),
    required: false,
  }));

  const missingRequired = required.filter((entry) => !entry.present);
  const missingAdvisory = advisory.filter((entry) => !entry.present);
  const vars = [...required, ...advisory];

  const checks = vars.map((entry) =>
    createCheck({
      id: entry.key.toLowerCase(),
      label: entry.key,
      status: entry.present ? 'pass' : entry.required ? 'fail' : 'warn',
      detail: entry.present
        ? `${entry.key} is present.`
        : `${entry.required ? 'Required' : 'Recommended'} setting is missing.`,
      subDetail: entry.present ? entry.description : '',
      likelyCause: entry.present
        ? ''
        : 'This environment variable has not been added to the current deployment.',
      nextAction: entry.present ? '' : entry.help,
    })
  );

  return {
    ok: missingRequired.length === 0,
    status: missingRequired.length > 0 ? 'fail' : missingAdvisory.length > 0 ? 'warn' : 'pass',
    summary:
      missingRequired.length > 0
        ? `${missingRequired.length} required setting(s) missing.`
        : missingAdvisory.length > 0
          ? `${missingAdvisory.length} recommended setting(s) still missing.`
          : 'Required and recommended settings are present.',
    vars,
    checks,
    missingRequired,
    missingAdvisory,
  };
}


export function buildConfigurationSection(config) {
  return createSection({
    id: 'configuration',
    title: 'Configuration',
    status: config.status,
    description: 'Verifies required settings and highlights recommended follow-up configuration.',
    summary: config.summary,
    whatWasChecked: 'Presence of required and advisory environment variables. Values are never shown here.',
    evidenceSummary:
      config.missingRequired.length > 0
        ? 'Configuration verification failed because required settings are missing.'
        : config.missingAdvisory.length > 0
          ? 'Required settings are present, but some recommended configuration is still pending.'
          : 'Configuration presence checks passed for required and recommended settings.',
    pendingProof:
      config.missingAdvisory.length > 0
        ? 'Recommended configuration is still pending for a stronger operator setup.'
        : '',
    checks: config.checks,
    ok: config.ok,
    vars: config.vars,
    missingRequired: config.missingRequired,
    missingAdvisory: config.missingAdvisory,
  });
}
