import type { EntityTarget } from './types';

/**
 * True when the event target is (or is inside) an editable surface. Right-click
 * over these must fall through to the NATIVE browser menu so copy/paste/select
 * keep working — DashClaw's audience is developers who rely on them.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return !!target.closest('[contenteditable=""],[contenteditable="true"]');
}

/**
 * Walk up from the event target to the nearest `[data-entity-type]` ancestor and
 * return its `{ type, id }` (plus the element + dataset). Returns null when the
 * cursor isn't over a DashClaw item — in which case the native menu is preserved.
 */
export function resolveEntityTarget(target: EventTarget | null): EntityTarget | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-entity-type]');
  if (!(el instanceof HTMLElement)) return null;
  const type = el.dataset.entityType;
  const id = el.dataset.entityId;
  if (!type || !id) return null;
  return { type, id, el, data: el.dataset };
}
