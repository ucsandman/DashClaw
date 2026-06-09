'use client';

import { useState } from 'react';
import { ShieldAlert, DollarSign, Activity } from 'lucide-react';

/*
 * Three governance use cases, surfaced as tabs so all three sit in one
 * viewport height. Each tab pairs an outcome-first headline with a short
 * focused code block (6-10 lines) and a "What DashClaw did" caption.
 *
 * Body fields in the code blocks are snake_case to match the canonical
 * server schema (app/api/guard/route.js) and the Quick Integration
 * snippets that were corrected in app/self-host/SetupTabs.js.
 */

const USE_CASES = [
  {
    id: 'deploys',
    label: 'Deploys',
    icon: ShieldAlert,
    title: 'Stop runaway deployments',
    outcome: 'One approval before production, full audit trail after.',
    code: `await claw.guard({
  agent_id: 'deploy-bot',
  action_type: 'deploy',
  risk_score: 92,
  declared_goal: 'Ship auth-service v2.1 to prod',
});`,
    caption:
      'Matched the production_deploy policy, paused the action, routed to the on-call engineer, recorded the approval.',
  },
  {
    id: 'spend',
    label: 'Spend',
    icon: DollarSign,
    title: 'Cap what agents can spend',
    outcome: 'Hard ceiling on API and tool spend per run, with policy-level overrides.',
    code: `await claw.guard({
  agent_id: 'research-agent',
  action_type: 'external_api_call',
  risk_score: 58,
  declared_goal: 'Run a 50k-token GPT-4 pass over the user backlog',
});`,
    caption:
      'Checked the budget policy for this agent, blocked the call once the run-level token ceiling was reached, opened a loop on the dashboard.',
  },
  {
    id: 'drift',
    label: 'Drift',
    icon: Activity,
    title: 'Catch when agents lie to themselves',
    outcome: 'Assumption drift detection on agent reasoning vs observed reality.',
    code: `await claw.recordAssumption({
  action_id,
  assumption: 'users.email column is unique',
});`,
    caption:
      'Recorded the assumption against the action. When a later run observed a duplicate, DashClaw flagged drift before the agent acted on the bad belief.',
  },
];

export default function UseCases() {
  const first = USE_CASES[0];
  const [activeId, setActiveId] = useState(first ? first.id : '');
  const active = USE_CASES.find((u) => u.id === activeId) || first;
  if (!active) return null;
  const ActiveIcon = active.icon;

  return (
    <section
      aria-labelledby="use-cases-heading"
      className="py-24 px-6 border-t border-border bg-surface-primary"
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2
            id="use-cases-heading"
            className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary"
          >
            What developers use DashClaw for
          </h2>
          <p className="mt-3 text-text-secondary">
            Three patterns that come up in every production agent stack.
          </p>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Governance use cases"
          className="flex flex-wrap justify-center gap-2 mb-8"
        >
          {USE_CASES.map((u) => {
            const Icon = u.icon;
            const isActive = u.id === activeId;
            return (
              <button
                key={u.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`use-case-panel-${u.id}`}
                id={`use-case-tab-${u.id}`}
                onClick={() => setActiveId(u.id)}
                className={[
                  'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-brand/60 focus:ring-offset-2 focus:ring-offset-surface-primary',
                  isActive
                    ? 'bg-brand-subtle text-brand border border-border-active'
                    : 'bg-surface-secondary text-text-secondary border border-border hover:border-border-hover hover:text-text-primary',
                ].join(' ')}
              >
                <Icon size={14} aria-hidden="true" />
                {u.label}
              </button>
            );
          })}
        </div>

        {/* Active panel */}
        <div
          role="tabpanel"
          id={`use-case-panel-${active.id}`}
          aria-labelledby={`use-case-tab-${active.id}`}
          className="rounded-2xl border border-border bg-surface-secondary overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]"
        >
          <div className="px-6 py-5 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-subtle border border-border-active flex items-center justify-center shrink-0">
              <ActiveIcon size={18} className="text-brand" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-text-primary tracking-tight">{active.title}</h3>
              <p className="mt-1 text-sm text-text-secondary leading-relaxed">{active.outcome}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5">
            <pre
              tabIndex={0}
              aria-label={`${active.title} code example`}
              className="lg:col-span-3 p-5 text-xs leading-relaxed font-mono text-text-secondary bg-surface-primary border-b lg:border-b-0 lg:border-r border-border overflow-x-auto"
            >
              <code>{active.code}</code>
            </pre>
            <div className="lg:col-span-2 p-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary mb-2">
                What DashClaw did
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">{active.caption}</p>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-text-tertiary">
          Every governed action also lands in the evidence ledger, ready for compliance review without a separate audit pipeline.
        </p>
      </div>
    </section>
  );
}
