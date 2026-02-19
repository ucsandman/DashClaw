'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileCode, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';

export default function PromptStatsCard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/prompts/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        } else {
          setStats(null);
        }
      } catch (error) {
        console.error('Failed to fetch prompt stats:', error);
        setStats(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [agentId]);

  if (loading) return <CardSkeleton />;

  const overall = stats?.overall || {};
  const hasData = (overall.total_runs || 0) > 0;

  if (!hasData) {
    return (
      <Card className="h-full" ref={sizeRef}>
        <CardHeader title="Prompts" icon={FileCode} />
        <CardContent>
          <EmptyState icon={FileCode} title="No prompt activity" description="Create and render prompts to track usage here." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full" ref={sizeRef}>
      <CardHeader
        title="Prompts"
        icon={FileCode}
        count={overall.unique_templates || 0}
        action={
          <Link href="/prompts" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors">
            View <ArrowRight size={12} />
          </Link>
        }
      />
      <CardContent>
        <div className="flex items-center justify-around mb-4">
          <StatCompact label="Total Runs" value={overall.total_runs || 0} />
          <StatCompact label="Avg Tokens" value={overall.avg_tokens || '--'} />
          <StatCompact label="Today" value={overall.today_count || 0} />
        </div>

        {stats?.by_template && stats.by_template.length > 0 && (
          <div className="space-y-1.5">
            {stats.by_template.slice(0, fitItems(tileHeight, 24, 3)).map(t => (
              <div key={t.template_name} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 truncate">{t.template_name}</span>
                <span className="text-zinc-500 tabular-nums shrink-0">{t.total_runs} runs</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
