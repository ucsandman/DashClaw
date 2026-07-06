'use client';

import type { Dispatch, SetStateAction } from 'react';
import { CheckCircle2, XCircle, HelpCircle, Activity } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { computeAssumptionDrift } from './helpers';

interface AssumptionsTabProps {
  assumptions: any[];
  pendingOps: Record<string, any>;
  invalidateReasons: Record<string, string>;
  setInvalidateReasons: Dispatch<SetStateAction<Record<string, string>>>;
  onValidate: (assumptionId: any) => void;
  onInvalidate: (assumptionId: any) => void;
}

export default function AssumptionsTab({
  assumptions, pendingOps, invalidateReasons, setInvalidateReasons, onValidate, onInvalidate
}: AssumptionsTabProps) {
  const drift = computeAssumptionDrift(assumptions);
  return (
    <div className="space-y-6">
      <Card hover={false}>
        <CardHeader title="Decision Basis" icon={HelpCircle} count={assumptions.length} />
        <CardContent>
          {assumptions.length > 0 ? (
            <div className="space-y-4">
              {assumptions.map(asm => {
                const isUnresolved = !asm.validated && !asm.invalidated;
                const isPending = !!pendingOps[asm.assumption_id];
                return (
                  <div key={asm.assumption_id} className="bg-surface-tertiary rounded-lg p-4 border border-white/5">
                    <div className="flex items-start space-x-3">
                      <span className="mt-1">
                        {asm.validated
                          ? <CheckCircle2 size={18} className="text-success" />
                          : asm.invalidated
                            ? <XCircle size={18} className="text-error" />
                            : <HelpCircle size={18} className="text-warning" />
                        }
                      </span>
                      <div className="flex-1">
                        <div className="text-white text-sm font-medium">{asm.assumption}</div>
                        {asm.basis && (
                          <div className="text-xs text-tertiary mt-2">
                            <span className="text-disabled uppercase font-semibold text-[9px] tracking-wider">Basis:</span> {asm.basis}
                          </div>
                        )}
                        {asm.invalidated_reason && (
                          <div className="text-xs text-error mt-2 p-2 rounded bg-status-error/5 border border-error/10">
                            <span className="font-semibold uppercase text-[9px] tracking-wider">Invalidated Reason:</span> {asm.invalidated_reason}
                          </div>
                        )}

                        {isUnresolved && (
                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button
                              onClick={() => onValidate(asm.assumption_id)}
                              disabled={isPending}
                              className="px-3 py-1.5 bg-status-success text-white hover:bg-emerald-600 disabled:opacity-50 text-[11px] rounded font-semibold transition-colors"
                            >
                              {pendingOps[asm.assumption_id] === 'validating' ? 'Validating...' : 'Validate'}
                            </button>
                            <div className="flex items-center gap-2 flex-1">
                              <input
                                type="text"
                                placeholder="Invalidate with reason..."
                                value={invalidateReasons[asm.assumption_id] || ''}
                                onChange={(e) => setInvalidateReasons(prev => ({ ...prev, [asm.assumption_id]: e.target.value }))}
                                className="flex-1 px-3 py-1.5 bg-secondary border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-error/50"
                              />
                              <button
                                onClick={() => onInvalidate(asm.assumption_id)}
                                disabled={!invalidateReasons[asm.assumption_id]?.trim() || isPending}
                                className="px-3 py-1.5 bg-error-subtle border border-error/20 text-error hover:bg-error-subtle disabled:opacity-50 text-[11px] rounded font-semibold transition-colors"
                              >
                                Invalidate
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-tertiary text-sm">No explicit assumptions recorded for this decision.</div>
          )}
        </CardContent>
      </Card>

      <Card hover={false}>
        <CardHeader title="Drift Detection" icon={Activity} />
        <CardContent>
          {drift ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-secondary">Assumption drift</span>
                <span className={`text-sm font-bold ${drift.tone}`}>{drift.invalidated}/{assumptions.length} invalidated ({drift.label})</span>
              </div>
              <div className="h-2 bg-tertiary rounded-full overflow-hidden">
                <div className={`h-full ${drift.bar}`} style={{ width: `${Math.max(drift.driftPct, 2)}%` }} />
              </div>
              <p className="text-xs text-tertiary">
                Drift reflects how many of this decision&apos;s recorded assumptions have since been invalidated.
                {drift.driftPct === 0 ? ' None have drifted.' : ` ${drift.invalidated} of ${assumptions.length} no longer hold.`}
              </p>
            </div>
          ) : (
            <div className="py-8 text-center text-tertiary text-sm">No assumptions recorded to assess drift.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
