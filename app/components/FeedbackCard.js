'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MessageCircle, ArrowRight, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';

export default function FeedbackCard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useEffect(() => {
    async function fetchData() {
      try {
        const params = agentId ? `?agent_id=${agentId}` : '';
        const res = await fetch(`/api/feedback/stats${params}`);
        if (res.ok) {
          setStats(await res.json());
        } else {
          setStats(null);
        }
      } catch (error) {
        console.error('Failed to fetch feedback stats:', error);
        setStats(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [agentId]);

  if (loading) return <CardSkeleton />;

  const overall = stats?.overall || {};
  const hasData = (overall.total_feedback || 0) > 0;

  if (!hasData) {
    return (
      <Card className="h-full" ref={sizeRef}>
        <CardHeader title="Feedback" icon={MessageCircle} />
        <CardContent>
          <EmptyState icon={MessageCircle} title="No feedback yet" description="Submit feedback via the dashboard or SDK." />
        </CardContent>
      </Card>
    );
  }

  const posRate = overall.total_feedback > 0
    ? Math.round((overall.positive_count / overall.total_feedback) * 100)
    : 0;

  return (
    <Card className="h-full" ref={sizeRef}>
      <CardHeader
        title="Feedback"
        icon={MessageCircle}
        count={overall.total_feedback || 0}
        action={
          <Link href="/feedback" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors">
            View <ArrowRight size={12} />
          </Link>
        }
      />
      <CardContent>
        <div className="flex items-center justify-around mb-4">
          <StatCompact label="Avg Rating" value={overall.avg_rating ? `${overall.avg_rating}/5` : '--'} color={parseFloat(overall.avg_rating) >= 4 ? 'text-green-400' : parseFloat(overall.avg_rating) >= 3 ? 'text-yellow-400' : 'text-red-400'} />
          <StatCompact label="Positive" value={`${posRate}%`} color="text-green-400" />
          <StatCompact label="Unresolved" value={overall.unresolved_count || 0} color={parseInt(overall.unresolved_count) > 0 ? 'text-yellow-400' : 'text-zinc-400'} />
        </div>

        {/* Sentiment bar */}
        <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800 mb-3">
          {overall.positive_count > 0 && (
            <div className="bg-green-500" style={{ width: `${(overall.positive_count / overall.total_feedback) * 100}%` }} />
          )}
          {overall.neutral_count > 0 && (
            <div className="bg-zinc-500" style={{ width: `${(overall.neutral_count / overall.total_feedback) * 100}%` }} />
          )}
          {overall.negative_count > 0 && (
            <div className="bg-red-500" style={{ width: `${(overall.negative_count / overall.total_feedback) * 100}%` }} />
          )}
        </div>
        <div className="flex justify-between text-[9px] text-zinc-600 mb-3">
          <span className="flex items-center gap-1"><ThumbsUp size={9} className="text-green-500" /> {overall.positive_count}</span>
          <span>{overall.neutral_count} neutral</span>
          <span className="flex items-center gap-1"><ThumbsDown size={9} className="text-red-500" /> {overall.negative_count}</span>
        </div>

        {stats?.by_agent && stats.by_agent.length > 0 && (
          <div className="space-y-1">
            {stats.by_agent.slice(0, fitItems(tileHeight, 22, 2)).map(a => (
              <div key={a.agent_id} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 truncate">{a.agent_id}</span>
                <span className="text-zinc-500 tabular-nums shrink-0">{a.avg_rating}/5</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
