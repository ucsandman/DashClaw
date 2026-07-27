'use client';

import { CheckCircle2, XCircle, HelpCircle, ShieldAlert, Activity } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { OutcomeBadge } from '../../../components/OutcomeBadge';
import { parseJsonArray } from '../../../lib/parseJson';
import { getStatusVariant } from './helpers';

interface CausalTimelineProps {
  action: any;
  guardDecision: any;
  assumptions: any[];
  trace: any;
}

export default function CausalTimeline({ action, guardDecision, assumptions, trace }: CausalTimelineProps) {
  return (
    <Card hover={false}>
      <CardHeader title="Causal Timeline" icon={Activity} />
      <CardContent>
        <div className="space-y-6 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-white/5">
          {/* 1. Goal */}
          <div className="relative flex gap-4 pl-1">
            <div className="z-10 mt-1 h-4 w-4 rounded-full bg-status-info border-4 border-surface-secondary shadow-[0_0_0_1px_rgba(59,130,246,0.3)]" />
            <div>
              <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Goal Declared</div>
              <div className="text-sm text-white font-medium">{action.declared_goal}</div>
              {action.reasoning && (
                <div className="mt-2 text-xs text-tertiary bg-white/5 p-2 rounded italic">
                  &ldquo;{action.reasoning}&rdquo;
                </div>
              )}
            </div>
          </div>

          {/* 2. Policy Evaluation */}
          <div className="relative flex gap-4 pl-1">
            <div className={`z-10 mt-1 h-4 w-4 rounded-full border-4 border-surface-secondary shadow-[0_0_0_1px_var(--color-border)] ${
              guardDecision?.decision === 'allow' ? 'bg-status-success' :
              guardDecision?.decision === 'block' ? 'bg-status-error' :
              guardDecision?.decision === 'require_approval' ? 'bg-status-warning' :
              guardDecision?.decision === 'allow_contained' ? 'bg-status-info' : 'bg-zinc-500'
            }`} />
            <div className="flex-1">
              <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Policy Evaluation</div>
              {guardDecision ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={getStatusVariant(
                      guardDecision.decision === 'allow' ? 'completed' :
                      guardDecision.decision === 'block' ? 'failed' :
                      guardDecision.decision === 'allow_contained' ? 'pending' : 'running'
                    )} size="xs">
                      {guardDecision.decision.toUpperCase()}
                    </Badge>
                    {guardDecision.reason && <span className="text-xs text-secondary">{guardDecision.reason}</span>}
                  </div>
                  {parseJsonArray(guardDecision.matched_policies).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {parseJsonArray(guardDecision.matched_policies).map((p: any, i: number) => (
                        <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-secondary border border-white/10">
                          {typeof p === 'string' ? p : p.name || p.id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-tertiary italic">No guard evaluation recorded for this decision.</div>
              )}
            </div>
          </div>

          {/* 3. Assumption Check */}
          {assumptions.length > 0 && (
            <div className="relative flex gap-4 pl-1">
              <div className={`z-10 mt-1 h-4 w-4 rounded-full border-4 border-surface-secondary shadow-[0_0_0_1px_var(--color-border)] ${
                assumptions.every(a => a.validated) ? 'bg-status-success' :
                assumptions.some(a => a.invalidated) ? 'bg-status-error' : 'bg-status-warning'
              }`} />
              <div>
                <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Assumption Check</div>
                <div className="space-y-2 mt-2">
                  {assumptions.map((asm, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {asm.validated ? <CheckCircle2 size={12} className="text-success" /> :
                       asm.invalidated ? <XCircle size={12} className="text-error" /> :
                       <HelpCircle size={12} className="text-warning" />}
                      <span className={asm.invalidated ? 'text-error' : 'text-secondary'}>{asm.assumption}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4. Risk Signals */}
          {trace?.root_cause_indicators?.length > 0 && (
            <div className="relative flex gap-4 pl-1">
              <div className="z-10 mt-1 h-4 w-4 rounded-full bg-status-warning border-4 border-surface-secondary shadow-[0_0_0_1px_rgba(245,158,11,0.3)]" />
              <div>
                <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Risk Signals</div>
                <div className="space-y-1.5 mt-2">
                  {trace.root_cause_indicators.map((sig: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-warning">
                      <ShieldAlert size={12} />
                      <span>{sig.type.replace(/_/g, ' ')} detected ({sig.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 5. Final Decision */}
          <div className="relative flex gap-4 pl-1">
            <div className={`z-10 mt-1 h-4 w-4 rounded-full border-4 border-surface-secondary shadow-[0_0_0_1px_var(--color-border)] ${getStatusVariant(action.status) === 'success' ? 'bg-status-success' : 'bg-status-error'}`} />
            <div>
              <div className="text-[10px] font-semibold text-disabled uppercase tracking-widest mb-1">Final Outcome</div>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold tracking-tight ${getStatusVariant(action.status) === 'success' ? 'text-success' : 'text-error'}`}>
                  {action.status.toUpperCase()}
                </span>
                {action.outcome_status && (
                  <OutcomeBadge status={action.outcome_status} size="sm" />
                )}
                {action.duration_ms && <span className="text-xs text-tertiary">in {(action.duration_ms / 1000).toFixed(2)}s</span>}
              </div>
              {(action.outcome_summary || action.outcome_error) && (
                <div className="mt-2 text-xs text-tertiary">
                  {action.outcome_status === 'failed' && action.outcome_error
                    ? `Reported failure: ${action.outcome_error}`
                    : action.outcome_status === 'lost_confirmation'
                      ? 'No outcome reported within timeout window (system sweep)'
                      : action.outcome_summary}
                </div>
              )}
              {action.output_summary && (
                <div className="mt-2 text-sm text-secondary bg-surface-tertiary p-3 rounded-lg border border-white/5">
                  {action.output_summary}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
