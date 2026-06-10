'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Activity, ArrowRight, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

export default function DriftCard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useEffect(() => {
    async function fetchData() {
      try {
        const params = agentId ? `?agent_id=${agentId}` : '';
        const res = await fetch(`/api/drift/stats${params}`);
        if (res.ok) setStats(await res.json());
        else setStats(null);
      } catch { setStats(null); }
      finally { setLoading(false); }
    }
    fetchData();
  }, [agentId]);

  if (loading) return <CardSkeleton />;

  const overall = stats?.overall || {};
  const hasData = (overall.total_alerts || 0) > 0;

  if (!hasData) {
    return (
      <Card className="h-full" ref={sizeRef}>
        <CardHeader title={<span className="flex items-center">Drift<HelpIcon sectionKey="drift" tip={HELP_TIPS['drift']} /></span>} icon={Activity} />
        <CardContent>
          <EmptyState icon={Activity} title="No drift data" description="Run drift detection to monitor behavioral patterns." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full" ref={sizeRef}>
      <CardHeader
        title={<span className="flex items-center">Drift<HelpIcon sectionKey="drift" tip={HELP_TIPS['drift']} /></span>}
        icon={Activity}
        count={overall.total_alerts || 0}
        action={<Link href="/drift" className="flex items-center gap-1 text-xs text-secondary hover:text-white transition-colors">View <ArrowRight size={12} /></Link>}
      />
      <CardContent>
        <div className="flex items-center justify-around mb-3">
          <StatCompact label="Critical" value={overall.critical_count || 0} color="text-error" />
          <StatCompact label="Warning" value={overall.warning_count || 0} color="text-warning" />
          <StatCompact label="Unack" value={overall.unacknowledged || 0} color={parseInt(overall.unacknowledged) > 0 ? 'text-warning' : 'text-secondary'} />
        </div>

        {stats?.by_agent && stats.by_agent.length > 0 && (
          <div className="space-y-1">
            {stats.by_agent.slice(0, fitItems(tileHeight, 22, 2)).map((a: any) => (
              <div key={a.agent_id} className="flex items-center justify-between text-xs">
                <span className="text-secondary truncate">{a.agent_id}</span>
                <div className="flex items-center gap-1.5">
                  {a.critical > 0 && <Badge variant="error" size="xs">{a.critical}</Badge>}
                  {a.warning > 0 && <Badge variant="warning" size="xs">{a.warning}</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
