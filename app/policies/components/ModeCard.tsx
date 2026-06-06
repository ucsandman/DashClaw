'use client';

import type { PolicyModeSummary } from '../lib/modesClient';

const LEVEL: Record<string, { label: string; dot: string }> = {
  low: { label: 'Low interruption', dot: 'bg-success' },
  medium: { label: 'Medium interruption', dot: 'bg-warning' },
  high: { label: 'High interruption', dot: 'bg-error' },
};

const LEVEL_FALLBACK = { label: 'Medium interruption', dot: 'bg-warning' };

interface ModeCardProps {
  mode: PolicyModeSummary;
  selected: boolean;
  onSelect: () => void;
}

export default function ModeCard({ mode, selected, onSelect }: ModeCardProps) {
  const level = LEVEL[mode.interruptionLevel] ?? LEVEL_FALLBACK;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex w-full flex-col rounded-xl border bg-surface-secondary p-5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-surface-secondary ${
        selected ? 'border-brand/40' : 'border-border hover:border-border-hover'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${selected ? 'text-white' : 'text-secondary group-hover:text-white'}`}>
            {mode.name}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-tertiary">{mode.purpose}</p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-tertiary">
          {mode.policy_count} {mode.policy_count === 1 ? 'policy' : 'policies'}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-secondary">
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${level.dot}`} />
          {level.label}
        </span>
        <span className="truncate text-[11px] italic text-tertiary" title={mode.uxPromise}>
          {mode.uxPromise}
        </span>
      </div>
    </button>
  );
}
