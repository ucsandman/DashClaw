import type { ReactNode } from 'react';
import { ShieldAlert, Check, Zap, ShieldCheck } from 'lucide-react';

/*
 * The hero artifact: one governed action rendered end to end, the way the
 * product renders it. Static example data, labeled as such; the real call is
 * one scroll below in LiveDemo. Rows stage in with the existing fadeSlideIn
 * keyframe from globals.css so the record "happens" on load; the global
 * prefers-reduced-motion block collapses the choreography to an instant
 * render.
 */

function stage(ms: number) {
  return { animation: `fadeSlideIn 0.45s ease-out ${ms}ms both` };
}

const FIELDS: Array<{ label: string; value: ReactNode; delay: number }> = [
  { label: 'agent_id', value: <span className="text-text-primary">deploy-bot</span>, delay: 0 },
  { label: 'action_type', value: <span className="text-text-primary">deploy</span>, delay: 60 },
  {
    label: 'declared_goal',
    value: <span className="text-text-secondary">&quot;Ship auth-service v2.1 to production&quot;</span>,
    delay: 120,
  },
  {
    label: 'risk_score',
    value: (
      <span className="tabular-nums">
        <span className="text-error font-semibold">92</span>
        <span className="text-text-tertiary"> / 100</span>
      </span>
    ),
    delay: 180,
  },
  {
    label: 'matched_policy',
    value: <span className="text-text-primary">production_deploy_gate</span>,
    delay: 240,
  },
];

export default function HeroDecisionRecord() {
  return (
    <figure className="w-full">
      <div className="rounded-xl border border-border bg-surface-secondary shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-text-tertiary">
            Governed action
          </span>
          <span className="text-[10px] font-mono text-text-tertiary border border-border rounded-full px-2 py-0.5">
            example
          </span>
        </div>

        {/* Declared intent */}
        <dl className="px-5 py-4 space-y-1.5 font-mono text-[13px] leading-relaxed">
          {FIELDS.map((f) => (
            <div key={f.label} className="grid grid-cols-[8.5rem_1fr] gap-3" style={stage(f.delay)}>
              <dt className="text-text-tertiary">{f.label}</dt>
              <dd className="min-w-0 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>

        {/* What the runtime did */}
        <ol className="px-5 py-4 border-t border-border space-y-3 text-sm">
          <li className="flex items-center gap-3" style={stage(450)}>
            <ShieldAlert size={15} className="text-brand shrink-0" aria-hidden="true" />
            <span className="px-2 py-0.5 rounded bg-brand-subtle border border-active text-brand text-[11px] font-mono font-semibold tracking-wide">
              REQUIRE_APPROVAL
            </span>
            <span className="text-text-secondary min-w-0 truncate">held, routed to on-call</span>
            <span className="ml-auto font-mono text-xs text-text-tertiary tabular-nums">+0.3s</span>
          </li>
          <li className="flex items-center gap-3" style={stage(850)}>
            <Check size={15} className="text-success shrink-0" aria-hidden="true" />
            <span className="text-text-secondary min-w-0 truncate">
              approved by <span className="text-text-primary">wes</span> via Discord
            </span>
            <span className="ml-auto font-mono text-xs text-text-tertiary tabular-nums">+41s</span>
          </li>
          <li className="flex items-center gap-3" style={stage(1150)}>
            <Zap size={15} className="text-text-secondary shrink-0" aria-hidden="true" />
            <span className="text-text-secondary min-w-0 truncate">
              deploy executed, outcome <span className="text-success">success</span>
            </span>
            <span className="ml-auto font-mono text-xs text-text-tertiary tabular-nums">+47s</span>
          </li>
        </ol>

        {/* Evidence footer */}
        <div
          className="px-5 py-3 border-t border-border flex items-center justify-between gap-3"
          style={stage(1350)}
        >
          <span className="font-mono text-[11px] text-text-tertiary truncate">
            act_9f2c47b1 &middot; dc_sig_v1_eyJpZCI6&hellip;
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-success shrink-0">
            <ShieldCheck size={13} aria-hidden="true" /> signed
          </span>
        </div>
      </div>

      <figcaption className="mt-3 text-xs text-text-tertiary">
        Intercepted, held, approved, executed, recorded.{' '}
        <a href="#live-demo" className="text-text-secondary underline underline-offset-4 decoration-border-hover hover:text-brand transition-colors">
          Run this call against a live instance
        </a>
      </figcaption>
    </figure>
  );
}
