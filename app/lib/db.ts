import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import './validateEnv';
import { startupSchemaCheck } from './schemaCheck';
import type { SqlTag } from './types/db';

// A neon-like surface: callable tagged template + `.query(text, params)`.
interface SqlClient {
  (...args: unknown[]): unknown;
  query: (text: string, params?: unknown[]) => Promise<unknown>;
  end?: (opts?: unknown) => Promise<unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var __dashclaw_sql: SqlClient | undefined;
}

// Use globalThis to survive Next.js dev mode hot reloads.
// Without this, each HMR re-evaluation creates a new connection pool
// while the old pool's connections remain open, exhausting max_connections.
if (!globalThis.__dashclaw_sql) globalThis.__dashclaw_sql = undefined;
const _getSql = (): SqlClient | undefined => globalThis.__dashclaw_sql;
const _setSql = (v: SqlClient | undefined): void => { globalThis.__dashclaw_sql = v; };

function parseHostname(dbUrl: string): string {
  try {
    return new URL(dbUrl).hostname || '';
  } catch {
    return '';
  }
}

function isNeonUrl(dbUrl: string | undefined | null): boolean {
  // Neon serverless URLs typically include ".neon.tech". Keep this heuristic simple and stable.
  return /\.neon\.tech(?:[/:?]|$)/i.test(String(dbUrl || ''));
}

/**
 * Standardized Database Connection Utility for DashClaw.
 *
 * - Neon URLs: use @neondatabase/serverless (fetch/WebSocket)
 * - Local/self-host Postgres URLs: use postgres (direct TCP)
 *
 * The returned object is a tagged-template function with a `.query(text, params)` method.
 */
export function getSql(): SqlTag {
  if (_getSql()) return _getSql() as unknown as SqlTag;

  const url = process.env.DATABASE_URL;

  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL is not set in production. Database connection failed.');
    }

    console.warn('[DB] DATABASE_URL not set. Falling back to safe mock driver.');

    // Mock driver that mimics the interface we use (callable tag + .query).
    const mockSql = (async (strings: TemplateStringsArray) => {
      console.log('[DB-MOCK] Executed query:', strings?.[0] || '');
      return [];
    }) as unknown as SqlClient;
    mockSql.query = async (text: string, params?: unknown[]) => {
      console.log('[DB-MOCK] Executed query with params:', text, params);
      return [];
    };
    _setSql(mockSql);
    return _getSql() as unknown as SqlTag;
  }

  const driverOverride = String(process.env.DASHCLAW_DB_DRIVER || '').toLowerCase();
  const hostname = parseHostname(url);
  const shouldUseNeon =
    driverOverride === 'neon' ||
    (driverOverride !== 'postgres' && (isNeonUrl(url) || hostname.endsWith('neon.tech')));

  if (shouldUseNeon) {
    _setSql(neon(url) as unknown as SqlClient);
    void startupSchemaCheck(_getSql() as never);
    return _getSql() as unknown as SqlTag;
  }

  // Direct TCP connection for local/self-host Postgres.
  const max = (() => {
    const v = parseInt(String(process.env.DASHCLAW_DB_POOL_MAX || ''), 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
  })();

  const client = postgres(url, { max, idle_timeout: 20 });

  // Provide a neon-like surface: tag + `.query(text, params)`.
  const sql = ((...args: unknown[]) => (client as unknown as (...a: unknown[]) => unknown)(...args)) as SqlClient;
  sql.query = async (text: string, params: unknown[] = []) => client.unsafe(text, params as never[]);
  sql.end = async (opts?: unknown) => client.end(opts as Parameters<typeof client.end>[0]);

  _setSql(sql);
  void startupSchemaCheck(_getSql() as never);
  return _getSql() as unknown as SqlTag;
}
