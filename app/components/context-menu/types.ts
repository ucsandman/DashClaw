import type { ElementType } from 'react';

/**
 * A DashClaw entity resolved from the DOM under the cursor. Pages tag their
 * item rows with `data-entity-type` + `data-entity-id` (and optional
 * `data-entity-*` fields like `data-entity-status`); the context menu reads
 * those to decide which governance actions apply.
 */
export interface EntityTarget {
  type: string;
  id: string;
  el: HTMLElement;
  /** The element's full dataset (e.g. `entityStatus`, `entityLabel`). */
  data: DOMStringMap;
}

/**
 * Runtime context handed to a menu item's `run` so it can navigate, refresh the
 * underlying page, and close the menu without each action re-deriving them.
 */
export interface ActionContext {
  entity: EntityTarget;
  push: (href: string) => void;
  refresh: () => void;
  close: () => void;
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: ElementType;
  /** Visual + keyboard separator rendered before this item. */
  separatorBefore?: boolean;
  danger?: boolean;
  disabled?: boolean;
  run: (ctx: ActionContext) => void | Promise<void>;
}
