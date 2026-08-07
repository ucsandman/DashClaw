'use client';

import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from './Badge';

export interface CollapsibleSectionProps {
  /** localStorage key suffix: `dashclaw.section.${id}` */
  id: string;
  /** usually the existing h2 contents */
  title: React.ReactNode;
  /** lucide icon, rendered at size 16 */
  icon?: React.ElementType;
  /** e.g. "text-warning" */
  iconClassName?: string;
  /** Badge in header */
  count?: number;
  /** Badge variant, default 'default' */
  badgeVariant?: string;
  /** right-aligned slot (BulkActionBar, buttons) */
  actions?: React.ReactNode;
  /** second row when open (ListControlsBar) */
  controls?: React.ReactNode;
  /** default true */
  defaultOpen?: boolean;
  /**
   * When true, renders the section open regardless of the collapsed/stored
   * state, without writing to localStorage. For deep links that scroll to
   * content inside a section (e.g. `?policy=` on /policies) — a persisted
   * collapse must not unmount the target the link is trying to reveal.
   * The user's manual toggle still works and still persists as normal; this
   * only overrides what gets *rendered*.
   */
  forceOpen?: boolean;
  /**
   * When true, `controls` and `children` stay mounted while the section is
   * collapsed — hidden via the `hidden` attribute instead of being removed
   * from the tree. Use this when the collapsed content owns state or refs
   * that other parts of the page depend on staying alive (e.g. a ref an
   * outer toolbar calls into) — the default (false) unmounts on collapse,
   * which is right for most lists (search/sort/selection state resets
   * cleanly on reopen) but wrong when something outside the section holds
   * a live reference into it.
   */
  keepMounted?: boolean;
  /**
   * Called with the new open state whenever the human clicks the header
   * button to toggle the section manually — not on the initial localStorage
   * hydration, and not when `forceOpen` alone changes what renders. Use this
   * to release whatever set `forceOpen` (e.g. a one-shot "reveal this
   * section" flag) the moment the human takes over with their own click, so
   * their toggle behaves normally instead of being pinned open forever.
   */
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}

const STORAGE_PREFIX = 'dashclaw.section.';

export function CollapsibleSection({
  id,
  title,
  icon: Icon,
  iconClassName = '',
  count,
  badgeVariant = 'default',
  actions,
  controls,
  defaultOpen = true,
  forceOpen = false,
  keepMounted = false,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen || open;

  // Hydrate from localStorage after mount only — reading it during render
  // would produce a client/server markup mismatch on first paint.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
      if (stored === '0') setOpen(false);
      else if (stored === '1') setOpen(true);
    } catch {
      // localStorage unavailable (private mode, SSR) — keep defaultOpen.
    }
    // Only hydrate on mount for this id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggle = () => {
    // Flip relative to what's actually rendered (`isOpen`), not the raw
    // `open` state. When `forceOpen` is masking a `false` `open` (e.g. the
    // section was collapsed, then a one-shot action forced it open), basing
    // the flip on `open` would toggle it from false to true — invisible to
    // the human, since `isOpen` was already true — so their next click would
    // still be needed to actually close it. Flipping `isOpen` instead means
    // one click always does what the human sees: closes an open section,
    // opens a closed one.
    const next = !isOpen;
    setOpen(next);
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${id}`, next ? '1' : '0');
    } catch {
      // ignore storage failures
    }
    onToggle?.(next);
  };

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={toggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <ChevronDown
            size={16}
            className={`text-tertiary transition-transform ${isOpen ? '' : '-rotate-90'}`}
          />
          {Icon && <Icon size={16} className={iconClassName} />}
          <h2 className="text-sm font-medium text-secondary">{title}</h2>
          {typeof count === 'number' && count > 0 && (
            <Badge variant={badgeVariant} size="xs">{count}</Badge>
          )}
        </button>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>

      {keepMounted ? (
        <div hidden={!isOpen}>
          {controls}
          {children}
        </div>
      ) : (
        isOpen && (
          <>
            {controls}
            {children}
          </>
        )
      )}
    </div>
  );
}
