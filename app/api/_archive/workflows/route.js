export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';

// sql initialized inside handler for serverless compatibility

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');

    // Get all workflows (optionally filtered by agent)
    const workflows = agentId
      ? await sql`SELECT * FROM workflows WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY last_run DESC NULLS LAST`
      : await sql`SELECT * FROM workflows WHERE org_id = ${orgId} ORDER BY last_run DESC NULLS LAST`;

    // Get recent executions (optionally filtered by agent)
    const executions = agentId
      ? await sql`SELECT * FROM executions WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY started_at DESC LIMIT 20`
      : await sql`SELECT * FROM executions WHERE org_id = ${orgId} ORDER BY started_at DESC LIMIT 20`;

    // Get scheduled jobs
    const scheduledJobs = await sql`SELECT * FROM scheduled_jobs WHERE org_id = ${orgId} ORDER BY next_run ASC NULLS LAST`;

    // Calculate stats
    const enabled = workflows.filter(w => w.enabled === 1).length;
    const totalRuns = workflows.reduce((sum, w) => sum + (w.run_count || 0), 0);
    const recentSuccess = executions.filter(e => e.status === 'success').length;
    const recentFailed = executions.filter(e => e.status === 'failed').length;

    const stats = {
      totalWorkflows: workflows.length,
      enabled,
      totalRuns,
      recentExecutions: executions.length,
      recentSuccess,
      recentFailed,
      scheduledJobs: scheduledJobs.length
    };

    return NextResponse.json({
      workflows,
      executions,
      scheduledJobs,
      stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    // SECURITY: Log detailed error server-side, return generic message to client
    console.error('Workflows API error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching workflow data', workflows: [], executions: [], scheduledJobs: [], stats: {} }, { status: 500 });
  }
}

