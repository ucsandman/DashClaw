'use client';

import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isEditableTarget, resolveEntityTarget } from './resolveEntityTarget';
import { getActionsFor } from './actionRegistry';
import { ContextMenu } from './ContextMenu';
import type { EntityTarget, MenuItem } from './types';

interface OpenState {
  entity: EntityTarget;
  items: MenuItem[];
  x: number;
  y: number;
}

interface ContextMenuApi {
  /** Open the menu programmatically (e.g. from a keyboard shortcut on a focused row). */
  openFor: (entity: EntityTarget, coords: { x: number; y: number }) => void;
  close: () => void;
}

const ContextMenuContext = createContext<ContextMenuApi | null>(null);

export function useContextMenu(): ContextMenuApi {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) throw new Error('useContextMenu must be used within ContextMenuProvider');
  return ctx;
}

export function ContextMenuProvider({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenState | null>(null);

  const close = useCallback(() => setOpen(null), []);

  const openFor = useCallback((entity: EntityTarget, coords: { x: number; y: number }) => {
    const items = getActionsFor(entity);
    if (items.length === 0) return;
    setOpen({ entity, items, x: coords.x, y: coords.y });
  }, []);

  // Single document-level right-click listener. Augment-only: we intercept ONLY
  // when the cursor is over a registered DashClaw item; everything else (blank
  // space, text, inputs) keeps the native browser menu.
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (isEditableTarget(e.target)) return;
      const entity = resolveEntityTarget(e.target);
      if (!entity) return;
      const items = getActionsFor(entity);
      if (items.length === 0) return;
      e.preventDefault();
      setOpen({ entity, items, x: e.clientX, y: e.clientY });
    }
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Close on scroll/resize so a stale menu never floats over moved content.
  useEffect(() => {
    if (!open) return;
    function dismiss() {
      setOpen(null);
    }
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const api = useMemo<ContextMenuApi>(() => ({ openFor, close }), [openFor, close]);

  return (
    <ContextMenuContext.Provider value={api}>
      {children}
      {open && (
        <ContextMenu
          entity={open.entity}
          items={open.items}
          x={open.x}
          y={open.y}
          push={(href) => router.push(href)}
          refresh={() => router.refresh()}
          onClose={close}
        />
      )}
    </ContextMenuContext.Provider>
  );
}
