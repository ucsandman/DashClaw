export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { listScans, getScanStats, insertScan } from '../../../lib/repositories/bugHunter.repository';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const [history, rawStats] = await Promise.all([
      listScans(sql, orgId),
      getScanStats(sql, orgId),
    ]);

    const stats = {
      totalScans: rawStats.total_scans || 0,
      issuesFound: rawStats.issues_found || 0,
      resolved: rawStats.resolved || 0,
      open: rawStats.open || 0,
    };

    return NextResponse.json({
      history,
      stats,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Bug Hunter GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bug hunter data', history: [], stats: { totalScans: 0, issuesFound: 0, resolved: 0, open: 0 } },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();
    const { agent_id, scope } = body;

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    const scanScope = scope || 'All Tabs';
    const scanId = `bh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Generate simulated findings based on scope
    const scopeFindings = generateFindings(scanScope);

    const summary = {
      total: scopeFindings.length,
      critical: scopeFindings.filter(f => f.severity === 'critical').length,
      high: scopeFindings.filter(f => f.severity === 'high').length,
      medium: scopeFindings.filter(f => f.severity === 'medium').length,
      low: scopeFindings.filter(f => f.severity === 'low').length,
    };

    // Persist scan record via repository
    await insertScan(sql, orgId, { scanId, agentId: agent_id, scope: scanScope, findingsCount: scopeFindings.length });

    return NextResponse.json({
      scan_id: scanId,
      status: 'completed',
      scope: scanScope,
      agent_id,
      findings: scopeFindings,
      summary,
    });
  } catch (error) {
    console.error('Bug Hunter POST error:', error);
    return NextResponse.json(
      { error: 'Scan failed' },
      { status: 500 }
    );
  }
}

function generateFindings(scope) {
  const findingTemplates = {
    Actions: [
      { severity: 'medium', description: 'Action handler missing error boundary', location: '/actions/handlers' },
      { severity: 'low', description: 'Deprecated action type still referenced', location: '/actions/registry' },
    ],
    Security: [
      { severity: 'high', description: 'Security signal missing severity classification', location: '/security/signals' },
      { severity: 'medium', description: 'Guard rule without fallback behavior defined', location: '/security/guards' },
      { severity: 'low', description: 'Stale security finding not auto-archived', location: '/security/findings' },
    ],
    Messages: [
      { severity: 'medium', description: 'Message thread missing read receipt tracking', location: '/messages/threads' },
      { severity: 'low', description: 'Attachment metadata not indexed for search', location: '/messages/attachments' },
    ],
    Routing: [
      { severity: 'high', description: 'Task routing rule with no matching agents', location: '/routing/rules' },
      { severity: 'medium', description: 'Health check interval exceeds recommended threshold', location: '/routing/health' },
    ],
    Compliance: [
      { severity: 'critical', description: 'Compliance control missing evidence linkage', location: '/compliance/controls' },
      { severity: 'medium', description: 'Gap analysis report outdated by 30+ days', location: '/compliance/gaps' },
    ],
    Policies: [
      { severity: 'medium', description: 'Policy rule with overlapping conditions', location: '/policies/rules' },
      { severity: 'low', description: 'Policy version history not pruned', location: '/policies/versions' },
    ],
    Workflows: [
      { severity: 'high', description: 'Workflow step referencing deleted agent', location: '/workflows/steps' },
      { severity: 'medium', description: 'Workflow trigger with no active subscribers', location: '/workflows/triggers' },
    ],
  };

  const now = new Date().toISOString();

  if (scope === 'All Tabs') {
    const allFindings = [];
    for (const [category, templates] of Object.entries(findingTemplates)) {
      const picked = templates[Math.floor(Math.random() * templates.length)];
      allFindings.push({
        ...picked,
        category,
        timestamp: now,
        id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      });
    }
    return allFindings;
  }

  const templates = findingTemplates[scope] || [
    { severity: 'low', description: `No issues detected in ${scope}`, location: `/${scope.toLowerCase()}` },
  ];

  return templates.map(t => ({
    ...t,
    category: scope,
    timestamp: now,
    id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  }));
}
