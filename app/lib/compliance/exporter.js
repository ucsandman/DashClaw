import crypto from 'crypto';
import { getSql } from '../db.js';
import { getOrgId } from '../org.js';
import { loadFramework, listFrameworks, mapPolicies } from './mapper.js';
import { generateMarkdownReport, generateJsonReport } from './reporter.js';
import { analyzeGaps } from './analyzer.js';
import { getActivePolicies } from '../repositories/guardrails.repository.js';
import { convertPolicies } from '../guardrails/converter.js';
import {
  createSnapshot,
  listSnapshots,
  getGuardDecisionEvidence,
  getActionRecordEvidence,
} from '../repositories/compliance.repository.js';

// -----------------------------------------------
// Export Generation
// -----------------------------------------------

export async function generateExport(request, exportId) {
  const sql = getSql();
  const orgId = getOrgId(request);

  // Get the export record
  const rows = await sql`SELECT * FROM compliance_exports WHERE id = ${exportId} AND org_id = ${orgId} LIMIT 1`;
  const exportRecord = rows[0];
  if (!exportRecord) throw new Error('Export not found');

  // Mark as running
  await sql`UPDATE compliance_exports SET status = 'running', started_at = NOW() WHERE id = ${exportId}`;

  try {
    const frameworks = JSON.parse(typeof exportRecord.frameworks === 'string' ? exportRecord.frameworks : JSON.stringify(exportRecord.frameworks));
    const format = exportRecord.format || 'markdown';
    const windowDays = exportRecord.window_days || 30;

    // Get policies
    const policies = await getActivePolicies(sql, orgId);
    const policyDoc = convertPolicies(policies, `org-${orgId}`);

    const sections = [];
    const snapshotIds = [];
    const allGaps = [];

    // Generate report for each framework
    for (const frameworkId of frameworks) {
      let framework;
      try {
        framework = loadFramework(frameworkId);
      } catch {
        sections.push(`## ${frameworkId}\n\nFramework not found. Skipping.\n\n`);
        continue;
      }

      const complianceMap = mapPolicies(policyDoc, framework);
      const gapAnalysis = analyzeGaps(complianceMap);
      allGaps.push(...gapAnalysis.remediation_plan);

      // Generate the framework report
      let frameworkReport;
      if (format === 'json') {
        frameworkReport = JSON.stringify(generateJsonReport(complianceMap), null, 2);
      } else {
        frameworkReport = generateMarkdownReport(complianceMap);
      }

      // Add remediation if requested
      if (exportRecord.include_remediation && gapAnalysis.remediation_plan.length > 0) {
        frameworkReport += `
## Remediation Priority Matrix

`;
        frameworkReport += `| Priority | Control | Status | Relevance | Effort |
`;
        frameworkReport += `|----------|---------|--------|-----------|--------|
`;
        for (const item of gapAnalysis.remediation_plan) {
          frameworkReport += `| ${item.priority} | ${item.control_id} -- ${item.title} | ${item.status} | ${item.agent_relevance} | ${item.estimated_effort} |
`;
        }
        frameworkReport += `
Estimated Total Effort: ${gapAnalysis.summary.estimated_total_effort}
`;
      }

      sections.push(frameworkReport);

      // Save snapshot
      const snapshotId = 'cs_' + crypto.randomBytes(12).toString('hex');
      await createSnapshot(sql, orgId, {
        id: snapshotId,
        framework: frameworkId,
        total_controls: complianceMap.summary.total_controls,
        covered: complianceMap.summary.covered,
        partial: complianceMap.summary.partial,
        gaps: complianceMap.summary.gaps,
        coverage_percentage: complianceMap.summary.coverage_percentage,
        risk_level: gapAnalysis.risk_assessment.overall_risk,
        full_report: null,
      });
      snapshotIds.push(snapshotId);
    }

    // Build evidence summary if requested
    let evidenceSummary = {};
    if (exportRecord.include_evidence) {
      const guardEvidence = await getGuardDecisionEvidence(sql, orgId, windowDays);
      const actionEvidence = await getActionRecordEvidence(sql, orgId, windowDays);
      const blocked = guardEvidence.filter(e => e.decision === 'block');

      evidenceSummary = {
        window_days: windowDays,
        guard_decisions_total: guardEvidence.reduce((s, e) => s + Number(e.count), 0),
        guard_decisions_blocked: blocked.reduce((s, e) => s + Number(e.count), 0),
        action_records_total: actionEvidence.reduce((s, e) => s + Number(e.count), 0),
        guard_breakdown: guardEvidence,
        action_breakdown: actionEvidence,
      };

      // Append evidence section to report
      const evidenceSection = buildEvidenceSection(evidenceSummary, format);
      sections.push(evidenceSection);
    }

    // Build trend data if requested
    if (exportRecord.include_trends) {
      const snapshots = await listSnapshots(sql, orgId, null, 50);
      if (snapshots.length > 1) {
        const trendSection = buildTrendSection(snapshots, format);
        sections.push(trendSection);
      }
    }

    // Combine all sections
    const separator = format === 'json' ? '\n' : '\n---\n\n';
    let fullReport = '';
    if (format === 'markdown') {
      const header = `# Compliance Export\n\n`;
      const meta = `**Organization:** org-${orgId}  \n**Generated:** ${new Date().toISOString()}  \n**Frameworks:** ${frameworks.join(', ')}  \n**Evidence Window:** ${windowDays} days\n\n---\n\n`;
      fullReport = header + meta + sections.join(separator);
    } else {
      fullReport = sections.join(separator);
    }

    // Update export record with result
    await sql`
      UPDATE compliance_exports
      SET status = 'completed', report_content = ${fullReport}, evidence_summary = ${JSON.stringify(evidenceSummary)},
          snapshot_ids = ${JSON.stringify(snapshotIds)}, file_size_bytes = ${Buffer.byteLength(fullReport, 'utf8')},
          completed_at = NOW()
      WHERE id = ${exportId}
    `;

    return { id: exportId, status: 'completed', file_size_bytes: Buffer.byteLength(fullReport, 'utf8') };
  } catch (err) {
    await sql`UPDATE compliance_exports SET status = 'failed', error_message = ${err.message}, completed_at = NOW() WHERE id = ${exportId}`;
    throw err;
  }
}

