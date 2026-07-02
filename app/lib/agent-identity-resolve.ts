/**
 * Composed sub-agent identities use the form `<parent>:<agent_type>`
 * (e.g. `claude-code:explore`) — see docs/rfcs/2026-06-01-subagent-fleet-identities.md.
 *
 * Governance lookups (pairing, identity) fall back to the base parent so a
 * sub-agent inherits the parent's pairing/permissions when it has none of its
 * own, matching Claude Code's "sub-agents inherit the parent's permissions" model.
 * An exact row for the composed id always wins over the inherited parent row.
 *
 * @param agentId
 * @returns the parent id (substring before the first `:`), or null when the id
 *   is not composed.
 */
export function baseAgentId(agentId: unknown): string | null {
  if (typeof agentId !== 'string') return null;
  const i = agentId.indexOf(':');
  return i > 0 ? agentId.slice(0, i) : null;
}

/**
 * The sub-agent segment of a composed id (`claude-code:explore` → `explore`),
 * or null when the id is not composed.
 */
export function subAgentSegment(agentId: unknown): string | null {
  if (typeof agentId !== 'string') return null;
  const i = agentId.indexOf(':');
  return i > 0 && i < agentId.length - 1 ? agentId.slice(i + 1) : null;
}

/**
 * Order a fleet list so composed sub-agent ids sit directly under their
 * parent (presentational grouping for /agents — RFC rollout step 3).
 *
 * Rows keep their incoming relative order. A composed id whose parent is
 * not in the list (e.g. filtered out by search) stays a top-level row, so
 * grouping never hides an agent.
 */
export function groupFleetByParent<T>(
  list: T[],
  idOf: (item: T) => string
): Array<{ item: T; depth: 0 | 1 }> {
  const ids = new Set(list.map(idOf));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of list) {
    const base = baseAgentId(idOf(item));
    if (base && ids.has(base)) {
      const bucket = childrenOf.get(base);
      if (bucket) bucket.push(item);
      else childrenOf.set(base, [item]);
    } else {
      roots.push(item);
    }
  }
  return roots.flatMap((root) => [
    { item: root, depth: 0 as const },
    ...(childrenOf.get(idOf(root)) || []).map((child) => ({ item: child, depth: 1 as const })),
  ]);
}
