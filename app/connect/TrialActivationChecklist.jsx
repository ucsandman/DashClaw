'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, CircleDot } from 'lucide-react';

/*
 * Hosted trial only: the three facts between a minted workspace and a
 * governed agent, read from the caller's own org (GET /api/hosted/activation)
 * and re-read every few seconds until all three are true. The server decides
 * every state; this component only renders it. A refused read (no session
 * for this workspace, not a trial) renders nothing rather than a stale or
 * borrowed checklist.
 */

const HELP = {
  key_used: 'Your agent sends its first request with the trial key.',
  first_call: 'Start your agent and let it take one action. The browser demo button does not count.',
  approval_landed: null, // rendered with the phone link below
};

function StepIcon({ state }) {
  if (state === 'done') return <CheckCircle2 size={18} className="text-status-success" aria-hidden="true" />;
  if (state === 'current') return <CircleDot size={18} className="text-brand" aria-hidden="true" />;
  return <Circle size={18} className="text-text-tertiary" aria-hidden="true" />;
}

const STATE_TEXT = { done: 'Done', current: 'Next', todo: 'Waiting' };

export default function TrialActivationChecklist({ workspaceId = null, pollMs = 5000, className = '' }) {
  const [data, setData] = useState(null);
  const [refused, setRefused] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    let cancelled = false;
    let timer = null;
    const url = workspaceId
      ? `/api/hosted/activation?workspace_id=${encodeURIComponent(workspaceId)}`
      : '/api/hosted/activation';

    async function tick() {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          // 401/403/404 will not change by waiting; a 5xx might.
          if (res.status < 500) {
            setRefused(true);
            return;
          }
        } else {
          const body = await res.json();
          if (cancelled) return;
          setData(body);
          if (body.complete) return;
        }
      } catch {
        // Network blip: keep the last state and try again.
      }
      if (!cancelled) timer = setTimeout(tick, pollMs);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, pollMs]);

  if (refused || !data || !Array.isArray(data.steps)) return null;

  const approveUrl = `${origin}/approve`;

  return (
    <section aria-label="Activation checklist" className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
          Your first real agent call
        </p>
        <p className="text-xs text-text-tertiary" aria-live="polite">
          {data.complete ? 'All three done. Your agent is governed.' : 'Live: updates by itself every few seconds.'}
        </p>
      </div>
      <ol className="mt-3 space-y-3">
        {data.steps.map((step, i) => {
          const state = step.done ? 'done' : step.id === data.current ? 'current' : 'todo';
          return (
            <li key={step.id} data-state={state} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0"><StepIcon state={state} /></span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${state === 'todo' ? 'text-text-secondary' : 'text-text-primary'}`}>
                  <span className="tabular-nums">{i + 1}.</span> {step.label}
                  <span className="sr-only"> ({STATE_TEXT[state]})</span>
                </p>
                {step.id === 'approval_landed' ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">
                    Open{' '}
                    <a href={approveUrl} className="font-mono text-brand hover:text-brand-hover">
                      {approveUrl}
                    </a>{' '}
                    on your phone and add it to your home screen. When an action needs your approval, tap Allow there.
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs leading-relaxed text-text-tertiary">{HELP[step.id]}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
