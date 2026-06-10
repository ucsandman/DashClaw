'use client';

import Link from 'next/link';
import { Info, ChevronDown } from 'lucide-react';
import { Card } from '../../../components/ui/Card';

const STEPS = [
  {
    title: 'Register a provider',
    body: 'Add the external service or sub-agent: its endpoint, auth type, baseline risk class, and a default per-call budget.',
  },
  {
    title: 'Group the capabilities it may run',
    body: 'Define the named capabilities (the operations) this provider is allowed to perform on your behalf — created at /capabilities/new, then grouped under the agent here.',
  },
  {
    title: 'Invoke a capability',
    body: 'DashClaw resolves auth, scores risk, and runs your guard policy (allow / require approval / block), then calls the provider and records the action in /decisions.',
  },
];

/**
 * Always-visible, collapsible explainer for the Agent Registry. The Registry is
 * OUTBOUND governed delegation — the inverse of the Fleet (inbound/observed).
 * Content here is prose a human reads to understand, so it is rendered directly.
 */
export default function HowItWorks() {
  return (
    <Card hover={false} className="mb-6">
      <details className="group" open>
        <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3 list-none [&::-webkit-details-marker]:hidden">
          <Info size={14} className="shrink-0 text-brand" aria-hidden="true" />
          <span className="text-sm font-semibold text-white">How it works</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="ml-auto shrink-0 text-tertiary transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-border px-5 py-4">
          <ol className="space-y-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold tabular-nums text-brand">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">{step.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-tertiary">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-secondary">
            <span className="font-medium text-white">Different from the </span>
            <Link href="/agents" className="font-medium text-brand transition-colors hover:underline">
              Fleet
            </Link>
            <span>
              : the Fleet is your agents reporting actions TO DashClaw (inbound); the Registry is external
              providers DashClaw INVOKES (outbound).
            </span>
          </p>
        </div>
      </details>
    </Card>
  );
}
