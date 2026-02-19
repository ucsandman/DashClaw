'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Zap, ArrowRight, TrendingUp, TrendingDown, Minus, Award } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';

const MATURITY_VARIANT = {
  master: 'info', expert: 'success', proficient: 'info', competent: 'warning', developing: 'warning', novice: 'default',
};

export default function VelocityCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useEffect(() => {
    async function fetchData() {
      try {
        const params = agentId ? `?agent_id=${agentId}` : '';
        const res = await fetch(`/api/learning/analytics/summary${params}`);
        if (res.ok) setData(await res.json());
        else setData(null);
      } catch { setData(null); }
      finally { setLoading(false); }
    }
    fetchData();
  }, [agentId]);

  if (loading) return <CardSkeleton />;

  const agents = data?.by_agent || [];
  const overall = data?.overall || {};
  const hasData = agents.length > 0;

  if (!hasData) {
    return (
      <Card className="h-full" ref={sizeRef}>
        <CardHeader title="Learning Velocity" icon={Zap} />
        <CardContent>
          <EmptyState icon={Zap} title="No learning data" description="Record episodes to track learning velocity." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full" ref={sizeRef}>
      <CardHeader
        title="Learning Velocity"
        icon={Zap}
        action={<Link href="/learning/analytics" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors">View <ArrowRight size={12} /></Link>}
      />
      <CardContent>
        <div className="flex items-center justify-around mb-3">
          <StatCompact label="Episodes" value={overall.total_episodes || 0} />
          <StatCompact label="Avg Score" value={overall.avg_score || '--'} color={parseFloat(overall.avg_score) >= 70 ? 'text-green-400' : 'text-yellow-400'} />
          <StatCompact label="Success" value={overall.success_rate ? `${Math.round(overall.success_rate * 100)}%` : '--'} color="text-green-400" />
        </div>

        <div className="space-y-1.5">
          {agents.slice(0, fitItems(tileHeight, 28, 2)).map(a => {
            const VelIcon = a.velocity > 0.5 ? TrendingUp : a.velocity < -0.5 ? TrendingDown : Minus;
            const velColor = a.velocity > 0.5 ? 'text-green-400' : a.velocity < -0.5 ? 'text-red-400' : 'text-zinc-500';
            return (
              <div key={a.agent_id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-zinc-300 truncate">{a.agent_id}</span>
                  <Badge variant={MATURITY_VARIANT[a.maturity_level] || 'default'} size="xs">{a.maturity_level}</Badge>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <VelIcon size={12} className={velColor} />
                  <span className={`tabular-nums text-[10px] ${velColor}`}>{a.velocity !== null ? (a.velocity > 0 ? '+' : '') + a.velocity : '--'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
