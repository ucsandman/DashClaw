'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FileText, Zap, Lightbulb, Heart, BarChart3, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { ProgressBar } from './ui/ProgressBar';
import { StatCompact } from './ui/Stat';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

export default function ContextCard() {
  const [contextData, setContextData] = useState<any>({
    todayPoints: 0,
    recentPoints: [],
    stats: {}
  });
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useEffect(() => {
    async function fetchContext() {
      try {
        const res = await fetch(`/api/learning${agentId ? `?agent_id=${agentId}` : ''}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();

        const decisions = (data.decisions || []).slice(0, 6);
        const stats = data.stats || {};

        const points = decisions.map((d: any) => ({
          id: d.id,
          text: d.decision,
          category: mapOutcomeToCategory(d.outcome),
          importance: d.context ? Math.min(10, Math.max(3, Math.ceil(d.decision.length / 30))) : 5,
          timestamp: formatTimestamp(d.timestamp)
        }));

        setContextData({
          todayPoints: points.length,
          recentPoints: points,
          stats
        });
      } catch (error) {
        console.error('Failed to fetch context:', error);
        setContextData({ todayPoints: 0, recentPoints: [], stats: {} });
      } finally {
        setLoading(false);
      }
    }
    fetchContext();
  }, [agentId]);

  const mapOutcomeToCategory = (outcome: any) => {
    if (outcome === 'success') return 'decision';
    if (outcome === 'pending') return 'status';
    if (outcome === 'failure' || outcome === 'failed') return 'insight';
    return 'status';
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return '--';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }) + ' EST';
    } catch { return ts; }
  };

  const getCategoryIcon = (category: any) => {
    switch (category) {
      case 'decision': return Zap;
      case 'insight': return Lightbulb;
      case 'preference': return Heart;
      case 'status': return BarChart3;
      default: return FileText;
    }
  };

  const getCategoryVariant = (category: any) => {
    switch (category) {
      case 'decision': return 'error';
      case 'insight': return 'warning';
      case 'preference': return 'brand';
      case 'status': return 'info';
      default: return 'default';
    }
  };

  if (loading) {
    return <CardSkeleton />;
  }

  const DECISION_ITEM_H = 90;
  const STATS_ROW_H = 80;
  const SECTION_HEADER_H = 30;
  const hasStats = contextData.stats.successRate !== undefined;
  const reserved = (hasStats ? STATS_ROW_H : 0) + SECTION_HEADER_H;
  const maxVisibleDecisions = tileHeight > 0 ? fitItems(tileHeight, DECISION_ITEM_H, reserved) : 3;
  const visibleDecisions = contextData.recentPoints.slice(0, maxVisibleDecisions);
  const decisionOverflow = contextData.recentPoints.length - visibleDecisions.length;

  const viewAllLink = (
    <Link href="/learning" className="text-xs text-brand hover:text-brand-hover transition-colors inline-flex items-center gap-1">
      View all <ArrowRight size={12} />
    </Link>
  );

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Context<HelpIcon sectionKey="context-threads" tip={HELP_TIPS['context-threads']} /></span>} icon={FileText} action={viewAllLink}>
        <Badge variant="success" size="sm">{contextData.todayPoints} decisions</Badge>
        {contextData.stats.totalLessons > 0 && (
          <Badge variant="info" size="sm">{contextData.stats.totalLessons} lessons</Badge>
        )}
      </CardHeader>
      <CardContent>
        {contextData.recentPoints.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No learning data yet"
            description="Record decisions via the SDK's recordDecision() or POST /api/learning"
          />
        ) : (
          <div ref={sizeRef as React.RefObject<HTMLDivElement>} className="flex flex-col h-full min-h-0 space-y-4">
            {/* Stats Row */}
            {hasStats && (
              <div className="grid grid-cols-3 gap-2 bg-surface-tertiary rounded-lg p-3 flex-shrink-0">
                <StatCompact label="Success" value={`${contextData.stats.successRate}%`} color="text-success" />
                <StatCompact label="Decisions" value={contextData.stats.totalDecisions || 0} />
                <StatCompact label="Patterns" value={contextData.stats.patterns || 0} color="text-purple-400" />
              </div>
            )}

            {/* Recent Decisions */}
            <div className="flex-1 min-h-0">
              <div className="text-xs font-medium text-secondary uppercase tracking-wider mb-2">Recent Decisions</div>
              <div className="space-y-2">
                {visibleDecisions.map((point: any) => {
                  const IconComponent = getCategoryIcon(point.category);
                  return (
                    <div key={point.id} className="bg-surface-tertiary rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <IconComponent size={14} className="text-secondary" />
                          <Badge variant={getCategoryVariant(point.category)} size="xs">
                            {point.category}
                          </Badge>
                        </div>
                        <span className="text-[10px] text-tertiary">{point.timestamp}</span>
                      </div>

                      <div className="text-sm text-secondary mb-2">{point.text}</div>

                      <ProgressBar value={point.importance * 10} color="brand" />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