function buildEvidenceSection(evidence, format) {
  let section = `
# Enforcement Evidence

`;
  section += `**Window:** ${evidence.window_days} days  \n`;
  section += `**Total Guard Decisions:** ${evidence.guard_decisions_total}  \n`;
  section += `**Blocked:** ${evidence.guard_decisions_blocked}  \n`;
  section += `**Action Records:** ${evidence.action_records_total}\n\n`;

  if (evidence.guard_breakdown && evidence.guard_breakdown.length > 0) {
    section += `## Guard Decision Breakdown

`;
    section += `| Action Type | Decision | Count |
`;
    section += `|-------------|----------|-------|
`;
    for (const row of evidence.guard_breakdown) {
      section += `| ${row.action_type || '--'} | ${row.decision} | ${row.count} |
`;
    }
    section += '\n';
  }

  if (evidence.action_breakdown && evidence.action_breakdown.length > 0) {
    section += `## Action Record Breakdown

`;
    section += `| Action Type | Count |
`;
    section += `|-------------|-------|
`;
    for (const row of evidence.action_breakdown) {
      section += `| ${row.action_type || '--'} | ${row.count} |
`;
    }
    section += '\n';
  }

  return section;
}

function buildTrendSection(snapshots, format) {
  let section = `
# Compliance Trends

`;

  // Group by framework
  const byFramework = {};
  for (const snap of snapshots) {
    if (!byFramework[snap.framework]) byFramework[snap.framework] = [];
    byFramework[snap.framework].push(snap);
  }

  for (const [fw, snaps] of Object.entries(byFramework)) {
    section += `## ${fw.toUpperCase()}

`;
    section += `| Date | Coverage | Covered | Partial | Gaps | Risk |
`;
    section += `|------|----------|---------|---------|------|------|
`;
    for (const snap of snaps.slice(0, 10)) {
      const date = new Date(snap.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      section += `| ${date} | ${snap.coverage_percentage}% | ${snap.covered} | ${snap.partial} | ${snap.gaps} | ${snap.risk_level} |
`;
    }
    section += '\n';

    // Calculate trend direction
    if (snaps.length >= 2) {
      const latest = snaps[0].coverage_percentage;
      const previous = snaps[1].coverage_percentage;
      const delta = latest - previous;
      const arrow = delta > 0 ? 'Improving' : delta < 0 ? 'Declining' : 'Stable';
      section += `**Trend:** ${arrow} (${delta > 0 ? '+' : ''}${delta}% since last snapshot)\n\n`;
    }
  }

  return section;
}

// -----------------------------------------------
// Export CRUD
// -----------------------------------------------

export async function createExportRecord(request, { name, frameworks, format, window_days, include_evidence, include_remediation, include_trends }) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const id = 'ce_' + crypto.randomBytes(12).toString('hex');

  await sql`
    INSERT INTO compliance_exports (id, org_id, name, frameworks, format, window_days, include_evidence, include_remediation, include_trends, requested_by)
    VALUES (${id}, ${orgId}, ${name || 'Compliance Export'}, ${JSON.stringify(frameworks || [])}, ${format || 'markdown'}, ${window_days || 30}, ${include_evidence !== false}, ${include_remediation !== false}, ${include_trends || false}, ${'user'})
  `;

  return { id };
}

