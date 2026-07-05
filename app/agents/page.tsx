'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Users, ShieldCheck, ShieldAlert,
  Search, Filter, RotateCw, ChevronRight, Brain,
  CheckCircle2, XCircle, Info, Lock, Copy,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { groupFleetByParent, subAgentSegment } from '../lib/agent-identity-resolve';

const statusDotMap: Record<string, string> = {
  active: 'bg-status-success',
  online: 'bg-status-success',
  busy: 'bg-brand',
  idle: 'bg-zinc-400',
  critical: 'bg-status-error',
  error: 'bg-status-error',
  degraded: 'bg-status-warning',
  stale: 'bg-status-warning',
  offline: 'bg-zinc-600',
  unknown: 'bg-zinc-500',
};

export default function AgentsFleetPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const filteredAgents = agents.filter(agent => {
    // /api/agents returns agent_name (not name) — searching agent.name never matched.
    const matchesSearch = agent.agent_id.toLowerCase().includes(search.toLowerCase()) ||
      (agent.agent_name && agent.agent_name.toLowerCase().includes(search.toLowerCase()));

    if (filterStatus === 'all') return matchesSearch;
    if (filterStatus === 'online') return matchesSearch && (agent.status === 'active' || agent.status === 'online');
    if (filterStatus === 'critical') return matchesSearch && (agent.status === 'critical' || agent.status === 'error');
    if (filterStatus === 'offline') return matchesSearch && (agent.status === 'offline');

    return matchesSearch;
  });

  const selection = useSelection<any>(filteredAgents, (a) => a.agent_id);
  useSelectAllHotkey(selection.toggleAll);

  // Composed sub-agent ids (<parent>:<type>, e.g. claude-code:explore) render
  // indented under their parent — presentational only; every row stays a
  // full fleet identity (RFC 2026-06-01 rollout step 3).
  const groupedAgents = groupFleetByParent(filteredAgents, (a) => a.agent_id);

  const stats = {
    total: agents.length,
    active: agents.filter(a => a.status === 'active' || a.status === 'online').length,
    critical: agents.filter(a => a.status === 'critical' || a.status === 'error').length,
    // Every fleet agent is governed by construction: the fleet list is DERIVED
    // from governed telemetry (action_records/goals/presence). The old
    // `a.governed` field never existed in the payload, so the fallback always
    // fired — same number, but now stated honestly.
    governed: agents.length,
  };

  const statRail = [
    { label: 'Total', value: stats.total, color: 'text-white' },
    { label: 'Online', value: stats.active, color: 'text-success' },
    { label: 'Critical', value: stats.critical, color: stats.critical > 0 ? 'text-error' : 'text-secondary' },
    { label: 'Governed', value: stats.governed, color: 'text-white' },
  ];

  return (
    <PageLayout agentFilter={false}
      maturity="stable"
      title="Agent Fleet"
      subtitle="Fleet-wide observability and permission governance"
      breadcrumbs={['Command', 'Agents']}
      actions={
        <>
          <BulkActionBar
            count={selection.count}
            actions={[{
              id: 'copy',
              label: 'Copy IDs',
              icon: Copy,
              onClick: () => { navigator.clipboard?.writeText(selection.selectedIds.join('\n')); },
            }]}
            onClear={selection.clear}
          />
          <button
            onClick={() => { setLoading(true); fetchAgents(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <RotateCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </>
      }
    >
      {/* Stats rail */}
      <div className="mb-6 overflow-hidden rounded-xl border border-border bg-surface-tertiary">
        <div className="grid grid-cols-2 divide-x divide-border md:grid-cols-4">
          {statRail.map((stat, i) => (
            <div
              key={stat.label}
              className={`px-5 py-4 ${i >= 2 ? 'border-t border-border md:border-t-0' : ''}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                {stat.label}
              </div>
              <div className={`mt-1 text-3xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="relative mb-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" size={16} />
          <input
            type="text"
            placeholder="Search agents by ID or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-secondary py-2 pl-10 pr-4 text-sm text-white transition-colors focus:border-brand/40 focus:outline-none"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            showFilters || filterStatus !== 'all'
              ? 'border-brand/30 bg-brand/10 text-brand hover:border-brand/40'
              : 'border-border bg-surface-secondary text-secondary hover:border-border-hover hover:text-white'
          }`}
        >
          <Filter size={14} />
          {filterStatus === 'all' ? 'Filter' : <span className="capitalize">Status · {filterStatus}</span>}
        </button>

        {showFilters && (
          <div className="absolute right-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-border bg-surface-secondary py-1 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_20px_60px_rgba(0,0,0,0.45)]">
            {[
              { id: 'all', label: 'All agents', icon: Users, color: 'text-secondary' },
              { id: 'online', label: 'Online only', icon: CheckCircle2, color: 'text-success' },
              { id: 'critical', label: 'Critical only', icon: ShieldAlert, color: 'text-error' },
              { id: 'offline', label: 'Offline only', icon: XCircle, color: 'text-tertiary' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => { setFilterStatus(f.id); setShowFilters(false); }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-xs font-medium transition-colors hover:bg-white/5 ${
                  filterStatus === f.id ? 'bg-brand/5 text-brand' : 'text-secondary'
                }`}
              >
                <f.icon size={14} className={f.color} />
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Agents Table/List */}
      <Card hover={false}>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-4 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Users}
                title="No agents connected"
                description="Connect your first agent using the DashClaw SDK to see it in the fleet overview."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                    <th className="px-6 py-4 w-8"><SelectCheckbox checked={selection.allSelected} onToggle={() => selection.toggleAll()} label="Select all" /></th>
                    <th className="px-6 py-4">Agent</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Governance</th>
                    <th className="px-6 py-4">Coverage</th>
                    <th className="px-6 py-4">Last Action</th>
                    <th className="px-6 py-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {groupedAgents.map(({ item: agent, depth }) => {
                    const dotColor = statusDotMap[agent.status] || statusDotMap.unknown;
                    const subSegment = depth === 1 ? subAgentSegment(agent.agent_id) : null;
                    return (
                      <tr key={agent.agent_id} data-entity-type="agent" data-entity-id={agent.agent_id} data-entity-status={agent.status} data-entity-depth={depth} className="transition-colors hover:bg-white/[0.02]">
                        <td className="px-3"><SelectCheckbox checked={selection.isSelected(agent.agent_id)} onToggle={(e) => { e.stopPropagation(); selection.selectClick(agent.agent_id, e.shiftKey); }} label="Select row" /></td>
                        <td className="px-6 py-4">
                          <Link href={`/agents/${encodeURIComponent(agent.agent_id)}`} className={`group/name flex items-center gap-3 ${depth === 1 ? 'pl-7' : ''}`}>
                            {depth === 1 && (
                              <span aria-hidden className="select-none text-sm leading-none text-tertiary">└</span>
                            )}
                            <div className={`flex items-center justify-center rounded border border-border bg-white/[0.03] text-secondary ${depth === 1 ? 'h-6 w-6' : 'h-8 w-8'}`}>
                              <Brain size={depth === 1 ? 12 : 16} />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-white transition-colors group-hover/name:text-brand">
                                {subSegment ?? (agent.name || agent.agent_id)}
                              </div>
                              <div className="mt-0.5 text-[11px] text-tertiary">
                                {subSegment
                                  ? `${agent.agent_id}${agent.action_count != null ? ` · ${agent.action_count} decisions` : ''}`
                                  : agent.action_count != null
                                    ? `${agent.action_count} decisions`
                                    : agent.agent_id !== (agent.name || agent.agent_id)
                                      ? agent.agent_id
                                      : 'No activity yet'}
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                            <span className="text-xs capitalize text-secondary">{agent.status || 'unknown'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1.5">
                            {agent.governed !== false ? (
                              <Badge variant="success" size="xs">
                                <ShieldCheck size={10} className="mr-1" />
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="warning" size="xs">
                                <ShieldAlert size={10} className="mr-1" />
                                Passive
                              </Badge>
                            )}
                            {agent.verified ? (
                              <div
                                className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.1em] text-success"
                                title="Agent identity cryptographically verified"
                              >
                                <Lock size={10} /> Verified
                              </div>
                            ) : (
                              <div
                                className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.1em] text-tertiary"
                                title="Agent is using an unsigned session"
                              >
                                <Info size={10} /> Unsigned
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {/* Absence of evidence must render differently from 100% (v4.2 coverage truth) —
                              null/undefined coverage (or an unresolvable record_pct, e.g. 0 expected calls
                              in the window) is an explicit muted state, never a hidden zero. */}
                          {agent.coverage?.record_pct == null ? (
                            <span
                              className="inline-flex items-center rounded border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-tertiary"
                              title="No coverage reports in the last 24h"
                            >
                              No evidence
                            </span>
                          ) : (
                            <span
                              title={
                                agent.coverage.outcome_pct != null
                                  ? `Outcome coverage: ${Math.round(agent.coverage.outcome_pct)}%`
                                  : 'No outcome coverage data'
                              }
                            >
                              <Badge variant={agent.coverage.record_pct >= 90 ? 'success' : 'warning'} size="xs">
                                {Math.round(agent.coverage.record_pct)}%
                              </Badge>
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {agent.last_action_at ? (
                            <div className="flex flex-col text-xs">
                              <span className="text-secondary tabular-nums">{new Date(agent.last_action_at).toLocaleDateString()}</span>
                              <span className="text-[11px] text-tertiary tabular-nums">{new Date(agent.last_action_at).toLocaleTimeString()}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-tertiary">Never</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/agents/${encodeURIComponent(agent.agent_id)}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-colors hover:text-brand-hover"
                          >
                            Inspect <ChevronRight size={14} />
                          </Link>
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
