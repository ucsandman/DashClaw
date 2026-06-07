'use client';

import type { PolicySummaryMode } from '../lib/modesClient';

interface PostureHeaderProps {
  primaryMode: PolicySummaryMode | null;
  modeCount: number;
  agentsTotal: number;
  pendingApprovals: number;
  /** Already-formatted scope, e.g. "All agents". Display-only in v1. */
  scopeLabel: string;
  onChangeMode: () => void;
}

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

/**
 * The posture cockpit headline. Row 1 names the surface and shows the
 * (non-interactive) scope; row 2 is a single prose status line — applied
 * mode, interruption level, agent and pending-approval counts — with the
 * one primary affordance (Change mode) on the right.
 */
export default function PostureHeader({
  primaryMode,
  modeCount,
  agentsTotal,
  pendingApprovals,
  scopeLabel,
  onChangeMode,
}: PostureHeaderProps) {
  const modeName = primaryMode?.name ?? 'Custom policies';
  const extra = modeCount > 1 ? ` +${modeCount - 1}` : '';
  const interruption = primaryMode?.interruptionLevel ?? '—';

  return (
    <div className="space-y-2">
      {/* Row 1: surface label + display-only scope */}
      <div className="flex items-center justify-between gap-3">
        <span className={SECTION_LABEL}>Posture</span>
        <span className="text-xs text-tertiary">{scopeLabel}</span>
      </div>

      {/* Row 2: prose status + primary action */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="text-sm text-secondary">
          <span aria-hidden="true" className="text-brand">&#9679;</span>{' '}
          <span className="text-secondary">
            {modeName}
            {extra}
          </span>
          {' · '}
          <span className="text-secondary">{interruption} interruption</span>
          {' · '}
          <span className="tabular-nums text-secondary">{agentsTotal}</span> agents
          {' · '}
          <span className={pendingApprovals > 0 ? 'tabular-nums text-warning' : 'tabular-nums text-tertiary'}>
            {pendingApprovals} pending
          </span>
        </p>
        <button
          type="button"
          onClick={onChangeMode}
          className="text-xs text-tertiary transition-colors hover:text-secondary motion-reduce:transition-none"
        >
          Change mode &rsaquo;
        </button>
      </div>
    </div>
  );
}