export async function listExports(request, { limit } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const lim = Math.min(parseInt(limit || '20', 10), 100);

  return sql`
    SELECT id, name, frameworks, format, window_days, status, file_size_bytes, error_message, requested_by, started_at, completed_at, created_at
    FROM compliance_exports
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${lim}
  `;
}

export async function getExport(request, exportId) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const rows = await sql`SELECT * FROM compliance_exports WHERE id = ${exportId} AND org_id = ${orgId} LIMIT 1`;
  return rows[0] || null;
}

export async function deleteExport(request, exportId) {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`DELETE FROM compliance_exports WHERE id = ${exportId} AND org_id = ${orgId}`;
  return { deleted: true };
}

// -----------------------------------------------
// Schedule CRUD
// -----------------------------------------------

export async function createSchedule(request, { name, frameworks, format, window_days, cron_expression, include_evidence, include_remediation, include_trends }) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const id = 'csch_' + crypto.randomBytes(12).toString('hex');

  await sql`
    INSERT INTO compliance_schedules (id, org_id, name, frameworks, format, window_days, cron_expression, include_evidence, include_remediation, include_trends)
    VALUES (${id}, ${orgId}, ${name || 'Scheduled Export'}, ${JSON.stringify(frameworks || [])}, ${format || 'markdown'}, ${window_days || 30}, ${cron_expression}, ${include_evidence !== false}, ${include_remediation !== false}, ${include_trends || false})
  `;

  return { id };
}

export async function listSchedules(request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  return sql`SELECT * FROM compliance_schedules WHERE org_id = ${orgId} ORDER BY created_at DESC`;
}

export async function updateSchedule(request, scheduleId, fields) {
  const sql = getSql();
  const orgId = getOrgId(request);

  if (fields.enabled !== undefined) {
    await sql`UPDATE compliance_schedules SET enabled = ${fields.enabled}, updated_at = NOW() WHERE id = ${scheduleId} AND org_id = ${orgId}`;
  }
  if (fields.name) {
    await sql`UPDATE compliance_schedules SET name = ${fields.name}, updated_at = NOW() WHERE id = ${scheduleId} AND org_id = ${orgId}`;
  }

  const rows = await sql`SELECT * FROM compliance_schedules WHERE id = ${scheduleId} AND org_id = ${orgId} LIMIT 1`;
  return rows[0] || null;
}

export async function deleteSchedule(request, scheduleId) {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`DELETE FROM compliance_schedules WHERE id = ${scheduleId} AND org_id = ${orgId}`;
  return { deleted: true };
}

// -----------------------------------------------
// Trend Analysis (SQL-based, no LLM)
// -----------------------------------------------

export async function getComplianceTrends(request, { framework, limit } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const lim = Math.min(parseInt(limit || '30', 10), 100);

  if (framework) {
    return sql`
      SELECT framework, coverage_percentage, covered, partial, gaps, risk_level, created_at
      FROM compliance_snapshots
      WHERE org_id = ${orgId} AND framework = ${framework}
      ORDER BY created_at DESC
      LIMIT ${lim}
    `;
  }

  return sql`
    SELECT framework, coverage_percentage, covered, partial, gaps, risk_level, created_at
    FROM compliance_snapshots
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${lim}
  `;
}
