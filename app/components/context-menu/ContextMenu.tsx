'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActionContext, EntityTarget, MenuItem } from './types';

interface ContextMenuProps {
  entity: EntityTarget;
  items: MenuItem[];
  x: number;
  y: number;
  push: (href: string) => void;
  refresh: () => void;
  onClose: () => void;
}

const MARGIN = 8;

export function ContextMenu({ entity, items, x, y, push, refresh, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const previouslyFocused = useRef<Element | null>(null);
  const [pos, setPos] = useState({ x, y });

  const enabledIndexes = useMemo(
    () => items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0),
    [items],
  );
  const [activeIndex, setActiveIndex] = useState<number>(() => enabledIndexes[0] ?? 0);

  // Capture focus to restore it on close (right-click usually leaves <body> focused).
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    return () => {
      const el = previouslyFocused.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, []);

  // Flip the menu inward if it would overflow the viewport, then focus the first item.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth) nx = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
    if (ny + rect.height > window.innerHeight) ny = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    setPos({ x: nx, y: ny });
    const first = enabledIndexes[0];
    if (first !== undefined) itemRefs.current[first]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  // Keep the DOM focus on the active item as it moves.
  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  const activate = useCallback(
    async (item: MenuItem) => {
      if (item.disabled) return;
      const ctx: ActionContext = { entity, push, refresh, close: onClose };
      try {
        await item.run(ctx);
      } catch (err) {
        // A failed governed mutation throws (see actionRegistry throwIfNotOk).
        // Surface it instead of closing as if it worked; the handler's own
        // refresh was skipped by the throw, so the stale state is not masked.
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert(`${item.label} failed: ${(err as Error)?.message || 'request failed'}`);
        }
      } finally {
        onClose();
      }
    },
    [entity, push, refresh, onClose],
  );

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      if (enabledIndexes.length === 0) return;
      const cur = enabledIndexes.indexOf(activeIndex);
      const nextPos = (cur + dir + enabledIndexes.length) % enabledIndexes.length;
      const next = enabledIndexes[nextPos];
      if (next !== undefined) setActiveIndex(next);
    },
    [enabledIndexes, activeIndex],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveActive(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveActive(-1);
          break;
        case 'Home': {
          e.preventDefault();
          const first = enabledIndexes[0];
          if (first !== undefined) setActiveIndex(first);
          break;
        }
        case 'End': {
          e.preventDefault();
          const last = enabledIndexes[enabledIndexes.length - 1];
          if (last !== undefined) setActiveIndex(last);
          break;
        }
        case 'Tab':
          // Menus close on Tab rather than trapping focus.
          onClose();
          break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const item = items[activeIndex];
          if (item) void activate(item);
          break;
        }
        default:
          break;
      }
    }
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [items, activeIndex, enabledIndexes, moveActive, activate, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${entity.type}`}
      tabIndex={-1}
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-50 min-w-[184px] overflow-hidden rounded-xl border border-border bg-surface-elevated py-1 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
    >
      {items.map((item, i) => {
        const Icon = item.icon;
        const danger = item.danger;
        return (
          <div key={item.id}>
            {item.separatorBefore && <div role="separator" className="my-1 h-px bg-border" />}
            <button
              ref={(node) => {
                itemRefs.current[i] = node;
              }}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              tabIndex={i === activeIndex ? 0 : -1}
              onClick={() => void activate(item)}
              onMouseEnter={() => !item.disabled && setActiveIndex(i)}
              className={[
                'flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                danger
                  ? 'text-error hover:bg-error-subtle focus:bg-error-subtle'
                  : 'text-secondary hover:bg-white/[0.06] focus:bg-white/[0.06] hover:text-white',
                'outline-none',
              ].join(' ')}
            >
              {Icon && <Icon size={14} className={danger ? 'text-error' : 'text-tertiary'} aria-hidden="true" />}
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
