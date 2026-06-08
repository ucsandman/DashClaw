const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function formatRelativeTime(ts: any): string {
  if (!ts) return '—';
  const parsed = new Date(ts).getTime();
  if (!Number.isFinite(parsed)) return '—';
  const diffMs = Date.now() - parsed;
  if (diffMs < 0) return 'now';
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

export function truncateText(text: any, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
}

/**
 * The feed is fetched unscoped so global capability/integration health survive.
 * A row belongs to the current view if no agent is selected, OR it's the
 * selected agent's row, OR it's global infra (capability/integration, agent_id null).
 */
export function matchesAgent(item: any, agentId: any): boolean {
  if (!agentId) return true;
  if (item.source === 'capability' || item.source === 'integration') return true;
  return item.agent_id === agentId;
}

export interface InterventionItem {
  id: string;
  kind: 'approval' | 'loop';
  source: 'action' | 'loop';
  sourceId: string;
  status: string;
  agentId: any;
  agentName: string;
  description: string;
  href: string;
  sortKey: number;
}

/** Urgent subset for the Intervention Queue: pending approvals + critical/high loops. */
export function buildInterventionList(pendingActions: any[], openLoops: any[]): InterventionItem[] {
  const items: InterventionItem[] = [];

  for (const action of pendingActions) {
    items.push({
      id: `approval:${action.action_id}`,
      kind: 'approval',
      source: 'action',
      sourceId: action.action_id,
      status: 'pending_approval',
      agentId: action.agent_id,
      agentName: action.agent_name || action.agent_id,
      description: action.declared_goal || action.action_type || 'Pending action',
      href: '/approvals',
      sortKey: -1,
    });
  }

  for (const loop of openLoops) {
    const isRelevant = loop.loop_type === 'approval' || loop.priority === 'critical' || loop.priority === 'high';
    if (!isRelevant) continue;
    items.push({
      id: `loop:${loop.loop_id}`,
      kind: 'loop',
      source: 'loop',
      sourceId: loop.loop_id,
      status: loop.status || 'open',
      agentId: loop.agent_id,
      agentName: loop.agent_name || loop.agent_id,
      description: loop.description || loop.loop_type || 'Open loop',
      href: '/dashboard',
      sortKey: PRIORITY_ORDER[loop.priority] ?? 2,
    });
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

/** Per-category counts derived client-side from feed items (feed `counts` is severity-keyed, not category-keyed). */
export function categoryCount(feedItems: any[], agentId: any, predicate: (i: any) => boolean): number {
  return feedItems.filter((i) => matchesAgent(i, agentId) && predicate(i)).length;
}
