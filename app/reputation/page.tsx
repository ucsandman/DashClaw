'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Award, RotateCw } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { ProgressBar } from '../components/ui/ProgressBar';

interface ReputationVector {
  agent_id: string;
  reliability_score?: number | string;
  risk_score?: number | string;
  completion_rate?: number | string;
  confidence?: number | string;
  total_events?: number | string;
}

function pct(value: number | string | null | undefined): string {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function reliabilityColor(score: number | string | null | undefined): string {
  const n = Number(score || 0);
  if (n >= 0.85) return 'success';
  if (n >= 0.6) return 'brand';
  if (n >= 0.4) return 'warning';
  return 'error';
}

// risk_score is a 0-100 integer (app/lib/reputation.js computeRiskScore), not a
// 0..1 fraction like the other vector scores — threshold on the 0-100 scale.
function riskBadge(score: number | string | null | undefined): { variant: string; label: string } {
  const n = Number(score || 0);
  if (n >= 66) return { variant: 'error', label: 'High risk' };
  if (n >= 33) return { variant: 'warning', label: 'Med risk' };
  return { variant: 'success', label: 'Low risk' };
}

export default function ReputationPage() {
  const [leaderboard, setLeaderboard] = useState<ReputationVector[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [loadError, setLoadError] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch('/api/reputation/leaderboard?limit=50');
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data.leaderboard || []);
      } else {
        setLoadError(true);
      }
    } catch (error) {
      console.error('Failed to fetch reputation leaderboard:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const recomputeAll = useCallback(async () => {
    if (recomputing) return;
    setRecomputing(true);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await fetch('/api/agents');
      const data = res.ok ? await res.json() : { agents: [] };
      const agents = data.agents || [];
      setProgress({ done: 0, total: agents.length });

      for (let i = 0; i < agents.length; i++) {
        const agentId = agents[i].agent_id;
        try {
          await fetch(`/api/reputation/agents/${encodeURIComponent(agentId)}/recompute`, {
            method: 'POST',
          });
        } catch (error) {
          console.error(`Failed to recompute reputation for ${agentId}:`, error);
        }
        setProgress({ done: i + 1, total: agents.length });
      }

      await fetchLeaderboard();
    } catch (error) {
      console.error('Failed to recompute reputation:', error);
    } finally {
      setRecomputing(false);
    }
  }, [recomputing, fetchLeaderboard]);

  const recomputeLabel = recomputing
    ? progress.total > 0
      ? `Recomputing ${progress.done}/${progress.total}`
      : 'Recomputing…'
    : 'Recompute all';

  const recomputeButton = (
    <button
      onClick={recomputeAll}
      disabled={recomputing}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RotateCw size={14} className={recomputing ? 'animate-spin' : ''} />
      {recomputeLabel}
    </button>
  );

  return (
    <PageLayout agentFilter={false}
      maturity="experimental"
      title="Reputation"
      subtitle="Reliability ranking across governed agents, from signed reputation snapshots"
      breadcrumbs={['Observe', 'Reputation']}
      actions={recomputeButton}
    >
      <Card hover={false}>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6">
              <ListSkeleton rows={6} />
            </div>
          ) : loadError ? (
            <div className="p-8">
              <EmptyState
                icon={Award}
                title="Couldn't load the leaderboard"
                description="The reputation request failed. Recompute snapshots to rebuild and retry."
                action={recomputeButton}
              />
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Award}
                title="No reputation snapshots yet"
                description="Reputation is computed on demand from each agent's governed action history. Run a recompute to build snapshots for every agent and populate the leaderboard."
                action={recomputeButton}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                    <th className="px-6 py-4">Rank</th>
                    <th className="px-6 py-4">Agent</th>
                    <th className="px-6 py-4">Reliability</th>
                    <th className="px-6 py-4">Completion</th>
                    <th className="px-6 py-4">Confidence</th>
                    <th className="px-6 py-4 text-right">Events</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leaderboard.map((vector, i) => {
                    const reliability = Number(vector.reliability_score || 0);
                    const risk = riskBadge(vector.risk_score);
                    return (
                      <tr key={vector.agent_id} className="transition-colors hover:bg-white/[0.02]">
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold tabular-nums text-tertiary">
                            #{i + 1}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/agents/${encodeURIComponent(vector.agent_id)}`}
                              className="truncate text-sm font-medium text-white transition-colors hover:text-brand"
                            >
                              {vector.agent_id}
                            </Link>
                            <Badge variant={risk.variant} size="xs">{risk.label}</Badge>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <ProgressBar
                              value={reliability * 100}
                              color={reliabilityColor(reliability)}
                              className="w-24"
                            />
                            <span className="text-sm font-medium tabular-nums text-white">
                              {pct(reliability)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm tabular-nums text-secondary">
                            {pct(vector.completion_rate)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm tabular-nums text-secondary">
                            {pct(vector.confidence)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-sm tabular-nums text-secondary">
                            {Number(vector.total_events || 0)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}
