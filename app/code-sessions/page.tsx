import { headers } from 'next/headers';
import { Terminal } from 'lucide-react';
import { getSql } from '../lib/db';
import { listProjects, countUnreadAlerts } from '../lib/repositories/code-sessions.repository';
import PageLayout from '../components/PageLayout';
import CodeSessionAlertsPanel from '../components/CodeSessionAlertsPanel';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import ProjectsTable from './ProjectsTable';

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
    <PageLayout agentFilter={false}
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
              <ProjectsTable projects={projects as any} />
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
