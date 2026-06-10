'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { ProgressBar } from './ui/ProgressBar';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';
import { applyDecisionToStats } from '../lib/learning-stats';

interface LearningStats {
  decisions: number;
  lessons: number;
  successRate: number;
  totalWithOutcome: number;
  recentLessons: string[];
}

export default function LearningStatsCard() {
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();

  useRealtime((event: string, payload: any) => {
    if (event === 'decision.created') {
      if (agentId && payload.agent_id !== agentId) return;

      setStats(prev => {
        if (!prev) return null;
        // Pending-safe rate update shared with /learning (the old recompute
        // divided by ALL decisions and drifted from the server's terminal-only
        // rate after every event).
        const next = applyDecisionToStats(
          { totalDecisions: prev.decisions, successRate: prev.successRate, totalWithOutcome: prev.totalWithOutcome },
          payload.outcome,
        );
        return {
          ...prev,
          decisions: next.totalDecisions,
          successRate: next.successRate,
          totalWithOutcome: next.totalWithOutcome,
          recentLessons: prev.recentLessons,
        };
      });
    }
  });

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/learning${agentId ? `?agent_id=${agentId}` : ''}`);
        const data = await res.json();
        if (data.stats && data.lessons) {
          setStats({
            decisions: data.stats.totalDecisions || 0,
            lessons: data.stats.totalLessons || 0,
            successRate: data.stats.successRate || 0,
            totalWithOutcome: data.stats.totalWithOutcome || 0,
            // Lessons are live consolidation rows ({action_type, guidance,
            // success_rate}), not the dead `lessons`-table rows.
            recentLessons: data.lessons.slice(0, 4).map((l: any) =>
              l.guidance || (l.action_type ? `${l.action_type}: ${l.success_rate ?? 0}% success over ${l.sample_size ?? 0} samples` : l.lesson || 'Lesson')
            )
          });
        } else {
          setStats({ decisions: 0, lessons: 0, successRate: 0, totalWithOutcome: 0, recentLessons: [] });
        }
      } catch (error) {
        console.error('Failed to fetch learning stats:', error);
        setStats({ decisions: 0, lessons: 0, successRate: 0, totalWithOutcome: 0, recentLessons: [] });
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [agentId]);

  if (loading) {
    return <CardSkeleton />;
  }

  if (!stats || (stats.decisions === 0 && stats.lessons === 0)) {
    return (
      <Card className="h-full">
        <CardHeader title={<span className="flex items-center">Learning<HelpIcon sectionKey="learning" tip={HELP_TIPS['learning']} /></span>} icon={BookOpen} />
        <CardContent>
          <EmptyState
            icon={BookOpen}
            title="No learning data yet"
            description="Record decisions via the SDK's recordDecision() or POST /api/learning"
          />
        </CardContent>
      </Card>
    );
  }

  const viewAllLink = (
    <Link href="/learning" className="text-xs text-brand hover:text-brand-hover transition-colors inline-flex items-center gap-1">
      View all <ArrowRight size={12} />
    </Link>
  );

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Learning<HelpIcon sectionKey="learning" tip={HELP_TIPS['learning']} /></span>} icon={BookOpen} action={viewAllLink}>
        <span className="text-xs text-tertiary">{stats.successRate}% success</span>
      </CardHeader>

      <CardContent>
        {/* Stats row */}
        <div className="bg-surface-tertiary rounded-lg p-3 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <StatCompact label="Decisions Tracked" value={stats.decisions} color="text-white" />
            <StatCompact label="Distilled Lessons" value={stats.lessons} color="text-white" />
          </div>
        </div>

        {/* Success rate bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-secondary">Decision Success</span>
            <span className="text-white font-medium tabular-nums">{stats.successRate}%</span>
          </div>
          <ProgressBar value={stats.successRate} color="success" />
        </div>

        {/* Recent lessons */}
        {stats.recentLessons.length > 0 && (
          <div>
            <div className="text-xs font-medium text-secondary uppercase tracking-wider mb-2">Recent Lessons</div>
            <div className="space-y-2">
              {stats.recentLessons.map((lesson, index) => (
                <div key={index} className="text-xs text-secondary flex items-start gap-2">
                  <span className="text-brand mt-1 flex-shrink-0">&#8226;</span>
                  <span className="transition-colors duration-150">{lesson}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
