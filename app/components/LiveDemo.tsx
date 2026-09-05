'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Play,
  Check,
  X,
  ShieldAlert,
  ShieldCheck,
  Clock,
  ArrowRight,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { trackMarketingEvent } from '../lib/marketingTrack';
import { HOMEPAGE_PRESETS, writeHomepageResolution } from '../lib/homepageDemoActions';
import type { HomepageResolution } from '../lib/homepageDemoActions';

/*
 * Live, interactive governance demo for the marketing home page.
 *
 * Wires real /api/guard POST requests against the dashclaw.io demo deployment
 * (DASHCLAW_MODE=demo). The three presets target deterministic demo agents in
 * app/lib/demo/demoMiddleware.js so each yields a distinct decision shape:
 *
 *   - analytics-agent  (risk 25)       -> decision: allow
 *   - openai-deployer-1                -> decision: require_approval
 *                                         action_id is the persisted demo
 *                                         action ar_demo_deploy_block_001, so
 *                                         /replay/<id> resolves cleanly.
 *   - rogue-agent      (risk 92)       -> decision: block
 *
 * The Allow / Deny buttons on a require_approval result resolve in local
 * state only. The /api/actions/:id/approve endpoint is not wired into demo
 * middleware and we are constrained not to edit middleware.js. The honest
 * trade-off is documented in the helper text under the Approval card.
 */

const PRESETS = HOMEPAGE_PRESETS;

const PHASE = {
  IDLE: 'idle',
  EVALUATING: 'evaluating',
  DECIDED: 'decided',
  RESOLVED: 'resolved',
};

function parseMatchedPolicies(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return [value];
    }
  }
  return [];
}

// The persisted demo action id replays cleanly because demoActionDetail
// has a deterministic fixture for it. Every other guard call returns a
// random ar_demo_* id that the demo middleware never persists, so the
// /replay/<id> page would 404. The audit ledger at /decisions is public
// in demo mode and is the most useful fallback.
const PERSISTED_REPLAY_ID = 'ar_demo_deploy_block_001';

function destinationFor(decision: any) {
  if (decision?.decision === 'require_approval' && decision.action_id === PERSISTED_REPLAY_ID) {
    return { href: `/replay/${decision.action_id}`, label: 'View this decision' };
  }
  return { href: '/decisions', label: 'View the decision ledger' };
}

// After a require_approval resolves locally, the server replay still
// shows APPROVAL REQUIRED because the demo /api/actions/:id/approve
// endpoint is not wired (the local Approve / Deny click is component
// state only). Routing visitors to /decisions instead avoids that
// staleness while still landing them on a real demo page.
const RESOLVED_DESTINATION = { href: '/decisions', label: 'View the decision ledger' };

