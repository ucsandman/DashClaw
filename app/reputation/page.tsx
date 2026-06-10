'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { Award, RotateCw, ChevronDown, ChevronUp } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { ProgressBar } from '../components/ui/ProgressBar';
import { riskBand } from '../lib/riskThresholds';

interface ReputationVector {
  agent_id: string;
  reliability_score?: number | string | null;
  risk_score?: number | string | null;
  completion_rate?: number | string | null;
  confidence?: number | string | null;
  total_events?: number | string;
  breakdown?: any;
}

// One-decimal floor: "100%" only for a literally perfect smoothed score (the
// Bayesian prior makes that impossible), so saturated agents read 99.x% and
// stay rankable. Null/undefined renders an em dash, not a fake "0%".
function pct(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${Math.floor(Math.min(1, Math.max(0, n)) * 1000) / 10}%`;
}

function reliabilityColor(score: number | string | null | undefined): string {
  const n = Number(score || 0);
  if (n >= 0.85) return 'success';
  if (n >= 0.6) return 'brand';
  if (n >= 0.4) return 'warning';
  return 'error';
}

// risk_score is a 0-100 integer (app/lib/reputation.ts computeRiskScore), not a
// 0..1 fraction like the other vector scores. Bands come from the shared
// module so /reputation, /swarm, and /security agree.
const RISK_BADGE = {
  high: { variant: 'error', label: 'High risk' },
  medium: { variant: 'warning', label: 'Med risk' },
  low: { variant: 'success', label: 'Low risk' },
} as const;

const DIMENSION_LABELS: Record<string, string> = {
  outcome: 'Completion',
  approval: 'Approval adherence',
  policy_violation: 'Policy violations',
  quality: 'Quality',
  risk: 'Risk (separate)',
};

export default function ReputationPage() {
  const [leaderboard, setLeaderboard] = useState<ReputationVector[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
                    const risk = RISK_BADGE[riskBand(Number(vector.risk_score) || 0)];
                    const isOpen = !!expanded[vector.agent_id];
                    return (
                      <Fragment key={vector.agent_id}>
                      <tr className="transition-colors hover:bg-white/[0.02]">
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
                              {pct(vector.reliability_score)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setExpanded((prev) => ({ ...prev, [vector.agent_id]: !prev[vector.agent_id] }))}
                              className="rounded p-0.5 text-tertiary transition-colors hover:text-white"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Hide' : 'Show'} reliability derivation for ${vector.agent_id}`}
                            >
                              {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
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
                      {isOpen && (
                        <tr className="bg-white/[0.015]">
                          <td colSpan={6} className="px-6 py-4">
                            {vector.breakdown?.dimensions ? (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-5">
                                  {vector.breakdown.dimensions.map((d: any) => (
                                    <div key={d.key}>
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">{DIMENSION_LABELS[d.key] || d.key}</div>
                                      <div className="font-mono tabular-nums text-secondary">
                                        {d.key === 'risk' ? Math.round(Number(d.smoothed)) : Number(d.smoothed).toFixed(3)}
                                        <span className="text-tertiary"> · {d.event_count} ev</span>
                                        {d.contribution != null && <span className="text-tertiary"> · w {Number(vector.breakdown.normalized_weights?.[d.key] ?? 0).toFixed(2)}</span>}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <p className="text-[11px] text-tertiary">
                                  Weighted blend over evidence-bearing dimensions · unrounded {Number(vector.breakdown.reliability_unrounded).toFixed(4)} · decay half-life {vector.breakdown.half_life_days}d. {vector.breakdown.note}
                                </p>
                              </div>
                            ) : (
                              <p className="text-xs text-tertiary">No derivation stored for this snapshot — recompute to generate the breakdown.</p>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
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
