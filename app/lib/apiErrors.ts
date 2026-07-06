import { NextResponse } from 'next/server';

const WITHHELD_DETAIL =
  'Error detail withheld. Set DASHCLAW_EXPOSE_ERROR_DETAIL=true to include it in responses.';

/**
 * Redact a raw error message in production unless explicitly opted in via
 * DASHCLAW_EXPOSE_ERROR_DETAIL=true. This handler (and any route that echoes
 * err.message directly, e.g. /api/setup/migrate) is reachable by any
 * API-key/JWT holder — governed agents included — so err.message must not
 * leak internals (SQL fragments, file paths, dependency errors) by default.
 * Development/test keep full detail unconditionally.
 */
export function redactErrorDetail(err: any): string {
  const detail = err?.message || String(err);
  if (process.env.NODE_ENV === 'production' && process.env.DASHCLAW_EXPOSE_ERROR_DETAIL !== 'true') {
    return WITHHELD_DETAIL;
  }
  return detail;
}

/**
 * Shared API error handler that detects common deployment issues
 * and returns actionable messages instead of generic 500s.
 *
 * Usage: catch (err) { return apiErrorResponse(err, 'GUARD'); }
 */
export function apiErrorResponse(err: any, label: string): NextResponse {
  console.error(`[${label}] error:`, err);

  // Guard refused to return a decision it could not durably audit (see
  // persistGuardDecision). This is the one failure where the caller MUST be
  // able to tell "governance is degraded" apart from a generic 500 — the
  // production detail-redaction gate below would otherwise swallow the code.
  // The message is fixed text (no internals), so it is safe to return as-is.
  if (err.code === 'GUARD_AUDIT_PERSIST_FAILED') {
    return NextResponse.json({
      error: 'Guard decision could not be durably recorded; the decision was withheld rather than returned unaudited. Check database health (/setup) and retry.',
      code: 'GUARD_AUDIT_PERSIST_FAILED',
      setup_url: '/setup',
    }, { status: 503 });
  }

  // PostgreSQL 42P01: undefined_table — schema not initialized
  if (err.code === '42P01') {
    return NextResponse.json({
      error: 'Database schema not initialized. Visit /setup or redeploy to trigger auto-migration.',
      code: 'SCHEMA_NOT_INITIALIZED',
      setup_url: '/setup',
    }, { status: 503 });
  }

  // PostgreSQL 42P04: duplicate_database, 42000: syntax_error_or_access_rule_violation
  // PostgreSQL 08xxx: connection errors
  if (err.code && err.code.startsWith('08')) {
    return NextResponse.json({
      error: 'Database connection failed. Check DATABASE_URL in your environment variables.',
      code: 'DB_CONNECTION_FAILED',
      setup_url: '/setup',
    }, { status: 503 });
  }

  // DATABASE_URL not set
  if (err.message?.includes('DATABASE_URL is not set')) {
    return NextResponse.json({
      error: 'DATABASE_URL is not configured. Add it in your Vercel project settings and redeploy.',
      code: 'DB_NOT_CONFIGURED',
      setup_url: '/setup',
    }, { status: 503 });
  }

  // Surface the real error so we can actually diagnose issues, subject to the
  // production redaction gate above. Never leak stack traces.
  const detail = redactErrorDetail(err);
  return NextResponse.json({
    error: 'Internal server error',
    detail,
    code: detail === WITHHELD_DETAIL ? undefined : (err.code || undefined),
  }, { status: 500 });
}
