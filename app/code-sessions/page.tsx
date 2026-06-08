import Link from 'next/link';
import { headers } from 'next/headers';
import { Terminal, FolderGit2, ChevronRight } from 'lucide-react';
import { getSql } from '../lib/db.js';
import { listProjects, countUnreadAlerts } from '../lib/repositories/code-sessions.repository.js';
import PageLayout from '../components/PageLayout';
import CodeSessionAlertsPanel from '../components/CodeSessionAlertsPanel';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CodeSessionsProjectsPage() {
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();
  const [projects, unread] = await Promise.all([
    listProjects(sql, orgId).catch(() => []),
    countUnreadAlerts(sql, orgId).catch(() => 0),
  ]);

  return (
    <PageLayout
      title="Code Sessions"
      subtitle="Claude Code session analytics from hooks and JSONL backfill"
      maturity="beta"
      breadcrumbs={['Command', 'Code Sessions']}
      actions={
        unread > 0 ? (
          <Badge variant="brand" size="sm">
            {unread} unread alert{unread === 1 ? '' : 's'}
          </Badge>
        ) : null
      }
    >
      <CodeSessionAlertsPanel />

      <div className="mt-6">
        <Card hover={false}>
          <CardContent className="p-0">
            {!projects.length ? (
              <div className="p-8">
                <EmptyState
                  icon={Terminal}
                  title="No Code Sessions data yet"
                  description="Enable the Stop hook reporter (DASHCLAW_CODE_SESSIONS_ENABLED=1), or backfill existing transcripts with `dashclaw code ingest`."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                      <th className="px-6 py-4">Project</th>
                      <th className="px-6 py-4 text-right">Sessions</th>
                      <th className="px-6 py-4 text-right">Total cost</th>
                      <th className="px-6 py-4">Last activity</th>
                      <th className="px-6 py-4 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {projects.map((p: any) => (
                      <tr key={p.id} data-entity-type="codeSession" data-entity-id={p.id} className="transition-colors hover:bg-white/[0.02]">
                        <td className="px-6 py-4">
                          <Link
                            href={`/code-sessions/${p.id}`}
                            className="group/name flex items-center gap-3"
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-white/[0.03] text-secondary">
                              <FolderGit2 size={16} />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-white transition-colors group-hover/name:text-brand">
                                {p.slug}
                              </div>
                              {p.cwd && (
                                <div className="mt-0.5 truncate text-[11px] text-tertiary">{p.cwd}</div>
                              )}
                            </div>
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-secondary tabular-nums">
                          {p.session_count}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-medium text-white tabular-nums">
                          ${Number(p.total_cost_usd || 0).toFixed(2)}
                        </td>
                        <td className="px-6 py-4">
                          {p.last_session_at ? (
                            <div className="flex flex-col text-xs">
                              <span className="text-secondary tabular-nums">
                                {new Date(p.last_session_at).toLocaleDateString()}
                              </span>
                              <span className="text-[11px] text-tertiary tabular-nums">
                                {new Date(p.last_session_at).toLocaleTimeString()}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-tertiary">Never</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/code-sessions/${p.id}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-colors hover:text-brand-hover"
                          >
                            Inspect <ChevronRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
