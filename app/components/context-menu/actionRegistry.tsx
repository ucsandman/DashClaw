import { Eye, Check, Ban, Shield, Trash2, Copy, Link as LinkIcon, ExternalLink } from 'lucide-react';
import type { EntityTarget, MenuItem } from './types';

/**
 * Per-entity detail route. Powers the generic "Open" + "Copy link" actions and
 * the "View" governance action. Phase 1 seeds the entities whose routes are
 * already known; phase 2 extends this alongside `ENTITY_ACTIONS`.
 */
export const DETAIL_PATH: Record<string, (id: string) => string> = {
  decision: (id) => `/decisions/${id}`,
  action: (id) => `/decisions/${id}`,
  agent: (id) => `/agents/${id}`,
  session: (id) => `/sessions/${id}`,
  capability: (id) => `/capabilities/${id}`,
  workflow: (id) => `/workflows/${id}`,
  knowledge: (id) => `/knowledge/${id}`,
};

export function detailHref(entity: EntityTarget): string | null {
  const fn = DETAIL_PATH[entity.type];
  return fn ? fn(entity.id) : null;
}

async function writeClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    /* clipboard denied / unavailable — non-fatal for a convenience action */
  }
}

function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  try {
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

/**
 * Governance action sets keyed by entity type. Each builder reads the entity's
 * dataset (e.g. `data-entity-status`) to decide which actions apply. Routes
 * mirror the live API — verify against `app/api/**` when extending.
 */
const ENTITY_ACTIONS: Record<string, (entity: EntityTarget) => MenuItem[]> = {
  decision: decisionActions,
  action: decisionActions,
};

function decisionActions(entity: EntityTarget): MenuItem[] {
  const items: MenuItem[] = [];
  const pending = entity.data.entityStatus === 'pending_approval';

  if (pending) {
    items.push({
      id: 'approve',
      label: 'Approve',
      icon: Check,
      run: async (ctx) => {
        await fetch(`/api/approvals/${entity.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow' }),
        });
        ctx.refresh();
      },
    });
    items.push({
      id: 'deny',
      label: 'Deny',
      icon: Ban,
      run: async (ctx) => {
        await fetch(`/api/approvals/${entity.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'deny' }),
        });
        ctx.refresh();
      },
    });
  }

  items.push({
    id: 'view',
    label: 'View decision',
    icon: Eye,
    run: (ctx) => ctx.push(`/decisions/${entity.id}`),
  });
  items.push({
    id: 'guard',
    label: 'Run guard',
    icon: Shield,
    run: (ctx) => ctx.push(`/replay/${entity.id}`),
  });
  items.push({
    id: 'delete',
    label: 'Delete',
    icon: Trash2,
    danger: true,
    separatorBefore: true,
    run: async (ctx) => {
      await fetch(`/api/actions?action_id=${encodeURIComponent(entity.id)}`, { method: 'DELETE' });
      ctx.refresh();
    },
  });

  return items;
}

/** Generic actions every entity gets: Copy ID always; Open + Copy link when a detail route exists. */
function genericActions(entity: EntityTarget): MenuItem[] {
  const href = detailHref(entity);
  const items: MenuItem[] = [
    {
      id: 'copy-id',
      label: 'Copy ID',
      icon: Copy,
      separatorBefore: true,
      run: () => writeClipboard(entity.id),
    },
  ];
  if (href) {
    items.push({
      id: 'copy-link',
      label: 'Copy link',
      icon: LinkIcon,
      run: () => writeClipboard(absoluteUrl(href)),
    });
    items.push({
      id: 'open',
      label: 'Open',
      icon: ExternalLink,
      run: (ctx) => ctx.push(href),
    });
  }
  return items;
}

/**
 * Resolve the full ordered menu for an entity: governance actions first, then
 * the generic Copy/Open block. Returns [] when nothing applies (the provider
 * then preserves the native browser menu).
 */
export function getActionsFor(entity: EntityTarget): MenuItem[] {
  const specific = ENTITY_ACTIONS[entity.type]?.(entity) ?? [];
  const generics = genericActions(entity);
  const all = [...specific, ...generics];
  // De-dupe the leading separator if governance actions were empty.
  if (specific.length === 0 && all[0]) all[0] = { ...all[0], separatorBefore: false };
  return all;
}
