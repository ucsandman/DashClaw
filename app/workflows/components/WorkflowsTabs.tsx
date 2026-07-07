'use client';

import Link from 'next/link';
import { Cpu, ArrowRight } from 'lucide-react';

// Sub-route tabs for the model-strategies surface. Real routes (not ?tab=) so
// deep links, the demo matcher (/workflows/:path*), and redirects from the
// retired /model-strategies page all work.
const TABS = [
  { key: 'strategies', href: '/workflows/strategies', label: 'Model strategies', icon: Cpu },
] as const;

export default function WorkflowsTabs({ active }: { active: 'templates' | 'strategies' }) {
  return (
    <nav aria-label="Workflows sections" className="mb-4 flex items-center gap-1 border-b border-border">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 ${
              isActive ? 'text-white' : 'text-tertiary hover:text-secondary'
            }`}
          >
            <Icon size={14} aria-hidden="true" />
            {t.label}
            {isActive && (
              <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />
            )}
          </Link>
        );
      })}
      {/* Org-wide run history is the decisions ledger filtered to workflow
          executions — a deliberate non-tab (owner roadmap item 6: no third
          parallel runs surface; the ledger is the runs view). */}
      <Link
        href="/decisions?action_type=workflow_execute"
        className="ml-auto flex items-center gap-1 px-2 py-2.5 text-xs text-tertiary transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
      >
        All runs in the decisions ledger
        <ArrowRight size={12} aria-hidden="true" />
      </Link>
    </nav>
  );
}
