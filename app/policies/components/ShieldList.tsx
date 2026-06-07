'use client';

import type { PolicySummaryShield } from '../lib/modesClient';
import Disclosure from './Disclosure';

interface ShieldListProps {
  shields: PolicySummaryShield[];
  onToggle: (id: string, next: boolean) => void;
  /** Shield currently toggling — its switch is disabled. */
  busyId?: string | null;
}

const SECTION_LABEL = 'text-xs font-mono uppercase tracking-wider text-tertiary';

function ShieldRow({
  shield,
  onToggle,
  busy,
}: {
  shield: PolicySummaryShield;
  onToggle: (id: string, next: boolean) => void;
  busy: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          aria-hidden="true"
          className={shield.on ? 'shrink-0 text-brand' : 'shrink-0 text-tertiary'}
        >
          {shield.on ? '●' : '○'}
        </span>
        <span className="min-w-0">
          <span className="text-sm text-secondary">{shield.name}</span>
          <span className="ml-2 truncate text-xs text-tertiary">{shield.description}</span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {shield.on && (
          <span className="text-xs tabular-nums text-tertiary">
            {shield.fired30d > 0 ? <>fired {shield.fired30d}&times; &middot; 30d</> : 'quiet'}
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggle(shield.id, !shield.on)}
          disabled={busy}
          role="switch"
          aria-checked={shield.on}
          aria-label={`${shield.on ? 'Disable' : 'Enable'} ${shield.name}`}
          className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-surface-primary ${
            shield.on ? 'bg-brand' : 'bg-white/10'
          } ${busy ? 'opacity-50' : ''}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all motion-reduce:transition-none ${
              shield.on ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>
    </li>
  );
}

/**
 * The active-shields section. ON shields render inline; OFF shields live
 * behind a `manage` disclosure so the default view shows only what is
 * currently protecting the fleet. No nested cards — divider-separated rows.
 */
export default function ShieldList({ shields, onToggle, busyId }: ShieldListProps) {
  const on = shields.filter((s) => s.on);
  const off = shields.filter((s) => !s.on);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className={SECTION_LABEL}>Shields</span>
        <span className="text-xs tabular-nums text-tertiary">
          {on.length} of {shields.length} on
        </span>
      </div>

      {on.length > 0 ? (
        <ul className="mt-2 divide-y divide-border">
          {on.map((s) => (
            <ShieldRow key={s.id} shield={s} onToggle={onToggle} busy={busyId === s.id} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-tertiary">No shields on</p>
      )}

      {off.length > 0 && (
        <div className="mt-2">
          <Disclosure tone="plain" summary="manage">
            <ul className="divide-y divide-border">
              {off.map((s) => (
                <ShieldRow key={s.id} shield={s} onToggle={onToggle} busy={busyId === s.id} />
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
