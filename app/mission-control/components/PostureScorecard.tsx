'use client';

import Link from 'next/link';
import {
  TrendingUp, TrendingDown, AlertTriangle, ShieldAlert, ShieldCheck,
  Wrench, Plug, Repeat, Inbox, Radio,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import AgentSpendCard from '../../components/AgentSpendCard';
import { CategoryStatusRow, type StatusLevel } from './CategoryStatusRow';
import { RuntimeVitals } from './RuntimeVitals';
import { categoryCount } from '../lib/missionHelpers';

interface PostureScorecardProps {
  agentId: any;
  decisionMetrics: any;
  pendingActions: any[];
  signalCounts: { red: number; amber: number; total: number };
  capabilityHealth: any[];
  // Optional: mission-control/page.tsx must destructure these two fields from
  // useMissionData() and pass them through for the tile to show live data —
  // until then the component degrades to its own "checking"/warn default
  // rather than typecheck-breaking the page.
  enforcementLiveness?: { state: 'holding' | 'stale' | 'broken' | null; latest: any };
  enforcementLivenessError?: string | null;
  feedItems: any[];
  summary: any;
  sortedAgents: any[];
  criticalAgentIds: Set<any>;
  failedAgentIds: Set<any>;
  agentColor: (id: any) => string;
  activeCategory: string | null;
  onToggleCategory: (cat: string) => void;
}

export function PostureScorecard(props: PostureScorecardProps) {
  const {
    agentId, decisionMetrics, pendingActions, signalCounts, capabilityHealth,
    enforcementLiveness, enforcementLivenessError, feedItems,
    summary, sortedAgents, criticalAgentIds, failedAgentIds, activeCategory, onToggleCategory,
  } = props;

  const failures = categoryCount(feedItems, agentId, (i) => i.category === 'failure');
  const stale = categoryCount(feedItems, agentId, (i) => i.category === 'stale');
  const integrationDown = feedItems.filter((i) => i.source === 'integration').length;
  // Use the DERIVED status (deriveStatus → /api/capabilities/health), mirroring the
  // Capabilities page: only failing/degraded are unhealthy. Never-invoked capabilities are
  // 'untested' (neutral) — counting them as unhealthy (the old raw `health_status !== 'healthy'`)
  // raised a false WARN for capabilities the rest of the app calls merely untested.
  const capStatus = (c: any) => c.status || c.health_status;
  const capUnhealthy = capabilityHealth.filter((c: any) => ['unhealthy', 'degraded', 'failing'].includes(capStatus(c))).length;
  const capUntested = capabilityHealth.filter((c: any) => capStatus(c) === 'untested' || capStatus(c) === 'unknown').length;
  const capHealthy = capabilityHealth.filter((c: any) => capStatus(c) === 'healthy').length;
  const capTotal = capabilityHealth.length;

  // v8.2 enforcement-liveness: a missing/failed fetch is left as null state and
  // must never render as 'ok' — a silent probe is the exact v4.72.1 failure // version-hardcode-allowed
  // shape this tile exists to catch, so "we don't know yet" reads as a warning.
  const livenessState = enforcementLiveness?.state ?? null;
  const livenessLevel: StatusLevel =
    livenessState === 'holding' ? 'ok' : livenessState === 'broken' ? 'critical' : 'warn';
  const livenessWord = enforcementLivenessError
    ? 'unavailable'
    : livenessState === 'holding' || livenessState === 'stale' || livenessState === 'broken'
      ? livenessState
      : 'checking';

  const rows: {
    key: string; icon: any; label: string; statusWord: string; level: StatusLevel; count: number; href: string;
  }[] = [
    {
      key: 'approval', icon: Inbox, label: 'Pending Approvals', count: pendingActions.length, href: '/approvals',
      level: pendingActions.length > 0 ? 'warn' : 'ok', statusWord: pendingActions.length > 0 ? 'pending' : 'clear',
    },
    {
      key: 'failure', icon: AlertTriangle, label: 'Failures · 24h', count: failures, href: '/decisions?status=failed',
      level: failures > 0 ? 'critical' : 'ok', statusWord: failures > 0 ? 'failing' : 'clear',
    },
    {
      key: 'signal', icon: ShieldAlert, label: 'Risk Signals', count: signalCounts.total, href: '/security',
      level: signalCounts.red > 0 ? 'critical' : signalCounts.amber > 0 ? 'warn' : 'ok',
      statusWord: signalCounts.red > 0 ? `${signalCounts.red} critical` : signalCounts.amber > 0 ? `${signalCounts.amber} elevated` : 'clear',
    },
    {
      key: 'health', icon: Wrench, label: 'Capability Health', count: capUnhealthy, href: '/capabilities',
      level: capUnhealthy > 0 ? 'warn' : 'ok',
      statusWord: capUnhealthy > 0
        ? `${capUnhealthy} unhealthy`
        : capUntested > 0
          ? `${capUntested} untested`
          : capTotal > 0 ? `${capHealthy}/${capTotal} healthy` : 'none',
    },
    {
      key: 'health', icon: Plug, label: 'Integration Health', count: integrationDown, href: '/integrations',
      level: integrationDown > 0 ? 'warn' : 'ok', statusWord: integrationDown > 0 ? `${integrationDown} degraded` : 'clear',
    },
    {
      key: 'stale', icon: Repeat, label: 'Stale Loops · 48h', count: stale, href: '/dashboard',
      level: stale > 0 ? 'warn' : 'ok', statusWord: stale > 0 ? `${stale} stale` : 'clear',
    },
    {
      key: 'enforcement-liveness', icon: Radio, label: 'Enforcement Liveness',
      count: livenessLevel === 'ok' ? 0 : 1, href: '/setup#enforcement-liveness',
      level: livenessLevel, statusWord: livenessWord,
    },
  ];

  const changePct = decisionMetrics?.change_percent ?? 0;

  return (
    <div className="lg:col-span-5 lg:sticky lg:top-4 self-start">
      <Card hover={false}>
        <div className="space-y-4 p-5">
          {/* Posture headline */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Decisions · 24h</div>
            <div className="mt-1 flex items-baseline gap-2">
              <div className="text-3xl font-semibold tabular-nums text-white">{decisionMetrics?.total ?? '—'}</div>
              {decisionMetrics && (
                <div className={`flex items-center gap-0.5 text-xs font-medium tabular-nums ${changePct >= 0 ? 'text-success' : 'text-error'}`}>
                  {changePct >= 0 ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />}
                  {changePct >= 0 ? '+' : ''}{changePct}%
                </div>
              )}
            </div>
          </div>

          {/* Six governance-category status rows (also filter the live ledger) */}
          <div className="border-t border-border pt-3">
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary">Governance categories</div>
            <div className="space-y-0.5">
              {rows.map((r, idx) => (
                <CategoryStatusRow
                  key={`${r.key}-${idx}`}
                  icon={r.icon}
                  label={r.label}
                  statusWord={r.statusWord}
                  level={r.level}
                  count={r.count}
                  href={r.href}
                  active={activeCategory === r.key}
                  onToggle={() => onToggleCategory(r.key)}
                />
              ))}
            </div>
          </div>

          {/* Runtime vitals */}
          <div className="border-t border-border pt-4">
            <RuntimeVitals data={summary} />
          </div>

          {/* Fleet mini */}
          <div className="border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Fleet Status</span>
              <Link href="/agents" className="text-[11px] font-medium text-brand transition-colors hover:text-brand-hover">Manage</Link>
            </div>
            {sortedAgents.length === 0 ? (
              <div className="text-sm text-tertiary">No agents connected</div>
            ) : (
              <div className="space-y-1.5">
                {sortedAgents.slice(0, 5).map((agent: any) => {
                  const isCritical = criticalAgentIds.has(agent.agent_id);
                  const isDegraded = isCritical || failedAgentIds.has(agent.agent_id) || agent.status === 'degraded' || agent.status === 'blocked';
                  return (
                    <Link
                      key={agent.agent_id}
                      href={`/agents/${encodeURIComponent(agent.agent_id)}`}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5"
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isDegraded ? 'bg-status-warning' : 'bg-status-success/50'}`} aria-hidden="true" />
                      <span className={`flex-1 truncate text-xs ${isDegraded ? 'text-warning' : 'text-secondary'}`}>
                        {isDegraded ? 'Degraded · ' : ''}{agent.name || agent.agent_id}
                      </span>
                      {isCritical && <AlertTriangle size={10} className="shrink-0 text-error" aria-hidden="true" />}
                      {!isDegraded && <ShieldCheck size={10} className="shrink-0 text-success/50" aria-hidden="true" />}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agent spend */}
          <div className="border-t border-border pt-4">
            <AgentSpendCard agentId={agentId} />
          </div>
        </div>
      </Card>
    </div>
  );
}
