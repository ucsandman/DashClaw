import {
  Eye,
  Check,
  CheckCheck,
  Ban,
  Shield,
  Trash2,
  Copy,
  Link as LinkIcon,
  ExternalLink,
  RefreshCw,
  Clock,
  ShieldOff,
  Archive,
  MailOpen,
  XCircle,
} from 'lucide-react';
import type { ActionContext, EntityTarget, MenuItem } from './types';

/**
 * Per-entity detail route. Powers the generic "Open" + "Copy link" actions and
 * the "View" governance action. Only entities with a real detail page appear
 * here; others get Copy ID only.
 */
export const DETAIL_PATH: Record<string, (id: string) => string> = {
  decision: (id) => `/decisions/${id}`,
  action: (id) => `/decisions/${id}`,
  agent: (id) => `/agents/${id}`,
  session: (id) => `/sessions/${id}`,
  capability: (id) => `/capabilities/${id}`,
  workflow: (id) => `/workflows/${id}`,
  knowledge: (id) => `/knowledge/${id}`,
  // Policy has no detail route — deep-link to the cockpit and highlight the match.
  // The id may be a free-form policy label, so encode it.
  policy: (id) => `/policies?policy=${encodeURIComponent(id)}`,
  codeSession: (id) => `/code-sessions/${id}`,
  modelStrategy: (id) => `/model-strategies/${id}`,
};

/** Resolve a detail path from a bare (type, id) — used by EntityLink, which has no DOM target. */
export function detailPathFor(type: string, id: string): string | null {
  const fn = DETAIL_PATH[type];
  return fn ? fn(id) : null;
}

export function detailHref(entity: EntityTarget): string | null {
  return detailPathFor(entity.type, entity.id);
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
 * Visible text of the element under the cursor. `innerText` reflects rendered
 * text (and respects line breaks) in a real browser; `textContent` is the
 * jsdom/SSR fallback since jsdom doesn't implement `innerText`.
 */
function elementText(el: HTMLElement | null | undefined): string {
  if (!el) return '';
  let text = '';
  try {
    if (typeof el.innerText === 'string') text = el.innerText.trim();
  } catch {
    /* jsdom: innerText getter not implemented — fall through to textContent */
  }
  if (!text) text = (el.textContent ?? '').trim();
  return text;
}

function promptReason(message: string): string | null {
  if (typeof window === 'undefined' || typeof window.prompt !== 'function') return null;
  const reason = window.prompt(message);
  return reason && reason.trim() ? reason.trim() : null;
}

async function postJson(url: string, body: unknown): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson(url: string, body: unknown): Promise<void> {
  await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function del(url: string): Promise<void> {
  await fetch(url, { method: 'DELETE' });
}

const enc = encodeURIComponent;

/**
 * Governance action sets keyed by entity type. Each builder reads the entity's
 * dataset (e.g. `data-entity-status`) to decide which actions apply. Routes
 * are verified against the live API under `app/api/**`.
 */
const ENTITY_ACTIONS: Record<string, (entity: EntityTarget) => MenuItem[]> = {
  decision: decisionActions,
  action: decisionActions,
  assumption: assumptionActions,
  loop: loopActions,
  capability: capabilityActions,
  agent: agentActions,
  policy: policyActions,
  webhook: webhookActions,
  apiKey: apiKeyActions,
  secret: secretActions,
  postureFinding: postureActions,
  knowledge: knowledgeActions,
  message: messageActions,
  session: sessionActions,
  codeSession: codeSessionActions,
  workflow: workflowActions,
  modelStrategy: modelStrategyActions,
  prompt: promptActions,
  teamMember: teamMemberActions,
};

function decisionActions(entity: EntityTarget): MenuItem[] {
  const items: MenuItem[] = [];
  if (entity.data.entityStatus === 'pending_approval') {
    items.push({
      id: 'approve',
      label: 'Approve',
      icon: Check,
      run: async (ctx) => {
        await postJson(`/api/approvals/${entity.id}`, { decision: 'allow' });
        ctx.refresh();
      },
    });
    items.push({
      id: 'deny',
      label: 'Deny',
      icon: Ban,
      run: async (ctx) => {
        await postJson(`/api/approvals/${entity.id}`, { decision: 'deny' });
        ctx.refresh();
      },
    });
  }
  items.push({ id: 'view', label: 'View decision', icon: Eye, run: (ctx) => ctx.push(`/decisions/${entity.id}`) });
  items.push({ id: 'guard', label: 'Open replay', icon: Shield, run: (ctx) => ctx.push(`/replay/${entity.id}`) });
  items.push({
    id: 'delete',
    label: 'Delete',
    icon: Trash2,
    danger: true,
    separatorBefore: true,
    run: async (ctx) => {
      await del(`/api/actions?action_id=${enc(entity.id)}`);
      ctx.refresh();
    },
  });
  return items;
}

function assumptionActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'validate',
      label: 'Validate',
      icon: Check,
      run: async (ctx) => {
        await patchJson(`/api/assumptions/${entity.id}`, { validated: true });
        ctx.refresh();
      },
    },
    {
      id: 'invalidate',
      label: 'Invalidate…',
      icon: XCircle,
      danger: true,
      run: async (ctx) => {
        const reason = promptReason('Reason for invalidating this assumption?');
        if (!reason) return;
        await patchJson(`/api/assumptions/${entity.id}`, { validated: false, invalidated_reason: reason });
        ctx.refresh();
      },
    },
  ];
}

function loopActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'resolve',
      label: 'Resolve…',
      icon: CheckCheck,
      run: async (ctx) => {
        const resolution = promptReason('Resolution note?');
        if (!resolution) return;
        await patchJson(`/api/actions/loops/${entity.id}`, { status: 'resolved', resolution });
        ctx.refresh();
      },
    },
    {
      id: 'cancel',
      label: 'Cancel',
      icon: Ban,
      run: async (ctx) => {
        await patchJson(`/api/actions/loops/${entity.id}`, { status: 'cancelled' });
        ctx.refresh();
      },
    },
  ];
}

function capabilityActions(entity: EntityTarget): MenuItem[] {
  return [
    { id: 'view', label: 'View capability', icon: Eye, run: (ctx) => ctx.push(`/capabilities/${entity.id}`) },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      run: async (ctx) => {
        await del(`/api/capabilities/${entity.id}`);
        ctx.refresh();
      },
    },
  ];
}

function agentActions(entity: EntityTarget): MenuItem[] {
  return [{ id: 'inspect', label: 'Inspect agent', icon: Eye, run: (ctx) => ctx.push(`/agents/${entity.id}`) }];
}

function policyActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'delete',
      label: 'Delete policy',
      icon: Trash2,
      danger: true,
      run: async (ctx) => {
        await del(`/api/policies?id=${enc(entity.id)}`);
        ctx.refresh();
      },
    },
  ];
}

function webhookActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'delete',
      label: 'Delete webhook',
      icon: Trash2,
      danger: true,
      run: async (ctx) => {
        await del(`/api/webhooks?id=${enc(entity.id)}`);
        ctx.refresh();
      },
    },
  ];
}

function apiKeyActions(entity: EntityTarget): MenuItem[] {
  if (entity.data.entityStatus === 'revoked') return [];
  return [
    {
      id: 'revoke',
      label: 'Revoke key',
      icon: Ban,
      danger: true,
      run: async (ctx) => {
        await del(`/api/keys?id=${enc(entity.id)}`);
        ctx.refresh();
      },
    },
  ];
}

function secretActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'mark-rotated',
      label: 'Mark rotated',
      icon: RefreshCw,
      run: async (ctx) => {
        await patchJson(`/api/secrets/${entity.id}`, { last_rotated_at: new Date().toISOString() });
        ctx.refresh();
      },
    },
    {
      id: 'delete',
      label: 'Delete secret',
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      run: async (ctx) => {
        await del(`/api/secrets/${entity.id}`);
        ctx.refresh();
      },
    },
  ];
}

function postureActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'snooze',
      label: 'Snooze',
      icon: Clock,
      run: async (ctx) => {
        await postJson(`/api/posture/findings/${enc(entity.id)}/resolve`, { action: 'snooze' });
        ctx.refresh();
      },
    },
    {
      id: 'accept-risk',
      label: 'Accept risk',
      icon: ShieldOff,
      run: async (ctx) => {
        await postJson(`/api/posture/findings/${enc(entity.id)}/resolve`, { action: 'accept_risk' });
        ctx.refresh();
      },
    },
  ];
}

function knowledgeActions(entity: EntityTarget): MenuItem[] {
  return [
    { id: 'view', label: 'View collection', icon: Eye, run: (ctx) => ctx.push(`/knowledge/${entity.id}`) },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      run: async (ctx) => {
        await del(`/api/knowledge/collections/${entity.id}`);
        ctx.refresh();
      },
    },
  ];
}

function messageActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'mark-read',
      label: 'Mark read',
      icon: MailOpen,
      run: async (ctx) => {
        await patchJson('/api/messages', { message_ids: [entity.id], action: 'read' });
        ctx.refresh();
      },
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: Archive,
      run: async (ctx) => {
        await patchJson('/api/messages', { message_ids: [entity.id], action: 'archive' });
        ctx.refresh();
      },
    },
  ];
}

