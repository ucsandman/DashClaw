import { CORE_TABLES } from '../schemaCheck';
import { createSection, createCheck } from './factories.mjs';

export function buildDatabaseSection(dbStatus) {
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
