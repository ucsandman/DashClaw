'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { frameworkQuickstarts } from '../landingData';

/*
 * One tabbed panel replaces the old 8-card quickstart grid. Every tab is the
 * same governance loop landing on the same instance; the tab you pick is just
 * where your agent already runs. Tab order follows frameworkQuickstarts in
 * app/landingData.js; default tab is Claude Code (the most common first
 * integration) when present.
 */

export default function StackQuickstarts() {
  const defaultTab =
    frameworkQuickstarts.find((qs) => qs.id === 'claude-code') || frameworkQuickstarts[0];
  const [activeId, setActiveId] = useState(defaultTab ? defaultTab.id : '');
  const active = frameworkQuickstarts.find((qs) => qs.id === activeId) || defaultTab;
  if (!active) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Agent runtime quickstarts"
        className="flex flex-wrap gap-2 mb-5"
      >
        {frameworkQuickstarts.map((qs) => {
          const isActive = qs.id === active.id;
          return (
            <button
              key={qs.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`quickstart-panel-${qs.id}`}
              id={`quickstart-tab-${qs.id}`}
              onClick={() => setActiveId(qs.id)}
              className={[
                'px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-brand/60 focus:ring-offset-2 focus:ring-offset-surface-primary',
                isActive
                  ? 'bg-brand-subtle text-brand border border-active'
                  : 'bg-surface-secondary text-text-secondary border border-border hover:border-hover hover:text-text-primary',
              ].join(' ')}
            >
              {qs.name}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`quickstart-panel-${active.id}`}
        aria-labelledby={`quickstart-tab-${active.id}`}
        className="rounded-xl border border-border bg-surface-secondary overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-text-primary">{active.name}</span>
          <span className="text-xs text-text-tertiary">{active.label}</span>
        </div>
        <pre
          tabIndex={0}
          aria-label={`${active.name} quickstart code`}
          className="p-5 font-mono text-xs leading-relaxed text-text-secondary overflow-x-auto bg-surface-primary"
        >
          <code>{active.code}</code>
        </pre>
        <div className="px-5 py-3 border-t border-border">
          <Link
            href="/connect"
            className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors"
          >
            Connect this stack in the guided path <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
