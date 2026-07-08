'use client';

import { useState } from 'react';
import { Send, ArrowRight, AlertCircle, ShieldCheck, RotateCcw } from 'lucide-react';

/*
 * v5.2 "first governed action in the browser": rendered on /connect inside
 * the trial branch (the page only mounts this when the visitor carries a
 * live trial session). One same-origin POST /api/guard?record=true rides
 * the session cookie — the same governed path an agent takes — then the
 * decision renders here and deep-links to the row in /decisions.
 *
 * The defaults below are exported so a unit test can pin them against the
 * shared synthetic-traffic exclusion (app/lib/calibration-mining.js):
 * if any default ever matches a synthetic pattern, browser activations
 * silently vanish from the hosted funnel.
 */
import { BROWSER_FIRST_ACTION_AGENT_ID as FIRST_ACTION_AGENT_ID } from '../lib/hosted/browser-action.js';
export { FIRST_ACTION_AGENT_ID };
export const FIRST_ACTION_AGENT_NAME = 'Browser (first action)';
export const FIRST_ACTION_TYPES = ['connect.first_action', 'send_email', 'deploy', 'db_write'];
export const FIRST_ACTION_DEFAULT_GOAL = 'Send my first governed action from the browser';

const DECISION_META = {
  allow: {
    label: 'Allowed',
    classes: 'bg-status-success-subtle text-status-success',
  },
  warn: {
    label: 'Allowed with warning',
    classes: 'bg-status-warning-subtle text-status-warning',
  },
  require_approval: {
    label: 'Needs approval',
    classes: 'bg-status-warning-subtle text-status-warning',
  },
  block: {
    label: 'Blocked',
    classes: 'bg-status-error-subtle text-status-error',
  },
};

function decisionReason(result) {
  if (typeof result.reason === 'string' && result.reason) return result.reason;
  if (Array.isArray(result.reasons) && result.reasons.length) return result.reasons.join('; ');
  return null;
}

export default function FirstGovernedActionCard() {
  const [goal, setGoal] = useState(FIRST_ACTION_DEFAULT_GOAL);
  const [actionType, setActionType] = useState(FIRST_ACTION_TYPES[0]);
  const [state, setState] = useState({ status: 'idle' });

  const payload = {
    agent_id: FIRST_ACTION_AGENT_ID,
    agent_name: FIRST_ACTION_AGENT_NAME,
    action_type: actionType,
    declared_goal: goal,
  };

  async function onSend() {
    setState({ status: 'sending' });
    try {
      const res = await fetch('/api/guard?record=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ status: 'error', error: body.error || `HTTP ${res.status}`, httpStatus: res.status });
        return;
      }
      setState({ status: 'done', result: body });
    } catch (err) {
      setState({ status: 'error', error: err.message || 'Network error' });
    }
  }

  const result = state.status === 'done' ? state.result : null;
  const meta = result ? DECISION_META[result.decision] || { label: String(result.decision), classes: 'bg-surface-tertiary text-text-secondary' } : null;
  const reason = result ? decisionReason(result) : null;
  const matched = result && Array.isArray(result.matched_policies) ? result.matched_policies : [];

  return (
    <section
      id="first-action"
      className="mb-10 scroll-mt-28 rounded-3xl border border-border bg-surface-secondary p-6 sm:p-8"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">
        Your first governed action
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
        Send a governed action from this page.
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-text-secondary leading-relaxed">
        No install needed. This sends one real request through the guard (the
        same call your agents make), records it against your workspace, and the
        decision lands in your ledger.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            Declared goal
          </span>
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-active"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            Action type
          </span>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="rounded-lg border border-border bg-surface-primary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-active"
          >
            {FIRST_ACTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
          POST /api/guard?record=true
        </p>
        <pre className="mt-2 overflow-x-auto rounded-xl border border-border bg-surface-primary p-4 font-mono text-xs leading-relaxed text-text-secondary">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSend}
          disabled={state.status === 'sending'}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-surface-primary transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Send size={14} aria-hidden="true" />
          {state.status === 'sending' ? 'Sending…' : 'Send governed action'}
        </button>
        {state.status === 'error' ? (
          <div className="flex items-center gap-1.5 text-xs text-status-error">
            <AlertCircle size={12} aria-hidden="true" />
            <span>
              {state.error}
              {state.httpStatus === 403
                ? '. The trial write envelope refused this request (the trial may have expired or reached its action cap).'
                : null}
            </span>
          </div>
        ) : null}
      </div>

      {result ? (
        <div className="mt-5 space-y-3 rounded-2xl border border-border bg-surface-tertiary p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${meta.classes}`}>
              <ShieldCheck size={12} aria-hidden="true" />
              {meta.label}
            </span>
            {result.risk_score != null ? (
              <span className="text-xs text-text-tertiary tabular-nums">
                risk {Number(result.risk_score)}
              </span>
            ) : null}
            {matched.length ? (
              <span className="text-xs text-text-tertiary">
                {matched.length} {matched.length === 1 ? 'policy' : 'policies'} matched
              </span>
            ) : null}
          </div>

          {reason ? (
            <p className="text-sm text-text-secondary leading-relaxed">{reason}</p>
          ) : null}

          {result.decision === 'block' ? (
            <p className="text-sm text-text-secondary leading-relaxed">
              Blocked actions never reach the action ledger: the guard refused
              this before it could run. That is the product working.
            </p>
          ) : null}
          {result.decision === 'require_approval' ? (
            <p className="text-sm text-text-secondary leading-relaxed">
              This action is waiting on an operator&rsquo;s approval before it
              may proceed.
            </p>
          ) : null}

          {result.recorded && result.action_id ? (
            <a
              href={`/decisions/${result.action_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-surface-primary transition-colors hover:bg-brand-hover"
            >
              View it in your ledger
              <ArrowRight size={14} aria-hidden="true" />
            </a>
          ) : null}
          {result.recorded === false && result.recorded_error ? (
            <p className="text-xs text-text-tertiary">
              Decision evaluated, but the action record failed: {result.recorded_error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => setState({ status: 'idle' })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
          >
            <RotateCcw size={12} aria-hidden="true" />
            Send another
          </button>
        </div>
      ) : null}
    </section>
  );
}