export default function LiveDemo() {
  const [preset, setPreset] = useState<any>(PRESETS[1]);
  const [goal, setGoal] = useState<string>(PRESETS[1]?.declaredGoal ?? '');
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [decision, setDecision] = useState<any>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const codePreview = useMemo(() => {
    const safeGoal = goal.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\n/g, ' ');
    return `await claw.guard({
  agent_id: '${preset.agentId}',
  action_type: '${preset.actionType}',
  risk_score: ${preset.riskScore},
  declared_goal: '${safeGoal}',
});`;
  }, [preset, goal]);

  function selectPreset(next: any) {
    setPreset(next);
    setGoal(next.declaredGoal);
    setPhase(PHASE.IDLE);
    setDecision(null);
    setResolution(null);
    setError(null);
  }

  async function handleEvaluate() {
    setPhase(PHASE.EVALUATING);
    setError(null);
    setResolution(null);
    setDecision(null);

    try {
      const res = await fetch('/api/guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: preset.agentId,
          action_type: preset.actionType,
          risk_score: preset.riskScore,
          declared_goal: goal,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Guard call failed with status ${res.status}`);
      }
      setDecision(data);
      setPhase(PHASE.DECIDED);
      trackMarketingEvent('marketing_demo_evaluated', {
        preset: preset.id,
        decision: data?.decision || 'unknown',
      });
    } catch (err: any) {
      setError(err.message || 'Guard call failed.');
      setPhase(PHASE.IDLE);
    }
  }

  function handleResolve(value: string) {
    setResolution(value);
    setPhase(PHASE.RESOLVED);
    // Persist so the /decisions ledger reflects the visitor's choice on
    // their next page view.
    writeHomepageResolution(value as HomepageResolution);
  }

  function handleReset() {
    setPhase(PHASE.IDLE);
    setDecision(null);
    setResolution(null);
    setError(null);
  }

  const isEvaluating = phase === PHASE.EVALUATING;
  const isBusy = isEvaluating;

  return (
    <section
      id="live-demo"
      aria-labelledby="live-demo-heading"
      className="py-20 px-6 border-t border-border bg-surface-secondary/40 scroll-mt-20"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-tertiary mb-3">
            Live policy evaluation, real demo endpoint
          </p>
          <h2
            id="live-demo-heading"
            className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary"
          >
            Try a live policy evaluation
          </h2>
          <p className="mt-3 text-sm text-text-secondary max-w-2xl mx-auto leading-relaxed">
            Pick a declared action and inspect the policy decision returned by the demo endpoint. This bare guard call is cooperative and does not bind or execute an external act.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface-secondary overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]">
          {/* Preset row */}
          <div className="px-5 py-4 border-b border-border bg-surface-tertiary">
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-3">
              Pick an action to evaluate
            </div>
            <div
              role="radiogroup"
              aria-label="Preset actions"
              className="flex flex-wrap gap-2"
            >
              {PRESETS.map((p: any) => {
                const active = preset.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => selectPreset(p)}
                    className={[
                      'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-brand/60 focus:ring-offset-2 focus:ring-offset-surface-tertiary',
                      active
                        ? 'bg-brand-subtle text-brand border border-border-active'
                        : 'bg-surface-secondary text-text-secondary border border-border hover:border-border-hover hover:text-text-primary',
                    ].join(' ')}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body: two column */}
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Left: editable call */}
            <div className="p-5 border-b lg:border-b-0 lg:border-r border-border">
              <label
                htmlFor="live-demo-goal"
                className="block text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2"
              >
                Declared goal
              </label>
              <textarea
                id="live-demo-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                className="w-full text-base font-mono text-text-primary bg-surface-primary border border-border rounded-lg px-3 py-3 leading-relaxed resize-none focus:outline-none focus:border-border-active focus:ring-2 focus:ring-brand/30"
                disabled={isBusy}
              />

              <div className="mt-5">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">
                  SDK call
                </div>
                <pre
                  tabIndex={0}
                  aria-label="Live demo SDK call"
                  className="text-sm leading-relaxed font-mono text-text-secondary bg-surface-primary border border-border rounded-lg p-4 overflow-x-auto"
                >
                  <code>{codePreview}</code>
                </pre>
              </div>

              <button
                type="button"
                onClick={handleEvaluate}
                disabled={isBusy}
                className={[
                  'mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-lg text-base font-bold transition-all',
                  'focus:outline-none focus:ring-2 focus:ring-brand/60 focus:ring-offset-2 focus:ring-offset-surface-secondary',
                  isBusy
                    ? 'bg-brand/60 text-surface-primary cursor-not-allowed'
                    : 'bg-brand text-surface-primary hover:bg-brand-hover hover:scale-[1.02] shadow-lg shadow-brand/20',
                ].join(' ')}
              >
                {isEvaluating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    Evaluating
                  </>
                ) : (
                  <>
                    <Play size={18} aria-hidden="true" />
                    Evaluate
                  </>
                )}
              </button>

              {error ? (
                <p
                  role="alert"
                  className="mt-3 text-xs text-status-error"
                >
                  {error}
                </p>
              ) : null}
            </div>

            {/* Right: result */}
            <div className="p-5 bg-surface-secondary/40">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-3">
                Governance result
              </div>

              {phase === PHASE.IDLE && !decision ? (
                <IdlePanel />
              ) : null}

              {phase === PHASE.EVALUATING ? (
                <EvaluatingPanel />
              ) : null}

              {phase === PHASE.DECIDED && decision ? (
                <DecisionPanel
                  decision={decision}
                  onResolve={handleResolve}
                  onReset={handleReset}
                />
              ) : null}

              {phase === PHASE.RESOLVED && decision ? (
                <ResolvedPanel
                  decision={decision}
                  resolution={resolution}
                  onReset={handleReset}
                />
              ) : null}
            </div>
          </div>
        </div>

        <p className="mt-5 text-sm text-text-tertiary text-center max-w-2xl mx-auto leading-relaxed">
          Policy decisions come from the demo deployment. Approval clicks are illustrative local state so visitors can explore the interface without an account; they do not approve server-side work. Your own instance records approval decisions through <code className="font-mono text-text-secondary">/api/actions/:id/approve</code>.
        </p>
      </div>
    </section>
  );
}

function IdlePanel() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-primary/40 p-5 text-base text-text-tertiary">
      <div className="flex items-start gap-3">
        <Sparkles size={18} className="text-text-tertiary mt-0.5 shrink-0" aria-hidden="true" />
        <p className="leading-relaxed">
          Pick an action and click Evaluate. The result will appear here, including the matched policy, the risk score, and what a human approver would see.
        </p>
      </div>
    </div>
  );
}

function EvaluatingPanel() {
  return (
    <div className="rounded-xl border border-border bg-surface-primary/40 p-5 text-base text-text-secondary">
      <div className="flex items-center gap-3">
        <Loader2 size={18} className="text-brand animate-spin" aria-hidden="true" />
        <span>Asking the governance runtime...</span>
      </div>
    </div>
  );
}

function DecisionBadge({ decision }: { decision?: string }) {
  if (decision === 'allow') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-status-success-subtle text-status-success border border-status-success/30">
        <ShieldCheck size={14} aria-hidden="true" /> Allow
      </span>
    );
  }
  if (decision === 'block') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-status-error-subtle text-status-error border border-status-error/30">
        <ShieldAlert size={14} aria-hidden="true" /> Block
      </span>
    );
  }
  if (decision === 'require_approval') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-brand-subtle text-brand border border-border-active">
        <Clock size={14} aria-hidden="true" /> Require approval
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider bg-surface-tertiary text-text-secondary border border-border">
      {decision || 'unknown'}
    </span>
  );
}

interface DecisionPanelProps {
  decision: any;
  onResolve: (value: string) => void;
  onReset: () => void;
}

function DecisionPanel({ decision, onResolve, onReset }: DecisionPanelProps) {
  const policies = parseMatchedPolicies(decision.matched_policies);
  const requiresApproval = decision.decision === 'require_approval';
  const showFooter = decision.decision === 'allow' || decision.decision === 'block';
  const dest = destinationFor(decision);

  return (
    <div className="rounded-xl border border-border bg-surface-primary/40 overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <DecisionBadge decision={decision.decision} />
        <span className="text-xs font-mono text-text-tertiary">
          risk {decision.risk_score ?? '-'}
        </span>
      </div>
      <div className="px-5 py-5 space-y-4">
        {decision.reason ? (
          <p className="text-base text-text-secondary leading-relaxed">{decision.reason}</p>
        ) : null}

        {policies.length ? (
          <div className="text-sm">
            <span className="text-text-tertiary uppercase tracking-wider font-mono text-xs">Matched policies </span>
            <span className="ml-1 inline-flex flex-wrap gap-1.5 align-middle">
              {policies.map((p: any) => (
                <span
                  key={p}
                  className="px-2 py-0.5 rounded bg-surface-tertiary border border-border text-text-secondary font-mono text-xs"
                >
                  {p}
                </span>
              ))}
            </span>
          </div>
        ) : null}

        {requiresApproval ? (
          <div className="mt-2 rounded-lg border border-border-active bg-brand-subtle/60 p-4">
            <p className="text-sm text-text-secondary mb-3 leading-relaxed">
              A human approver decides what happens next. In production this routes to your dashboard, CLI, mobile PWA, or Telegram bot.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => onResolve('allow')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md text-sm font-bold bg-status-success text-white hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-status-success/60 focus:ring-offset-2 focus:ring-offset-surface-secondary"
              >
                <Check size={16} aria-hidden="true" /> Approve
              </button>
              <button
                type="button"
                onClick={() => onResolve('deny')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md text-sm font-bold bg-status-error text-white hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-status-error/60 focus:ring-offset-2 focus:ring-offset-surface-secondary"
              >
                <X size={16} aria-hidden="true" /> Deny
              </button>
            </div>
          </div>
        ) : null}

        {showFooter ? (
          <div className="pt-2 flex items-center justify-between gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link
                href={dest.href}
                className="inline-flex items-center gap-1.5 text-brand hover:text-brand-hover transition-colors font-medium"
              >
                {dest.label} <ArrowRight size={14} aria-hidden="true" />
              </Link>
              <Link
                href="/connect"
                className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors font-medium"
              >
                Connect your own agent <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <button
              type="button"
              onClick={onReset}
              className="text-text-tertiary hover:text-text-primary transition-colors font-mono text-xs"
            >
              Reset
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ResolvedPanelProps {
  decision: any;
  resolution: string | null;
  onReset: () => void;
}

function ResolvedPanel({ decision, resolution, onReset }: ResolvedPanelProps) {
  const approved = resolution === 'allow';
  return (
    <div className="rounded-xl border border-border bg-surface-primary/40 overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <span
          className={[
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider border',
            approved
              ? 'bg-status-success-subtle text-status-success border-status-success/30'
              : 'bg-status-error-subtle text-status-error border-status-error/30',
          ].join(' ')}
        >
          {approved ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
          {approved ? 'Approved by you' : 'Denied by you'}
        </span>
        <span className="text-xs font-mono text-text-tertiary">
          risk {decision.risk_score ?? '-'}
        </span>
      </div>
      <div className="px-5 py-5 space-y-4 text-base text-text-secondary leading-relaxed">
        <p>
          {approved
            ? 'Your approval would unblock the agent within about a second. The action carries the approver identity and the resolution reason into the audit trail.'
            : 'The agent receives a denial event, throws ApprovalDeniedError, and never touches the real system. The denial reason lands in the audit trail next to the original guard decision.'}
        </p>
        <div className="pt-1 flex items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href="/connect"
              className="inline-flex items-center gap-1.5 text-brand hover:text-brand-hover transition-colors font-medium"
            >
              Connect your own agent <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <Link
              href={RESOLVED_DESTINATION.href}
              className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors font-medium"
            >
              {RESOLVED_DESTINATION.label} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="text-text-tertiary hover:text-text-primary transition-colors font-mono text-xs"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
