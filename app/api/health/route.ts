export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { isEmbeddingsEnabled } from '../../lib/embeddings';
import { getRealtimeHealth } from '../../lib/events';
import { checkCoreTables } from '../../lib/schemaCheck';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../../../package.json');

/**
 * Health check endpoint for DashClaw
 * Returns system health status for monitoring
 */
export async function GET() {
  // todo-001: surface demo-mode so the Python hook can warn the operator when
  // DASHCLAW_BASE_URL points at a sandbox instance (a stale env var silently
  // routed real agent traffic to a demo container, where fixture blocks looked
  // indistinguishable from real policy decisions). Either env var counts —
  // `DASHCLAW_MODE` is the canonical server signal (see app/lib/selfHost.js)
  // and `NEXT_PUBLIC_DASHCLAW_MODE` is what the browser-side isDemoMode() uses.
  const isDemo = process.env.DASHCLAW_MODE === 'demo'
    || process.env.NEXT_PUBLIC_DASHCLAW_MODE === 'demo';
  const health: {
    status: string;
    timestamp: string;
    version: string;
    mode: string;
    checks: Record<string, unknown>;
  } = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version,
    mode: isDemo ? 'demo' : 'live',
    checks: {}
  };

  // ... rest of checks ...
  health.checks.behavioral_ai = {
    active: isEmbeddingsEnabled(),
    engine: 'openai/text-embedding-3-small'
  };

  // Check database connection and core table existence
  try {
    const sql = getSql();
    const { ok, missing } = await checkCoreTables(sql);
    if (!ok) {
      health.status = 'degraded';
      health.checks.database = { status: 'degraded', missing_tables: missing.length };
    } else {
      health.checks.database = { status: 'healthy' };
    }
  } catch (error) {
    health.status = 'degraded';
    // SECURITY: avoid leaking backend error details on a public endpoint.
    health.checks.database = { status: 'unhealthy' };
  }

  // Check runtime capabilities
  health.checks.runtime = {
    edge_compatible: typeof crypto !== 'undefined' && !!crypto.subtle,
    node_env: process.env.NODE_ENV || 'development'
  };

  // Check realtime backend health and cutover readiness
  try {
    const realtime = await getRealtimeHealth();
    health.checks.realtime = realtime;
    if (realtime.status === 'unhealthy') {
      health.status = 'degraded';
    }
  } catch (error) {
    health.status = 'degraded';
    // SECURITY: avoid leaking backend error details on a public endpoint.
    health.checks.realtime = { status: 'unhealthy' };
  }

  // Check environment variables
  const requiredEnvVars = ['DATABASE_URL', 'NEXTAUTH_SECRET'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    health.status = 'degraded';
    health.checks.environment = {
      status: 'unhealthy',
      missing: missingVars.length
    };
  } else {
    health.checks.environment = { status: 'healthy' };
  }

  // SECURITY: Don't expose auth configuration status to public endpoint

  const statusCode = health.status === 'healthy' ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
