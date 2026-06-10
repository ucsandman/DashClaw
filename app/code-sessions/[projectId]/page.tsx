import { headers } from 'next/headers';
import { Bot, Layers } from 'lucide-react';
import { getSql } from '../../lib/db';
import {
  getProject,
  listSessions,
  listSubagentToolUseAttribution,
  listMemos,
} from '../../lib/repositories/code-sessions.repository';
import { computeRoiFromRows } from '../../lib/claude-code/subagent-roi';
import type { AttributionRow } from '../../lib/claude-code/subagent-roi';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent } from '../../components/ui/Card';
import WeeklyMemoPanel from './WeeklyMemoPanel';
import SessionsTable from './SessionsTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// keep/trim/drop verdict → chip tone. Status tokens only, label always paired
// with color so the verdict survives a WCAG / color-blind read.
const REC_META: Record<string, { label: string; cls: string }> = {
  keep: { label: 'Keep', cls: 'text-status-success border-status-success/30 bg-status-success/10' },
  trim: { label: 'Trim', cls: 'text-status-warning border-status-warning/30 bg-status-warning/10' },
  drop: { label: 'Drop', cls: 'text-status-error border-status-error/30 bg-status-error/10' },
};

function RecChip({ recommendation }: { recommendation?: any }) {
  const meta = REC_META[recommendation]
    || { label: recommendation || '—', cls: 'text-tertiary border-border bg-surface-tertiary' };
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function pct(rate: any) {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

function usd(n: any) {
  return n == null ? '—' : `$${Number(n).toFixed(2)}`;
}

// Fallback label when the project row is missing (deleted mid-navigation):
// a short, stable id rather than the full internal `cp_<uuid>`.
function shortProjectId(id: any) {
  const raw = String(id || '');
  const body = raw.startsWith('cp_') ? raw.slice(3) : raw;
  return body.length > 8 ? `${body.slice(0, 8)}…` : body || '—';
}

// Section wrapper that mirrors the fleet table pattern (Card + bordered header)
// so each table reads as a peer of the WeeklyMemoPanel card, not a bare table
// floating on the page background.
function TableSection({ title, icon: Icon, description, children }: { title?: React.ReactNode; icon?: React.ElementType; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card hover={false}>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        {Icon && <Icon size={15} className="shrink-0 text-tertiary" aria-hidden="true" />}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-tertiary">{description}</p>}
        </div>
      </div>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

export default async function ProjectSessionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();
  const [project, sessions, roiRows, memos] = await Promise.all([
    // Project row is display-only (name/path header); degrade to the short id.
    getProject(sql, orgId, projectId).catch(() => null),
    listSessions(sql, orgId, projectId, { limit: 100 }),
    // ROI + memo are best-effort retrospectives; a failure in either must not
    // blank the sessions list, so each degrades independently.
    listSubagentToolUseAttribution(sql, orgId, { projectId }).catch(() => []),
    listMemos(sql, orgId, projectId).catch(() => []),
  ]);
  // roiRows are listSubagentToolUseAttribution Rows ({ name, cost_usd, duration_ms, success });
  // they match AttributionRow at runtime (the .catch fallback is an empty array).
  const roi = computeRoiFromRows(roiRows as unknown as AttributionRow[]);
  // listMemos returns rows ordered iso_week_tag DESC, so [0] is the latest.
  const latestMemo = memos[0] || null;
  // Real path (or slug) instead of the old truncated internal id.
  const projectLabel = (project?.cwd as string) || (project?.slug as string) || shortProjectId(projectId);

  return (
    <PageLayout
      title={(project?.slug as string) || 'Sessions'}
      subtitle={(project?.cwd as string) || `Project ${shortProjectId(projectId)}`}
      breadcrumbs={['Code Sessions', projectLabel]}
      maturity="beta"
    >
      <div className="max-w-5xl space-y-6">
        {/* Weekly spend memo — server-seeded with the latest stored memo (Markdown
            body), with a client Regenerate action. Project-level summary, leads. */}
        <WeeklyMemoPanel projectId={projectId} initialMemo={latestMemo} />

        {/* Subagent ROI — keep/trim/drop per subagent by success rate and
            cost-per-success. Server-rendered via the same computeRoiFromRows the
            /subagent-roi API uses, so the verdict matches the API. Only shown
            when there's subagent activity to report. */}
        {roi.length > 0 && (
          <TableSection
            title="Subagent ROI"
            icon={Bot}
            description="Keep / trim / drop by success rate and cost-per-success across this project's sessions."
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                    <th className="px-5 py-3">Subagent</th>
                    <th className="px-5 py-3 text-right">Runs</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Avg</th>
                    <th className="px-5 py-3 text-right">Success</th>
                    <th className="px-5 py-3 text-right">$/success</th>
                    <th className="px-5 py-3">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {roi.map((r: any) => (
                    <tr key={r.name} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-5 py-3 font-mono text-xs text-secondary">{r.name}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-secondary">{r.invocation_count}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-secondary">{usd(r.total_cost_usd)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-secondary">{usd(r.avg_cost_usd)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-secondary">{pct(r.success_rate)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-secondary">{usd(r.cost_per_success_usd)}</td>
                      <td className="px-5 py-3"><RecChip recommendation={r.recommendation} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableSection>
        )}

        <TableSection title="Sessions" icon={Layers}>
          <SessionsTable projectId={projectId} sessions={sessions as any} />
        </TableSection>
      </div>
    </PageLayout>
  );
}
