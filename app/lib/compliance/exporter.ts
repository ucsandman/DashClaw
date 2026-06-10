import crypto from 'crypto';
import { getSql } from '../db';
import { getOrgId } from '../org';
import { loadFramework, listFrameworks, mapPolicies } from './mapper';
import type { PolicyDoc } from './mapper';
import { generateMarkdownReport, generateJsonReport } from './reporter';
import { analyzeGaps } from './analyzer';
import { getActivePolicies } from '../repositories/guardrails.repository';
import { convertPolicies } from '../guardrails/converter';
import type { DashClawPolicy } from '../guardrails/converter';
import {
  createSnapshot,
  listSnapshots,
  getGuardDecisionEvidence,
  getActionRecordEvidence,
} from '../repositories/compliance.repository';
import { signBundle, bundleHash, verifyBundle } from '../integrity/bundle';
import { getServerSigningKey, getServerPublicJwks } from '../integrity/server-key';

// -----------------------------------------------
// Export Generation
// -----------------------------------------------

export async function generateExport(request: Request, exportId: string): Promise<{ id: string; status: string; file_size_bytes: number }> {
  const sql = getSql();
  const orgId = getOrgId(request);

  // Get the export record
  const rows = await sql`SELECT * FROM compliance_exports WHERE id = ${exportId} AND org_id = ${orgId} LIMIT 1`;
  const exportRecord = rows[0];
  if (!exportRecord) throw new Error('Export not found');

  // Mark as running
  await sql`UPDATE compliance_exports SET status = 'running', started_at = NOW() WHERE id = ${exportId} AND org_id = ${orgId}`;

  try {
    const frameworks = JSON.parse(typeof exportRecord.frameworks === 'string' ? exportRecord.frameworks : JSON.stringify(exportRecord.frameworks));
    // exportRecord is a DB row (`Record<string, unknown>`); these columns are
    // string/number at runtime — coerce to keep the inferred type off `{}`.
    const format: string = (exportRecord.format as string) || 'markdown';
    const windowDays: number = (exportRecord.window_days as number) || 30;

    // Get policies
    const policies = await getActivePolicies(sql, orgId);
    // Rows match the DashClawPolicy shape at runtime; convertPolicies returns a
    // GuardrailDocument that mapPolicies consumes as a structurally-identical PolicyDoc.
    const policyDoc = convertPolicies(policies as unknown as DashClawPolicy[], `org-${orgId}`);

    const sections: string[] = [];
    const snapshotIds: string[] = [];
    const allGaps: unknown[] = [];

    // Generate report for each framework
    for (const frameworkId of frameworks) {
      let framework;
      try {
        framework = loadFramework(frameworkId);
      } catch {
        sections.push(`## ${frameworkId}\n\nFramework not found. Skipping.\n\n`);
        continue;
      }

      const complianceMap = mapPolicies(policyDoc as unknown as PolicyDoc, framework);
      const gapAnalysis = analyzeGaps(complianceMap);
      allGaps.push(...gapAnalysis.remediation_plan);

      // Generate the framework report
      let frameworkReport;
      if (format === 'json') {
        frameworkReport = generateJsonReport(complianceMap);
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
    let evidenceSummary: Record<string, unknown> = {};
    if (exportRecord.include_evidence) {
      const guardEvidence = await getGuardDecisionEvidence(sql, orgId, windowDays);
      const actionEvidence = await getActionRecordEvidence(sql, orgId, windowDays);
      const blocked = guardEvidence.filter((e) => e.decision === 'block');

      evidenceSummary = {
        window_days: windowDays,
        guard_decisions_total: guardEvidence.reduce((s, e) => s + Number(e.count), 0),
        guard_decisions_blocked: blocked.reduce((s, e) => s + Number(e.count), 0),
        action_records_total: actionEvidence.reduce((s, e) => s + Number(e.count), 0),
        guard_breakdown: guardEvidence,
        action_breakdown: actionEvidence,
      };

      // Append evidence section to report (markdown only; JSON payload carries evidenceSummary directly)
      if (format !== 'json') {
        const evidenceSection = buildEvidenceSection(evidenceSummary, format);
        sections.push(evidenceSection);
      }
    }

    // Build trend data if requested
    if (exportRecord.include_trends) {
      const snapshots = await listSnapshots(sql, orgId, null, 50);
      if (snapshots.length > 1) {
        // Trend sections are markdown tables; skip for JSON exports
        if (format !== 'json') {
          const trendSection = buildTrendSection(snapshots as unknown as SnapshotRow[], format);
          sections.push(trendSection);
        }
      }
    }

    // Combine all sections into the human-readable report. This is the report
    // *content*; it is no longer the stored artifact — it becomes the signed
    // payload below. The old unsigned markdown/JSON path is gone: report_content
    // is always a signed, independently re-verifiable bundle now.
    const separator = format === 'json' ? '\n' : '\n---\n\n';
    const issuedAt = new Date().toISOString();
    let report = '';
    if (format === 'markdown') {
      const header = `# Compliance Export\n\n`;
      const meta = `**Organization:** org-${orgId}  \n**Generated:** ${issuedAt}  \n**Frameworks:** ${frameworks.join(', ')}  \n**Evidence Window:** ${windowDays} days\n\n---\n\n`;
      report = header + meta + sections.join(separator);
    } else {
      report = sections.join(separator);
    }

    // The signed payload: everything a verifier needs to reconstruct the export.
    const payload = {
      org: `org-${orgId}`,
      frameworks,
      window_days: windowDays,
      format,
      report,
      evidence_summary: evidenceSummary,
      snapshot_ids: snapshotIds,
    };

    // Hash-chain to the previous completed export so a tampered or removed export
    // mid-chain is detectable. Best-effort: a fresh org simply starts the chain.
    let prevBundleHash: string | null = null;
    try {
      const prevRows = await sql`
        SELECT report_content FROM compliance_exports
        WHERE org_id = ${orgId} AND status = 'completed' AND id <> ${exportId}
        ORDER BY created_at DESC LIMIT 1
      `;
      const prevContent = prevRows[0]?.report_content;
      if (prevContent) {
        const prevBundle = typeof prevContent === 'string' ? JSON.parse(prevContent) : prevContent;
        if (prevBundle?.signature && prevBundle?.payload) {
          // Verify the prior bundle before chaining to it, so a tampered prior
          // export is caught at generation time, not only on a later full
          // re-verify. On failure, start a fresh chain (best-effort).
          const { keys } = await getServerPublicJwks(sql);
          if (verifyBundle(prevBundle, keys).ok) {
            prevBundleHash = bundleHash(prevBundle);
          } else {
            console.warn('[compliance] Previous export failed signature verification; starting a fresh hash chain.');
          }
        }
      }
    } catch {
      // No prior signed export to chain to (or it predates signed bundles).
    }

    const key = await getServerSigningKey(sql);
    const bundle = signBundle(payload, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, issuedAt, prevBundleHash);
    const bundleJson = JSON.stringify(bundle);
    const fileSizeBytes = Buffer.byteLength(bundleJson, 'utf8');

    // Update export record with the signed bundle.
    await sql`
      UPDATE compliance_exports
      SET status = 'completed', report_content = ${bundleJson}, evidence_summary = ${JSON.stringify(evidenceSummary)},
          snapshot_ids = ${JSON.stringify(snapshotIds)}, file_size_bytes = ${fileSizeBytes},
          completed_at = NOW()
      WHERE id = ${exportId} AND org_id = ${orgId}
    `;

    return { id: exportId, status: 'completed', file_size_bytes: fileSizeBytes };
  } catch (err) {
    await sql`UPDATE compliance_exports SET status = 'failed', error_message = ${(err as Error).message}, completed_at = NOW() WHERE id = ${exportId} AND org_id = ${orgId}`;
    throw err;
  }
}

interface EvidenceSummary {
  window_days: number;
  guard_decisions_total: number;
  guard_decisions_blocked: number;
  action_records_total: number;
  guard_breakdown?: Array<{ action_type?: string | null; decision: string; count: number | string }>;
  action_breakdown?: Array<{ action_type?: string | null; count: number | string }>;
}

function buildEvidenceSection(evidence: EvidenceSummary | Record<string, unknown>, format: string): string {
  const ev = evidence as EvidenceSummary;
  let section = `
# Enforcement Evidence

`;
  section += `**Window:** ${ev.window_days} days  \n`;
  section += `**Total Guard Decisions:** ${ev.guard_decisions_total}  \n`;
  section += `**Blocked:** ${ev.guard_decisions_blocked}  \n`;
  section += `**Action Records:** ${ev.action_records_total}\n\n`;

  if (ev.guard_breakdown && ev.guard_breakdown.length > 0) {
    section += `## Guard Decision Breakdown

`;
    section += `| Action Type | Decision | Count |
`;
    section += `|-------------|----------|-------|
`;
    for (const row of ev.guard_breakdown) {
      section += `| ${row.action_type || '--'} | ${row.decision} | ${row.count} |
`;
    }
    section += '\n';
  }

  if (ev.action_breakdown && ev.action_breakdown.length > 0) {
    section += `## Action Record Breakdown

`;
    section += `| Action Type | Count |
`;
    section += `|-------------|-------|
`;
    for (const row of ev.action_breakdown) {
      section += `| ${row.action_type || '--'} | ${row.count} |
`;
    }
    section += '\n';
  }

  return section;
}

interface SnapshotRow {
  framework: string;
  coverage_percentage: number;
  covered: number;
  partial: number;
  gaps: number;
  risk_level: string;
  created_at: string | Date;
  [key: string]: unknown;
}

function buildTrendSection(snapshots: SnapshotRow[], format: string): string {
  let section = `
# Compliance Trends

`;

  // Group by framework
  const byFramework: Record<string, SnapshotRow[]> = {};
  for (const snap of snapshots) {
    if (!byFramework[snap.framework]) byFramework[snap.framework] = [];
    (byFramework[snap.framework] as SnapshotRow[]).push(snap);
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
      const latest = (snaps[0] as SnapshotRow).coverage_percentage;
      const previous = (snaps[1] as SnapshotRow).coverage_percentage;
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

interface CreateExportInput {
  name?: string;
  frameworks?: unknown[];
  format?: string;
  window_days?: number;
  include_evidence?: boolean;
  include_remediation?: boolean;
  include_trends?: boolean;
}

export async function createExportRecord(request: Request, { name, frameworks, format, window_days, include_evidence, include_remediation, include_trends }: CreateExportInput): Promise<{ id: string }> {
  const sql = getSql();
  const orgId = getOrgId(request);
  const id = 'ce_' + crypto.randomBytes(12).toString('hex');

  await sql`
    INSERT INTO compliance_exports (id, org_id, name, frameworks, format, window_days, include_evidence, include_remediation, include_trends, requested_by)
    VALUES (${id}, ${orgId}, ${name || 'Compliance Export'}, ${JSON.stringify(frameworks || [])}, ${format || 'markdown'}, ${window_days || 30}, ${include_evidence !== false}, ${include_remediation !== false}, ${include_trends || false}, ${'user'})
  `;

  return { id };
}

export async function listExports(request: Request, { limit }: { limit?: string | number } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const lim = Math.min(parseInt(String(limit || '20'), 10), 100);

  return sql`
    SELECT id, name, frameworks, format, window_days, status, file_size_bytes, error_message, requested_by, started_at, completed_at, created_at
    FROM compliance_exports
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${lim}
  `;
}

export async function getExport(request: Request, exportId: string) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const rows = await sql`SELECT * FROM compliance_exports WHERE id = ${exportId} AND org_id = ${orgId} LIMIT 1`;
  return rows[0] || null;
}

export async function deleteExport(request: Request, exportId: string): Promise<{ deleted: true }> {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`DELETE FROM compliance_exports WHERE id = ${exportId} AND org_id = ${orgId}`;
  return { deleted: true };
}

// -----------------------------------------------
// Schedule CRUD
// -----------------------------------------------

interface CreateScheduleInput {
  name?: string;
  frameworks?: unknown[];
  format?: string;
  window_days?: number;
  cron_expression?: string;
  include_evidence?: boolean;
  include_remediation?: boolean;
  include_trends?: boolean;
}

export async function createSchedule(request: Request, { name, frameworks, format, window_days, cron_expression, include_evidence, include_remediation, include_trends }: CreateScheduleInput): Promise<{ id: string }> {
  const sql = getSql();
  const orgId = getOrgId(request);
  const id = 'csch_' + crypto.randomBytes(12).toString('hex');

  await sql`
    INSERT INTO compliance_schedules (id, org_id, name, frameworks, format, window_days, cron_expression, include_evidence, include_remediation, include_trends)
    VALUES (${id}, ${orgId}, ${name || 'Scheduled Export'}, ${JSON.stringify(frameworks || [])}, ${format || 'markdown'}, ${window_days || 30}, ${cron_expression}, ${include_evidence !== false}, ${include_remediation !== false}, ${include_trends || false})
  `;

  return { id };
}

export async function listSchedules(request: Request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  return sql`SELECT * FROM compliance_schedules WHERE org_id = ${orgId} ORDER BY created_at DESC`;
}

export async function updateSchedule(request: Request, scheduleId: string, fields: { enabled?: boolean; name?: string }) {
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

export async function deleteSchedule(request: Request, scheduleId: string): Promise<{ deleted: true }> {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`DELETE FROM compliance_schedules WHERE id = ${scheduleId} AND org_id = ${orgId}`;
  return { deleted: true };
}

// -----------------------------------------------
// Trend Analysis (SQL-based, no LLM)
// -----------------------------------------------

export async function getComplianceTrends(request: Request, { framework, limit }: { framework?: string; limit?: string | number } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const lim = Math.min(parseInt(String(limit || '30'), 10), 100);

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
