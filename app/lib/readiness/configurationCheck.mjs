import { REQUIRED_ENV_VARS, ADVISORY_ENV_VARS } from './constants.mjs';
import { createSection, createCheck } from './factories.mjs';
import { CORE_TABLES } from '../schemaCheck';

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

function buildApplicationSection(env) {
  const mode = env.NODE_ENV || 'development';

  return createSection({
    id: 'application',
    title: 'Core Readiness',
    status: 'pass',
    description: 'Confirms that DashClaw is serving the verify surface and the app process is alive.',
    summary: 'DashClaw responded to the verification request.',
    whatWasChecked: 'The /setup page rendered and the server runtime reported process metadata.',
    evidenceSummary: 'Behavior verified: the app process responded and exposed runtime metadata.',
    pendingProof: '',
    checks: [
      createCheck({
        id: 'app_reachable',
        label: 'Verify surface reachable',
        status: 'pass',
        detail: 'The Setup & Verify page rendered successfully.',
      }),
      createCheck({
        id: 'runtime',
        label: 'Runtime metadata',
        status: 'pass',
        detail: `Node.js ${process.version} running in ${mode}.`,
        publicDetail: 'Application runtime is available.',
      }),
    ],
    ok: true,
  });
}

function buildDatabaseSection(dbStatus) {
  const missing = Array.isArray(dbStatus.missing) ? dbStatus.missing : [];
  const presentCount = CORE_TABLES.length - missing.length;

  if (dbStatus.reason === 'missing_database_url') {
    return createSection({
      id: 'database',
      title: 'Database Verification',
      status: 'fail',
      description: 'Checks whether DashClaw can reach its database and confirm the core schema exists.',
      summary: 'Database verification is blocked because DATABASE_URL is missing.',
      whatWasChecked: 'Environment presence for DATABASE_URL, then database connectivity and core table checks when possible.',
      evidenceSummary: 'Verification blocked before a live connection test could run.',
      pendingProof: 'Database behavior is not yet verified because no connection string is configured.',
      checks: [
        createCheck({
          id: 'database_url',
          label: 'DATABASE_URL',
          status: 'fail',
          detail: 'DATABASE_URL is missing.',
          likelyCause: 'The deployment does not have a database connection string configured.',
          nextAction: 'Add DATABASE_URL, then restart or redeploy DashClaw.',
        }),
        createCheck({
          id: 'db_connection',
          label: 'Connection test',
          status: 'info',
          detail: 'Skipped because there is no database URL to test.',
        }),
        createCheck({
          id: 'db_schema',
          label: 'Core schema',
          status: 'info',
          detail: 'Skipped because database connectivity is not configured yet.',
        }),
      ],
      ok: false,
      reason: dbStatus.reason,
      missing,
      allTables: CORE_TABLES,
    });
  }

  if (dbStatus.reason === 'connection_error') {
    return createSection({
      id: 'database',
      title: 'Database Verification',
      status: 'fail',
      description: 'Checks whether DashClaw can reach its database and confirm the core schema exists.',
      summary: 'Database connectivity failed.',
      whatWasChecked: 'DATABASE_URL presence and a live connection attempt from this deployment.',
      evidenceSummary: 'Configuration is present, but live database behavior is failing.',
      pendingProof: 'Schema verification remains pending until the connection succeeds.',
      checks: [
        createCheck({
          id: 'database_url',
          label: 'DATABASE_URL',
          status: 'pass',
          detail: 'DATABASE_URL is present.',
        }),
        createCheck({
          id: 'db_connection',
          label: 'Connection test',
          status: 'fail',
          detail: 'Database connection check failed.',
          likelyCause: 'The database may be down, unreachable from this deployment, or using invalid credentials.',
          nextAction: 'Verify DATABASE_URL, confirm the database is reachable, and redeploy if you changed configuration.',
        }),
        createCheck({
          id: 'db_schema',
          label: 'Core schema',
          status: 'info',
          detail: 'Schema verification could not run because the connection test failed.',
        }),
      ],
      ok: false,
      reason: dbStatus.reason,
      missing,
      allTables: CORE_TABLES,
    });
  }

  if (dbStatus.reason === 'no_tables') {
    return createSection({
      id: 'database',
      title: 'Database Verification',
      status: 'fail',
      description: 'Checks whether DashClaw can reach its database and confirm the core schema exists.',
      summary: `${missing.length} required table(s) are still missing.`,
      whatWasChecked: 'DATABASE_URL presence, a live database connection, and the required DashClaw core tables.',
      evidenceSummary: 'Connection succeeded, but schema verification failed.',
      pendingProof: 'Bootstrap migrations still need to complete before database verification can pass.',
      checks: [
        createCheck({
          id: 'database_url',
          label: 'DATABASE_URL',
          status: 'pass',
          detail: 'DATABASE_URL is present.',
        }),
        createCheck({
          id: 'db_connection',
          label: 'Connection test',
          status: 'pass',
          detail: 'Database connection succeeded.',
        }),
        createCheck({
          id: 'db_schema',
          label: 'Core schema',
          status: 'fail',
          detail: `${presentCount} of ${CORE_TABLES.length} required tables are present.`,
          subDetail: `Missing tables: ${missing.join(', ')}`,
          publicDetail: `${missing.length} required table check(s) failed.`,
          publicSubDetail: 'Sign in for the exact missing table names.',
          likelyCause: 'Bootstrap migrations have not run yet, or they did not complete successfully.',
          nextAction: 'Run the setup migrations, then reload this page.',
        }),
      ],
      ok: false,
      reason: dbStatus.reason,
      missing,
      allTables: CORE_TABLES,
    });
  }

  return createSection({
    id: 'database',
    title: 'Database Verification',
    status: 'pass',
    description: 'Checks whether DashClaw can reach its database and confirm the core schema exists.',
    summary: 'Database connection and core schema checks passed.',
    whatWasChecked: 'DATABASE_URL presence, a live connection from this deployment, and all required core tables.',
    evidenceSummary: 'Database verified: connection succeeded and required core tables were present.',
    pendingProof: '',
    checks: [
      createCheck({
        id: 'database_url',
        label: 'DATABASE_URL',
        status: 'pass',
        detail: 'DATABASE_URL is present.',
      }),
      createCheck({
        id: 'db_connection',
        label: 'Connection test',
        status: 'pass',
        detail: 'Database connection succeeded.',
      }),
      createCheck({
        id: 'db_schema',
        label: 'Core schema',
        status: 'pass',
        detail: `All ${CORE_TABLES.length} required tables are present.`,
        subDetail: CORE_TABLES.join(', '),
        publicSubDetail: '',
      }),
    ],
    ok: true,
    reason: 'ready',
    missing,
    allTables: CORE_TABLES,
  });
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
