'use client';

import { HelpCircle, ShieldCheck, Scale } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { parseJsonArray } from '../../../lib/parseJson';
import { formatTime } from './helpers';

interface PoliciesTabProps {
  actionId: string;
  action: any;
  guardDecision: any;
  trace: any;
  assumptions: any[];
}

export default function PoliciesTab({ actionId, action, guardDecision, trace, assumptions }: PoliciesTabProps) {
  return (
    <div className="space-y-6">
      <Card hover={false}>
        <CardHeader title="Guard Evaluation" icon={ShieldCheck} />
        <CardContent>
          {guardDecision ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-lg bg-surface-tertiary border border-white/5">
                <div>
                  <div className="text-xs text-tertiary uppercase tracking-wider mb-1">Decision</div>
                  <div className={`text-xl font-bold ${
                    guardDecision.decision === 'allow' ? 'text-success' :
                    guardDecision.decision === 'block' ? 'text-error' : 'text-warning'
                  }`}>
                    {guardDecision.decision.toUpperCase()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-tertiary uppercase tracking-wider mb-1">Evaluated At</div>
                  <div className="text-sm text-secondary">{formatTime(guardDecision.created_at)}</div>
                </div>
              </div>

              {guardDecision.reason && (
                <div>
                  <div className="text-xs text-tertiary uppercase tracking-wider mb-2">Reasoning</div>
                  <div className="p-4 rounded-lg bg-white/5 text-sm text-secondary italic">
                    &ldquo;{guardDecision.reason}&rdquo;
                  </div>
                </div>
              )}

              {parseJsonArray(guardDecision.matched_policies).length > 0 && (
                <div>
                  <div className="text-xs text-tertiary uppercase tracking-wider mb-3">Enforced Policies</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {parseJsonArray(guardDecision.matched_policies).map((p: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg border border-white/5 bg-surface-tertiary flex items-center gap-3">
                        <ShieldCheck size={16} className="text-success" />
                        <div className="text-sm text-white font-medium">{typeof p === 'string' ? p : p.name || p.id}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center">
              <HelpCircle size={40} className="text-disabled mx-auto mb-4" />
              <div className="text-white font-medium mb-2">No Governance Data</div>
              <p className="text-sm text-tertiary max-w-sm mx-auto">
                This decision was not governed by the DashClaw Guard engine. Ensure your SDK implementation uses <code className="text-secondary">claw.guard()</code> for full decision replay capability.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Policy Proof Section */}
      <Card hover={false}>
        <CardHeader title="Governance Proof" icon={Scale} />
        <CardContent>
          <div className="bg-primary p-6 rounded-lg border border-success/20 font-mono text-xs text-success/80 leading-relaxed overflow-x-auto">
            <div className="mb-4 text-success font-bold uppercase tracking-widest">--- DashClaw Governance Evidence ---</div>
            <div>DECISION_ID: {actionId}</div>
            <div>TIMESTAMP: {new Date(action.timestamp_start).toISOString()}</div>
            <div>AGENT: {action.agent_id}</div>
            <div>OUTCOME: {action.status.toUpperCase()}</div>
            <div className="my-4 border-t border-success/20" />
            <div>POLICIES_MATCHED: {guardDecision ? parseJsonArray(guardDecision.matched_policies).length : 0}</div>
            <div>INTEGRITY_SIGNALS: {trace?.root_cause_indicators?.length || 0}</div>
            <div>ASSUMPTIONS_CHECKED: {assumptions.length}</div>
            <div className="my-4 border-t border-success/20" />
            {/* Real signature state only — a fabricated random "signature"
                used to render here, changing every refresh. */}
            <div>SIGNATURE_VERIFIED: {action.verified ? 'TRUE' : 'FALSE'}</div>
            {action.signature ? (
              <div className="break-all mt-1 opacity-60">{String(action.signature)}</div>
            ) : (
              <div className="mt-1 opacity-60">No agent signature attached to this action.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
