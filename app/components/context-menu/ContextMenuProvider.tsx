'use client';

import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isEditableTarget, resolveEntityTarget } from './resolveEntityTarget';
import { getActionsFor, getFallbackActions } from './actionRegistry';
import { ContextMenu } from './ContextMenu';
import type { EntityTarget, MenuItem } from './types';

/**
 * Climb from the event target to the nearest HTMLElement. A right-click can land
 * on an SVG icon or a raw text node — neither is an HTMLElement, and defaulting
 * those to <body> would make "Copy" grab the entire page. The HTML ancestor is
 * the element the user actually clicked.
 */
function nearestHtmlElement(target: EventTarget | null): HTMLElement | null {
  let node: Node | null = target instanceof Node ? target : null;
  while (node && !(node instanceof HTMLElement)) node = node.parentNode;
  return node instanceof HTMLElement ? node : null;
}

/** Synthetic target for a right-click that isn't over a tagged entity. */
function pageTarget(el: EventTarget | null): EntityTarget {
  const node = nearestHtmlElement(el);
  return {
    type: 'page',
    id: typeof window !== 'undefined' ? window.location.pathname : '/',
    el: node ?? (typeof document !== 'undefined' ? document.body : (null as unknown as HTMLElement)),
    data: node?.dataset ?? ({} as DOMStringMap),
  };
}

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

export function ContextMenuProvider({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenState | null>(null);

  const close = useCallback(() => setOpen(null), []);

  const openFor = useCallback((entity: EntityTarget, coords: { x: number; y: number }) => {
    const items = getActionsFor(entity);
    if (items.length === 0) return;
    setOpen({ entity, items, x: coords.x, y: coords.y });
  }, []);

  // Single document-level right-click listener. The whole site is right-clickable:
  // over a tagged DashClaw item we show its governance actions, and EVERYWHERE
  // else (blank space, panels, headings, untagged text) we show a generic
  // fallback menu with at least Copy. The one exception is a text-entry field
  // (input/textarea/contenteditable), which keeps the native menu because
  // browsers block programmatic Paste — a custom menu can't replicate it there.
  useEffect(() => {
    function onContextMenu(e: MouseEvent) {
      if (isEditableTarget(e.target)) return;
      const entity = resolveEntityTarget(e.target);
      const items = entity ? getActionsFor(entity) : getFallbackActions();
      if (items.length === 0) return;
      e.preventDefault();
      setOpen({ entity: entity ?? pageTarget(e.target), items, x: e.clientX, y: e.clientY });
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
