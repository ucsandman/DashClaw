'use client';

import type { ElementType } from 'react';
import { X } from 'lucide-react';

export interface BulkAction {
  id: string;
  label: string;
  icon?: ElementType;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface BulkActionBarProps {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}

/**
 * The selection toolbar. Designed to be passed into `PageLayout`'s `actions`
 * slot — it renders nothing at zero selection, so pages can mount it
 * unconditionally. The count lives in an `aria-live` region so screen readers
 * hear the selection change.
 */
export function BulkActionBar({ count, actions, onClear }: BulkActionBarProps) {
  if (count <= 0) return null;
  return (
    <div className="flex items-center gap-2" role="region" aria-label="Bulk actions">
      <span aria-live="polite" className="text-xs tabular-nums text-tertiary">
        {count} selected
      </span>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className={[
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              action.danger
                ? 'border-error/30 text-error hover:bg-error-subtle'
                : 'border-border text-secondary hover:border-border-hover hover:text-white',
            ].join(' ')}
          >
            {Icon && <Icon size={13} aria-hidden="true" />}
            {action.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="inline-flex items-center rounded-md px-1.5 py-1 text-xs text-tertiary transition-colors hover:text-white"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
