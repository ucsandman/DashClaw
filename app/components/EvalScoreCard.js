'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart3, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';

export default function EvalScoreCard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useEffect(() => {
    async function fetchData() {
      try {
        const params = agentId ? `?agent_id=${agentId}` : '';
        const res = await fetch(`/api/evaluations/stats${params}`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        } else {
          setStats(null);
        }
      } catch (error) {
        console.error('Failed to fetch eval stats:', error);
        setStats(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [agentId]);

  if (loading) return <CardSkeleton />;

  const overall = stats?.overall || {};
  const distribution = stats?.distribution || [];
  const hasData = (overall.total_scores || 0) > 0;

  if (!hasData) {
    return (
      <Card className="h-full" ref={sizeRef}>
        <CardHeader title="Evaluations" icon={BarChart3} />
        <CardContent>
          <EmptyState icon={BarChart3} title="No evaluations yet" description="Define scorers and run evaluations to track agent quality." />
        </CardContent>
      </Card>
    );
  }

  const avgPct = overall.avg_score ? Math.round(overall.avg_score * 100) : 0;
  const avgColor = avgPct >= 80 ? 'text-green-400' : avgPct >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <Card className="h-full" ref={sizeRef}>
      <CardHeader
        title="Evaluations"
        icon={BarChart3}
        count={overall.total_scores || 0}
        action={
          <Link href="/evaluations" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors">
            View <ArrowRight size={12} />
          </Link>
        }
      />
      <CardContent>
        <div className="flex items-center justify-around mb-4">
          <StatCompact label="Avg Score" value={`${avgPct}%`} color={avgColor} />
          <StatCompact label="Scorers" value={overall.unique_scorers || 0} />
          <StatCompact label="Today" value={overall.today_count || 0} />
        </div>

        {distribution.length > 0 && (
          <div className="flex items-end gap-1 h-12">
            {distribution.map((bucket) => {
              const maxCount = Math.max(...distribution.map(b => parseInt(b.count) || 0));
              const height = maxCount > 0 ? ((parseInt(bucket.count) || 0) / maxCount) * 100 : 0;
              const color = bucket.bucket === 'excellent' ? 'bg-green-500' : bucket.bucket === 'acceptable' ? 'bg-yellow-500' : 'bg-red-500';
              return (
                <div key={bucket.bucket} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full rounded-t" style={{ height: `${Math.max(height, 8)}%` }}>
                    <div className={`w-full h-full rounded-t ${color}`} />
                  </div>
                  <span className="text-[9px] text-zinc-600 capitalize">{bucket.bucket}</span>
                </div>
              );
            })}
          </div>
        )}

        {stats?.by_scorer && stats.by_scorer.length > 0 && (
          <div className="mt-3 space-y-1">
            {stats.by_scorer.slice(0, fitItems(tileHeight, 24, 3)).map(scorer => (
              <div key={scorer.scorer_name} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 truncate">{scorer.scorer_name}</span>
                <Badge variant={parseFloat(scorer.avg_score) >= 0.8 ? 'success' : parseFloat(scorer.avg_score) >= 0.5 ? 'warning' : 'error'} size="xs">
                  {Math.round(parseFloat(scorer.avg_score) * 100)}%
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
