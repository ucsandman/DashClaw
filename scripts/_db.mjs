import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';

function parseHostname(dbUrl) {
  try {
    return new URL(dbUrl).hostname || '';
  } catch {
    return '';
  }
}

function isNeonUrl(dbUrl) {
  return /\.neon\.tech(?:[/:?]|$)/i.test(String(dbUrl || ''));
}

/**
 * Script DB helper.
 *
 * Uses Neon serverless driver for Neon URLs, and direct TCP for local/self-host Postgres.
 * Exits early if DATABASE_URL is missing.
 */
export function createSqlFromEnv() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  const driverOverride = String(process.env.DASHCLAW_DB_DRIVER || '').toLowerCase();
  const hostname = parseHostname(url);
  const shouldUseNeon =
    driverOverride === 'neon' ||
    (driverOverride !== 'postgres' && (isNeonUrl(url) || hostname.endsWith('neon.tech')));

  if (shouldUseNeon) return neon(url);

  const max = (() => {
    const v = parseInt(String(process.env.DASHCLAW_DB_POOL_MAX || ''), 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
  })();

  // idle_timeout matters: most scripts never call sql.end(), and an idle
  // pooled TCP connection keeps the Node event loop alive forever — observed
  // live as `npx dashclaw up` hanging indefinitely inside setup's migration
  // scripts on every local (non-Neon) database. Closing idle connections
  // after 5s lets those scripts exit naturally; postgres.js reconnects
  // transparently if a later query needs the pool again.
  const client = postgres(url, { max, idle_timeout: 5 });
  const sql = (...args) => client(...args);
  sql.query = async (text, params = []) => client.unsafe(text, params);
  sql.end = async (opts) => client.end(opts);
  return sql;
}

