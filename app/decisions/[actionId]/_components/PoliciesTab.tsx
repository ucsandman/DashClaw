'use client';

import { HelpCircle, ShieldCheck, Scale } from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { parseJsonArray } from '../../../lib/parseJson';
import { describeAction } from '../../../lib/plain-language';
import { IRREVERSIBLE_TEXT } from '../../../lib/plain-language/types';
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
                  {/* Posture visibility (RFC 2026-08-13 §6): which regime
                      produced this verdict. Absence = local-only, unlabeled —
                      the quiet default. Lives in the always-rendered header
                      because an external deny can arrive with zero matched
                      local policies. 'skipped' (#219 scope filter) renders
                      neutral: the act was outside the provider's declared
                      scope, so no external governance happened — honestly. */}
                  {guardDecision.context?._external_verdict && (
                    <span
                      className="mt-2 inline-block"
                      title={guardDecision.context._external_verdict.status === 'skipped'
                        ? `Provider ${guardDecision.context._external_verdict.provider_id} not consulted — this action type is outside its configured scope`
                        : `Provider ${guardDecision.context._external_verdict.provider_id} · posture ${guardDecision.context._external_verdict.posture}${guardDecision.context._external_verdict.reason_code ? ` · ${guardDecision.context._external_verdict.reason_code}` : ''}`}
                    >
                      <Badge
                        variant={guardDecision.context._external_verdict.status === 'ok' ? 'info'
                          : guardDecision.context._external_verdict.status === 'skipped' ? 'default'
                          : 'warning'}
                        size="xs"
                      >
                        {guardDecision.context._external_verdict.status === 'ok'
                          ? `External: ${guardDecision.context._external_verdict.raw_verdict}`
                          : guardDecision.context._external_verdict.status === 'skipped'
                            ? 'External: out of scope'
                            : 'External unavailable'}
                      </Badge>
                    </span>
                  )}
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

              {(() => {
                // Same describeAction() the /approvals card and notification
                // channels call — one sentence, everywhere, so an operator
                // never sees the detail page disagree with what they already
                // saw. Silent when confidence is 'unknown' rather than
                // rendering an empty box.
                const plain = describeAction({
                  declared_goal: action.declared_goal,
                  risk_score: action.risk_score,
                  target: action.target,
                  intel: guardDecision.context?.intel,
                });
                if (plain.confidence === 'unknown') return null;
                return (
                  <div className="mb-4 rounded-lg border border-border bg-surface-tertiary p-3">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                      In plain English
                    </div>
                    {/* This page has no red irreversibility band of its own, and
                        describeAction drops the sentence from `warnings` once the
                        classifier has said reversible:false (the approvals card
                        renders it as the band). Say it here explicitly, or the
                        detail page tells the reader strictly less than the queue. */}
                    {plain.reversible === false && (
                      <p className="mb-1 text-sm font-semibold text-error">{IRREVERSIBLE_TEXT}</p>
                    )}
                    <p className="text-sm text-white">{plain.headline}</p>
                    {plain.warnings.map((w) => (
                      <p key={w} className="mt-1 text-sm text-warning">{w}</p>
                    ))}
                    {/* Not amber: a reassurance is the absence of a problem. */}
                    {plain.reassurance && (
                      <p className="mt-1 text-sm text-tertiary">{plain.reassurance}</p>
                    )}
                  </div>
                );
              })()}

              {(() => {
                // Classifier signals (hook intel validations persisted in
                // guard_decisions.context) — e.g. script_then_execute when a
                // self-written script's content drove the grade. Allow-result
                // validations are routine noise and stay hidden.
                const validations = (guardDecision.context?.intel?.bash?.validations || []).filter(
                  (v: any) => v && v.result && v.result !== 'allow'
                );
                if (validations.length === 0) return null;
                return (
                  <div>
                    <div className="text-xs text-tertiary uppercase tracking-wider mb-3">Classifier Signals</div>
                    <div className="space-y-2">
                      {validations.map((v: any, i: number) => (
                        <div
                          key={i}
                          className={`p-3 rounded-lg border flex items-start gap-3 ${
                            v.result === 'block'
                              ? 'border-error/20 bg-error-subtle'
                              : 'border-warning/20 bg-warning-subtle'
                          }`}
                        >
                          <Badge variant={v.result === 'block' ? 'error' : 'warning'} size="xs">
                            {v.result}
                          </Badge>
                          <div className="min-w-0">
                            <div className="text-sm text-white font-mono">{v.check}</div>
                            {v.reason && <div className="text-xs text-secondary mt-1">{v.reason}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {parseJsonArray(guardDecision.matched_policies).length > 0 && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="text-xs text-tertiary uppercase tracking-wider">Enforced Policies</div>
                    {guardDecision.context?._plan_grant && (
                      <span title={`Step ${guardDecision.context._plan_grant.step_id}`}>
                        <Badge variant="brand" size="xs">
                          Plan grant: {guardDecision.context._plan_grant.plan_id} step {guardDecision.context._plan_grant.seq}
                        </Badge>
                      </span>
                    )}
                    {guardDecision.context?._plan_deviation && (
                      <span title={`Plan ${guardDecision.context._plan_deviation.plan_id}`}>
                        <Badge variant="warning" size="xs">
                          Deviation: {String(guardDecision.context._plan_deviation.kind).replace(/_/g, ' ')} ({guardDecision.context._plan_deviation.severity})
                        </Badge>
                      </span>
                    )}
                  </div>
                  {/* Declared vs observed (RFC 2026-08-11 §12): the deviation's
                      whole story beside the policies it triggered. */}
                  {guardDecision.context?._plan_deviation && (
                    <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-white/5 bg-surface-tertiary p-3">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-tertiary">Declared (plan)</div>
                        <pre className="whitespace-pre-wrap break-all font-mono text-xs text-secondary">
                          {JSON.stringify(guardDecision.context._plan_deviation.declared ?? {}, null, 2)}
                        </pre>
                      </div>
                      <div className="rounded-lg border border-warning/20 bg-warning-subtle p-3">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-tertiary">Observed (live)</div>
                        <pre className="whitespace-pre-wrap break-all font-mono text-xs text-secondary">
                          {JSON.stringify(guardDecision.context._plan_deviation.observed ?? {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
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