function sessionActions(entity: EntityTarget): MenuItem[] {
  return [{ id: 'view', label: 'View session', icon: Eye, run: (ctx) => ctx.push(`/sessions/${entity.id}`) }];
}

// codeSession entity ids on /code-sessions rows are project ids (cp_…) — the
// delete removes the project and all its sessions via the projects route.
function codeSessionActions(entity: EntityTarget): MenuItem[] {
  return [
    { id: 'view', label: 'View project', icon: Eye, run: (ctx) => ctx.push(`/code-sessions/${entity.id}`) },
    {
      id: 'delete',
      label: 'Delete project',
      icon: Trash2,
      danger: true,
      separatorBefore: true,
      run: async (ctx) => {
        if (typeof window !== 'undefined' && !window.confirm('Delete this project and all its sessions? This cannot be undone.')) return;
        await del(`/api/code-sessions/projects/${enc(entity.id)}`);
        ctx.refresh();
      },
    },
  ];
}

function workflowActions(entity: EntityTarget): MenuItem[] {
  return [{ id: 'view', label: 'View workflow', icon: Eye, run: (ctx) => ctx.push(`/workflows/${entity.id}`) }];
}

function modelStrategyActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'delete',
      label: 'Delete strategy',
      icon: Trash2,
      danger: true,
      run: async (ctx) => {
        await del(`/api/model-strategies/${enc(entity.id)}`);
        ctx.refresh();
      },
    },
  ];
}

function promptActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'delete',
      label: 'Delete template',
      icon: Trash2,
      danger: true,
      run: async (ctx) => {
        await del(`/api/prompts/templates/${enc(entity.id)}`);
        ctx.refresh();
      },
    },
  ];
}

function teamMemberActions(entity: EntityTarget): MenuItem[] {
  return [
    {
      id: 'remove',
      label: 'Remove member',
      icon: Trash2,
      danger: true,
      run: async (ctx) => {
        await del(`/api/team/${enc(entity.id)}`);
        ctx.refresh();
      },
    },
  ];
}

/** Generic actions every entity gets: Copy ID always; Open + Copy link when a detail route exists. */
function genericActions(entity: EntityTarget): MenuItem[] {
  const href = detailHref(entity);
  const items: MenuItem[] = [
    { id: 'copy-id', label: 'Copy ID', icon: Copy, separatorBefore: true, run: () => writeClipboard(entity.id) },
  ];
  if (href) {
    items.push({ id: 'copy-link', label: 'Copy link', icon: LinkIcon, run: () => writeClipboard(absoluteUrl(href)) });
    items.push({ id: 'open', label: 'Open', icon: ExternalLink, run: (ctx) => ctx.push(href) });
  }
  return items;
}

/**
 * Resolve the full ordered menu for an entity: governance actions first, then
 * the generic Copy/Open block. Returns [] when nothing applies (the provider
 * then preserves the native browser menu). Exported `ActionContext` re-export
 * keeps the import surface in one place.
 */
export function getActionsFor(entity: EntityTarget): MenuItem[] {
  const specific = ENTITY_ACTIONS[entity.type]?.(entity) ?? [];
  const generics = genericActions(entity);
  const all = [...specific, ...generics];
  if (specific.length === 0 && all[0]) all[0] = { ...all[0], separatorBefore: false };
  return all;
}

/**
 * Generic page-level actions for a right-click that ISN'T over a specific entity
 * (blank space, panels, headings, untagged content). Guarantees the menu is never
 * empty so the whole site is right-clickable — at minimum a Copy. (Text-entry
 * fields are the one exception: the provider lets them keep the native menu,
 * because browsers block programmatic Paste and a custom menu can't replicate it.)
 */
export function getFallbackActions(): MenuItem[] {
  return [
    {
      id: 'copy',
      label: 'Copy',
      icon: Copy,
      run: (ctx) => {
        const selection = typeof window !== 'undefined' ? String(window.getSelection() ?? '').trim() : '';
        // Highlighted text wins; otherwise copy the visible text of the element
        // under the cursor. Only fall back to the page link when there's genuinely
        // no text to copy (that fallback is what "Copy page link" already does).
        const underCursor = elementText(ctx.entity.el);
        const href = typeof window !== 'undefined' ? window.location.pathname : '/';
        writeClipboard(selection || underCursor || absoluteUrl(href));
      },
    },
    {
      id: 'copy-link',
      label: 'Copy page link',
      icon: LinkIcon,
      run: () => writeClipboard(typeof window !== 'undefined' ? window.location.href : ''),
    },
    {
      id: 'reload',
      label: 'Reload',
      icon: RefreshCw,
      separatorBefore: true,
      run: (ctx) => ctx.refresh(),
    },
  ];
}

export type { ActionContext };
