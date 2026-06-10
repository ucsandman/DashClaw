import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import { checkCoreTables } from './schemaCheck';

function parseHostname(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname || '';
  } catch {
    return '';
  }
}

function isNeonUrl(databaseUrl) {
  return /\.neon\.tech(?:[/:?]|$)/i.test(String(databaseUrl || ''));
}

function createSqlClient(env) {
  const url = String(env.DATABASE_URL || '').replace(/^['"]|['"]$/g, '');
  if (!url) {
    return { sql: null, close: async () => {} };
  }

  const driverOverride = String(env.DASHCLAW_DB_DRIVER || '').toLowerCase();
  const hostname = parseHostname(url);
  const shouldUseNeon =
    driverOverride === 'neon' ||
    (driverOverride !== 'postgres' && (isNeonUrl(url) || hostname.endsWith('neon.tech')));

  if (shouldUseNeon) {
    return { sql: neon(url), close: async () => {} };
  }

  const client = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 5 });
  const sql = (...args) => client(...args);
  sql.query = async (text, params = []) => client.unsafe(text, params);

  return {
    sql,
    close: async () => {
      await client.end({ timeout: 1 });
    },
  };
}

export async function getSetupStatus(env = process.env) {
  if (!env.DATABASE_URL) {
    return {
      configured: false,
      reason: 'missing_database_url',
      message: 'DATABASE_URL is not set.',
    };
  }

  const { sql, close } = createSqlClient(env);

  try {
    const { ok, missing } = await checkCoreTables(sql);

    if (!ok) {
      return {
        configured: false,
        reason: 'no_tables',
        message: `Missing ${missing.length} core table(s). Run migrations.`,
        missing_tables: missing.length,
        missing,
      };
    }

    return {
      configured: true,
      message: 'Dashboard is configured',
    };
  } catch {
    return {
      configured: false,
      reason: 'connection_error',
      message: 'Unable to connect to database',
    };
  } finally {
    await close();
  }
}
