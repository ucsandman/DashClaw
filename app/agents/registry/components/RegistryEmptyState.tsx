'use client';

import Link from 'next/link';
import { Boxes, Plus } from 'lucide-react';

const EXAMPLE_STEPS = [
  {
    label: 'Create a capability',
    value: 'The operation a provider is allowed to perform — endpoint, auth, and schema.',
    href: '/capabilities/new',
    linkLabel: 'Create one at /capabilities/new',
  },
  {
    label: 'Register the provider + group the capability',
    value: "Register 'Acme Enrichment API' (risk medium, budget $2/call), then group enrich_company under it.",
  },
  {
    label: 'Invoke',
    value: "A Fleet agent calls enrich_company with { domain: 'foo.com' } — your guard runs, risk is scored, then Acme is called (or the call is held for approval).",
  },
];

interface RegistryEmptyStateProps {
  onRegister?: () => void;
}

/**
 * Educational empty state for the registered-agents list. Explains what the
 * Registry is (outbound delegation), how it differs from the Fleet, and walks
 * through a concrete worked example before offering the register CTA.
 */
export default function RegistryEmptyState({ onRegister }: RegistryEmptyStateProps) {
  return (
    <div className="px-5 py-8">
      <div className="flex flex-col items-center text-center">
        <Boxes size={28} className="mb-3 text-disabled" strokeWidth={1.5} aria-hidden="true" />
        <div className="text-sm font-medium text-secondary">No registered agents yet</div>
        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-tertiary">
          Register an external service or sub-agent that DashClaw can invoke for you — each call is governed,
          risk-scored, and recorded.
        </p>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-tertiary">
          <span className="text-secondary">Different from the </span>
          <Link href="/agents" className="text-brand transition-colors hover:underline">
            Fleet
          </Link>
          : the Fleet is your agents reporting actions TO DashClaw (inbound); the Registry is external providers
          DashClaw INVOKES (outbound).
        </p>
      </div>

      <div className="mx-auto mt-5 max-w-md rounded-lg border border-border bg-surface-tertiary p-4 text-left">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
          A worked example
        </div>
        <ol className="space-y-3">
          {EXAMPLE_STEPS.map((step, i) => (
            <li key={step.label} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold tabular-nums text-brand">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-white">{step.label}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-tertiary">{step.value}</p>
                {step.href && (
                  <Link href={step.href} className="mt-0.5 inline-block text-xs text-brand transition-colors hover:underline">
                    {step.linkLabel}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mx-auto mt-4 max-w-md rounded-lg border border-border bg-surface-tertiary p-4 text-left">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
          Or seed a working demo
        </div>
        <p className="text-xs leading-relaxed text-tertiary">
          Creates an echo capability, registers a demo provider, and groups them — one governed invoke away from
          seeing the whole loop in /decisions.
        </p>
        <code className="mt-2 block overflow-x-auto rounded-md border border-border bg-surface-secondary px-3 py-2 font-mono text-[11px] text-secondary">
          node scripts/seed-registry-demo.mjs
        </code>
      </div>

      <div className="mt-5 flex justify-center">
        <button
          onClick={onRegister}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
        >
          <Plus size={12} aria-hidden="true" /> Register agent
        </button>
      </div>
    </div>
  );
}
