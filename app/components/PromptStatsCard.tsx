'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileCode, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

export default function PromptStatsCard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  // Deliberately NOT keyed to the agent filter: /api/prompts/stats has no
  // agent param, so refetching on picker change only faked responsiveness
  // while showing the same org-wide numbers.
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
  }, []);

  if (loading) return <CardSkeleton />;

  const overall = stats?.overall || {};
  const hasData = (overall.total_runs || 0) > 0;
  const unavailable = stats?.available === false;

  if (!hasData) {
    return (
      <Card className="h-full" ref={sizeRef}>
        <CardHeader title={<span className="flex items-center">Prompts<HelpIcon sectionKey="prompt-stats" tip={HELP_TIPS['prompt-stats']} /></span>} icon={FileCode} />
        <CardContent>
          <EmptyState
            icon={FileCode}
            title={unavailable ? 'Prompt analytics unavailable' : 'No prompt activity'}
            description={unavailable ? (stats?.setup_hint || 'Run the prompt analytics migration to enable usage stats.') : 'Create and render prompts to track usage here.'}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full" ref={sizeRef}>
      <CardHeader
        title={<span className="flex items-center">Prompts<HelpIcon sectionKey="prompt-stats" tip={HELP_TIPS['prompt-stats']} /></span>}
        icon={FileCode}
        count={overall.unique_templates || 0}
        action={
          <Link href="/prompts" className="flex items-center gap-1 text-xs text-secondary hover:text-white transition-colors">
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
            {stats.by_template.slice(0, fitItems(tileHeight, 24, 3)).map((t: any) => (
              <div key={t.template_name} className="flex items-center justify-between text-xs">
                <span className="text-secondary truncate">{t.template_name}</span>
                <span className="text-tertiary tabular-nums shrink-0">{t.total_runs} runs</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
