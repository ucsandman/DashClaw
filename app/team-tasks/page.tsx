'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useRealtime } from '../hooks/useRealtime';
import TeamTaskTimeline from './_components/TeamTaskTimeline';

const STATUS_BADGE: Record<string, string> = {
  open: 'text-info',
  in_progress: 'text-info',
  awaiting_approval: 'text-warning',
  done: 'text-success',
  failed: 'text-error',
  abandoned: 'text-disabled',
};

export default function TeamTasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ task: any; events: any[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/team-tasks?limit=100', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
        setStale(false);
      } else {
        setStale(true);
      }
    } catch (error) {
      console.error('Failed to fetch team tasks:', error);
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (taskId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/team-tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
      if (res.ok) setDetail(await res.json());
    } catch (error) {
      console.error('Failed to fetch team task detail:', error);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
    else setDetail(null);
  }, [selectedId, fetchDetail]);

  // Live updates: refetch the list on task creation, and the open timeline
  // when one of its events arrives. Coalesce bursts into one refetch.
  const liveTimer = useRef<any>(null);
  useRealtime(useCallback((event: string, payload: any) => {
    if (event !== 'team_task.created' && event !== 'team_task.event') return;
    void payload;
    if (liveTimer.current) return;
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      fetchTasks();
      if (selectedId) fetchDetail(selectedId);
    }, 800);
  }, [selectedId, fetchTasks, fetchDetail]));

  return (
    <PageLayout
      title="Team Tasks"
      subtitle="Multi-agent /team runs — who leads, what was delegated, and every exchange"
      breadcrumbs={['Govern', 'Team Tasks']}
      maturity="beta"
    >
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <Card hover={false}>
            <CardHeader title="Tasks" icon={Users} count={tasks.length} />
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    icon={Users}
                    title="No team tasks yet"
                    description="Run a /team task from Telegram or Claude Code and it will appear here live."
                  />
                </div>
              ) : (
                <ul>
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelectedId(t.id)}
                        className={`w-full text-left px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] ${selectedId === t.id ? 'bg-white/[0.05]' : ''}`}
                      >
                        <div className="flex items-center gap-2 text-xs mb-1">
                          <span className={`uppercase font-medium ${STATUS_BADGE[t.status] || 'text-tertiary'}`}>{t.status}</span>
                          <span className="text-disabled">lead: {t.lead_agent}</span>
                          <span className="text-disabled">{t.origin}</span>
                          {stale && <span className="text-warning ml-auto">stale</span>}
                        </div>
                        <div className="text-sm text-secondary truncate">{t.instruction}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-3">
          <Card hover={false}>
            <CardHeader title={detail?.task?.id || 'Timeline'} icon={Users} count={detail?.events?.length ?? 0} />
            <CardContent>
              {!selectedId ? (
                <div className="text-sm text-tertiary py-4">Select a task to see its timeline.</div>
              ) : detailLoading && !detail ? (
                <div className="space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <TeamTaskTimeline events={detail?.events || []} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
