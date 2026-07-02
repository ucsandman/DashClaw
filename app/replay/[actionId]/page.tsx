'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ShieldCheck, ShieldAlert, Zap, Clock, Info, ExternalLink,
  ChevronRight, ArrowRight, Code, Copy, Check, X
} from 'lucide-react';
import { formatCost, formatTokens } from '../../lib/formatCost';
import { Badge } from '../../components/ui/Badge';
import { Card, CardContent } from '../../components/ui/Card';
import CommunicationTrail from '../../components/CommunicationTrail';
import { AgentDefenseBadges } from '../../components/AgentDefenseCard';
import type { AgentDefense } from '../../lib/agent-defense';

interface DashClawLogoProps {
  size?: number;
  className?: string;
}

// Shared components for the replay story
const DashClawLogo = ({ size = 20, className = "" }: DashClawLogoProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M12 2L4 5V11C4 16.55 7.41 21.74 12 23C16.59 21.74 20 16.55 20 11V5L12 2Z" fill="#F43F5E" fillOpacity="0.2" stroke="#F43F5E" strokeWidth="2" />
    <path d="M9 12L11 14L15 10" stroke="#F43F5E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

interface ActionData {
  action_id: string;
  declared_goal: string;
  action_type: string;
  status: string;
  risk_score: number | string | null;
  reasoning: string | null;
  agent_name: string;
  agent_id: string;
  timestamp_start: string;
  verified: boolean;
  duration_ms: number | null;
  output_summary: string | null;
  cost_estimate: number;
  tokens_in: number;
  tokens_out: number;
}

interface GuardDecision {
  decision?: string;
  action_type?: string;
  created_at?: string;
  reason?: string;
  reasons?: string[];
}

export default function PublicReplayPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const actionId = params.actionId;
  const isEmbed = searchParams.get('embed') === '1';

  const [action, setAction] = useState<ActionData | null>(null);
  const [guardDecision, setGuardDecision] = useState<GuardDecision | null>(null);
  const [defense, setDefense] = useState<AgentDefense | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/actions/${actionId}`);
      if (!res.ok) {
        if (res.status === 404) { setError('Decision not found'); return; }
        throw new Error('Failed to fetch');
      }
      const data = await res.json();

      setAction({
        action_id: data.action.action_id,
        declared_goal: data.action.declared_goal,
        action_type: data.action.action_type,
        status: data.action.status,
        risk_score: data.action.risk_score,
        reasoning: data.action.reasoning,
        agent_name: data.action.agent_name || data.action.agent_id,
        agent_id: data.action.agent_id,
        timestamp_start: data.action.timestamp_start,
        verified: data.action.verified,
        duration_ms: data.action.duration_ms,
        output_summary: data.action.output_summary,
        cost_estimate: data.action.cost_estimate,
        tokens_in: data.action.tokens_in,
        tokens_out: data.action.tokens_out,
      });

      setDefense(data.agent_defense || null);
      // Exact FK-linked guard decision — supersedes the legacy time-window
      // correlation below (kept only for rows without guard_decision_id).
      if (data.guard_decision) setGuardDecision(data.guard_decision);

      if (data.action.agent_id && !data.guard_decision) {
        try {
          const guardRes = await fetch(`/api/guard?agent_id=${encodeURIComponent(data.action.agent_id)}&limit=10`);
          if (guardRes.ok) {
            const guardData = await guardRes.json();
            const actionStart = new Date(data.action.timestamp_start).getTime();
            const match = (guardData.decisions || []).find((gd: GuardDecision) =>
              gd.action_type === data.action.action_type &&
              Math.abs(new Date(gd.created_at ?? '').getTime() - actionStart) <= 60000
            );
            if (match) setGuardDecision(match);
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('Failed to fetch:', err);
      setError('Could not load this decision replay.');
    } finally {
      setLoading(false);
    }
  }, [actionId]);

  useEffect(() => {
    if (actionId) fetchData();
  }, [actionId, fetchData]);

  const copyEmbed = () => {
    const url = `${window.location.origin}/replay/${actionId}?embed=1`;
    const code = `<iframe src="${url}" width="100%" height="400" frameborder="0" style="border:1px solid rgba(255,255,255,0.1); border-radius:12px;"></iframe>`;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-primary flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !action) {
    return (
      <div className="min-h-screen bg-surface-primary flex flex-col items-center justify-center p-6">
        <DashClawLogo size={48} className="mb-8 opacity-20" />
        <div className="text-tertiary font-medium text-center">{error || 'Replay unavailable'}</div>
        <Link href="/" className="mt-6 text-brand text-sm hover:underline">Back to DashClaw</Link>
      </div>
    );
  }

  const isSuccess = action.status === 'completed';
  const riskScore = parseInt(String(action.risk_score || 0), 10);

  // High-fidelity decision inference if correlation is missing in demo/edge cases
  const decisionType = guardDecision?.decision || (
    (action.status === 'failed' || action.status === 'blocked') && riskScore >= 70 ? 'block' :
    action.status === 'pending' && riskScore >= 60 ? 'require_approval' :
    'allow'
  );

  const getResultText = () => {
    if (isSuccess) return 'Action Successful';
    if (decisionType === 'block') return 'Action Prevented';
    if (decisionType === 'require_approval') return 'Approval Required';
    return 'Action Failed';
  };

  const getResultSummary = () => {
    if (action.output_summary) return action.output_summary;
    if (isSuccess) return 'No policy violations detected. Decision chain verified.';
    if (decisionType === 'block') return 'Governance runtime successfully intercepted high-risk intent.';
    if (decisionType === 'require_approval') return 'Action paused. Awaiting human operator intervention.';
    return 'Action failed during execution. See execution trace for details.';
  };

  // ─── Render ───
  return (
    <div className={`min-h-screen ${isEmbed ? 'bg-transparent' : 'bg-surface-primary'} flex flex-col items-center selection:bg-brand/30`}>

      {!isEmbed && (
        <nav className="w-full border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DashClawLogo size={20} />
              <span className="text-sm font-bold text-white tracking-tight">DASHCLAW REPLAY</span>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={copyEmbed}
                className="flex items-center gap-1.5 text-[10px] font-bold text-tertiary hover:text-white transition-colors uppercase tracking-widest"
              >
                {copied ? <Check size={12} className="text-success" /> : <Code size={12} />}
                {copied ? 'Copied!' : 'Copy Embed'}
              </button>
              <Link href="/" className="text-[10px] font-bold text-brand hover:text-brand-hover transition-colors uppercase tracking-widest">
                Try DashClaw
              </Link>
            </div>
          </div>
        </nav>
      )}

      <main className={`w-full max-w-2xl px-4 ${isEmbed ? 'py-4' : 'py-12 md:py-20'}`}>

        {/* THE STORY CARD - CONCISE & SCREENSHOT FRIENDLY */}
        <div className="relative group/story">
          {/* Subtle Glow */}
          <div className="absolute -inset-0.5 bg-gradient-to-b from-brand/20 to-transparent rounded-2xl blur opacity-20 group-hover/story:opacity-30 transition-opacity" />

          <div className="relative bg-surface-secondary border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl">

            {/* Header / ID */}
            <div className="px-6 py-4 border-b border-white/[0.04] flex items-center justify-between bg-white/[0.01]">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-disabled tracking-tight">{action.action_id}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {action.verified ? (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-success/80 uppercase tracking-widest">
                    <ShieldCheck size={10} /> Verified Identity
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[9px] font-bold text-disabled uppercase tracking-widest">
                    <Info size={10} /> Unsigned
                  </div>
                )}
              </div>
            </div>

            <div className="p-8 space-y-10 relative">
              {/* Connector Line */}
              <div className="absolute left-[47px] top-12 bottom-12 w-px bg-gradient-to-b from-blue-500/50 via-emerald-500/50 to-emerald-500/50 opacity-20" />

              {/* 1. THE INTENT */}
              <div className="relative flex gap-6">
                <div className="z-10 h-10 w-10 shrink-0 rounded-xl bg-info-subtle border border-blue-500/20 flex items-center justify-center text-info shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                  <Zap size={20} className="fill-blue-400/20" />
                </div>
                <div>
                  <div className="text-[10px] font-black text-disabled uppercase tracking-[0.2em] mb-1">Agent Intent</div>
                  <h1 className="text-xl font-bold text-white leading-tight mb-2">{action.declared_goal}</h1>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-tertiary font-medium">Agent:</span>
                    <Link
                      href={`/agents/${action.agent_id}`}
                      target={isEmbed ? "_blank" : "_self"}
                      className="px-1.5 py-0.5 rounded bg-tertiary text-[10px] font-bold text-secondary uppercase tracking-wider hover:bg-elevated hover:text-white transition-colors cursor-pointer"
                    >
                      {action.agent_name}
                    </Link>
                  </div>
                </div>
              </div>

              {/* 2. THE GOVERNANCE */}
              <Link
                href={`/decisions/${actionId}`}
                target={isEmbed ? "_blank" : "_self"}
                className="relative flex gap-6 group/decision cursor-pointer"
              >
                <div className={`z-10 h-10 w-10 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.05)] transition-all group-hover/decision:scale-105 group-hover/decision:border-white/20 ${
                  decisionType === 'block' ? 'text-error border-error/30 bg-error-subtle' :
                  decisionType === 'require_approval' ? 'text-warning border-warning/30 bg-warning-subtle' :
                  'text-success border-success/30 bg-success-subtle'
                }`}>
                  {decisionType === 'block' ? <ShieldAlert size={20} /> : <ShieldCheck size={20} />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-[10px] font-black text-disabled uppercase tracking-[0.2em]">Governance Decision</div>
                    <div className="h-px flex-1 bg-white/5" />
                    <div className="flex items-center gap-1 text-[8px] font-bold text-tertiary uppercase tracking-widest opacity-0 group-hover/decision:opacity-100 transition-opacity">
                      View Details <ExternalLink size={8} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-black tracking-tighter transition-transform group-hover/decision:translate-x-0.5 ${
                      decisionType === 'block' ? 'text-error' :
                      decisionType === 'require_approval' ? 'text-warning' :
                      'text-success'
                    }`}>
                      {decisionType.toUpperCase()}
                    </span>
                    <div className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-tertiary uppercase">
                      Risk: {action.risk_score || 0}
                    </div>
                  </div>
                  {(guardDecision?.reason ?? guardDecision?.reasons?.[0]) && (
                    <p className="mt-3 text-sm text-secondary italic border-l-2 border-white/5 pl-3 leading-relaxed group-hover/decision:text-secondary transition-colors">
                      &ldquo;{guardDecision?.reason ?? guardDecision?.reasons?.[0]}&rdquo;
                    </p>
                  )}
                  {defense && (
                    <div className="mt-3">
                      <AgentDefenseBadges defense={defense} />
                    </div>
                  )}
                </div>
              </Link>

              {/* Communication Trail */}
              <CommunicationTrail actionId={action.action_id} actingAgentId={action.agent_id} />

              {/* 3. THE OUTCOME */}
              <div className="relative flex gap-6">
                <div className={`z-10 h-10 w-10 shrink-0 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center ${isSuccess ? 'text-success' : 'text-error'}`}>
                  {isSuccess ? <Check size={20} /> : (decisionType === 'block' ? <ShieldAlert size={20} /> : <X size={20} />)}
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-black text-disabled uppercase tracking-[0.2em] mb-1">Final Result</div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-lg font-bold tracking-tight ${isSuccess ? 'text-success' : 'text-error'} uppercase`}>
                      {getResultText()}
                    </span>
                    {action.duration_ms && (
                      <span className="text-xs text-disabled font-mono">in {(action.duration_ms/1000).toFixed(2)}s</span>
                    )}
                    {action.cost_estimate > 0 && (
                      <span className="text-xs text-disabled font-mono">
                        | {formatCost(action.cost_estimate)}
                        {(action.tokens_in > 0 || action.tokens_out > 0) && (
                          <> | {formatTokens(action.tokens_in)} in / {formatTokens(action.tokens_out)} out</>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-secondary font-mono bg-black/40 p-3 rounded-lg border border-white/5 leading-relaxed">
                    {getResultSummary()}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer / Branding */}
            <div className="px-6 py-4 border-t border-white/[0.04] bg-white/[0.01] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DashClawLogo size={14} className="grayscale opacity-50" />
                <span className="text-[9px] font-bold text-disabled uppercase tracking-[0.2em]">Verified by DashClaw Runtime</span>
              </div>
              <div className="text-[9px] font-mono text-zinc-700 uppercase tracking-tighter">
                {new Date(action.timestamp_start).toLocaleDateString()} {new Date(action.timestamp_start).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>

        {/* Action Bar */}
        {!isEmbed && (
          <div className="mt-8 flex flex-col items-center gap-6">
            <div className="flex items-center gap-3">
              <Link
                href="/mission-control"
                className="px-6 py-3 bg-white text-black font-black text-xs uppercase tracking-widest rounded-xl hover:bg-zinc-200 transition-all flex items-center gap-2 shadow-lg"
              >
                Launch Console <ArrowRight size={14} />
              </Link>
              <button
                onClick={copyEmbed}
                className="px-6 py-3 bg-secondary text-secondary border border-white/10 font-black text-xs uppercase tracking-widest rounded-xl hover:text-white hover:border-white/20 transition-all flex items-center gap-2"
              >
                <Code size={14} /> {copied ? 'Code Copied' : 'Embed Replay'}
              </button>
            </div>

            <p className="text-[10px] text-disabled font-medium uppercase tracking-[0.2em] max-w-sm text-center leading-relaxed">
              DashClaw is the decision infrastructure for AI agents. Governed by Practical Systems.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
