import type { Row, SqlClient } from './actions.repository.shared';

interface ActionTraceData {
  action: Row;
  assumptions: Row[];
  loops: Row[];
  relatedActions: Row[];
  subActions: Row[];
  parentChain: Row[];
}

async function fetchParentChain(
  sql: SqlClient,
  orgId: string,
  actionId: string,
  initialParentId: unknown,
): Promise<Row[]> {
  const parentChain: Row[] = [];
  let currentParentId = initialParentId;
  const visited = new Set([actionId]);
  while (currentParentId && !visited.has(currentParentId as string) && parentChain.length < 10) {
    visited.add(currentParentId as string);
    const parentResult = await sql`
      SELECT action_id, agent_id, agent_name, action_type, declared_goal, status,
             risk_score, timestamp_start, error_message, parent_action_id
      FROM action_records WHERE action_id = ${currentParentId} AND org_id = ${orgId}
    `;
    if (parentResult.length === 0) break;
    const parent = parentResult[0];
    if (!parent) break;
    parentChain.push(parent);
    currentParentId = parent.parent_action_id;
  }
  return parentChain;
}

/**
 * Fetch all data required for an action trace (parent chain, assumptions, loops, related actions, sub-actions).
 */
export async function getActionTraceData(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<ActionTraceData | null> {
  // Fetch the target action first to get metadata for related queries
  const actions = await sql`
    SELECT * FROM action_records WHERE action_id = ${actionId} AND org_id = ${orgId}
  `;

  if (actions.length === 0) return null;
  const action = actions[0];
  if (!action) return null;

  // Parallel fetch of direct associations and related signals
  const [assumptions, loops, relatedActions, subActions] = await Promise.all([
    sql`SELECT * FROM assumptions WHERE action_id = ${actionId} AND org_id = ${orgId} ORDER BY created_at ASC`,
    sql`SELECT * FROM open_loops WHERE action_id = ${actionId} AND org_id = ${orgId} ORDER BY created_at ASC`,
    sql`
      SELECT action_id, agent_id, agent_name, action_type, declared_goal, status,
             risk_score, timestamp_start, error_message
      FROM action_records
      WHERE action_id != ${actionId}
        AND org_id = ${orgId}
        AND (
          agent_id = ${action.agent_id}
          OR (systems_touched = ${action.systems_touched} AND systems_touched IS NOT NULL AND systems_touched != '[]')
        )
        AND timestamp_start::timestamptz > ${action.timestamp_start}::timestamptz - INTERVAL '1 hour'
        AND timestamp_start::timestamptz < ${action.timestamp_start}::timestamptz + INTERVAL '1 hour'
      ORDER BY timestamp_start DESC
      LIMIT 20
    `,
    sql`
      SELECT action_id, agent_id, agent_name, action_type, declared_goal, status,
             risk_score, timestamp_start, error_message
      FROM action_records
      WHERE parent_action_id = ${actionId}
        AND org_id = ${orgId}
      ORDER BY timestamp_start ASC
    `
  ]);

  const parentChain = await fetchParentChain(sql, orgId, actionId, action.parent_action_id);

  return {
    action,
    assumptions,
    loops,
    relatedActions,
    subActions,
    parentChain
  };
}

interface GraphNode {
  id: string;
  type: string;
  label: unknown;
  status?: unknown;
  riskScore?: unknown;
  agentId?: unknown;
  agentName?: unknown;
  actionType?: unknown;
  timestamp?: unknown;
  isRoot?: boolean;
  meta?: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: unknown;
}

interface GraphAccumulator {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pushNode: (node: GraphNode) => void;
}

function createGraphAccumulator(): GraphAccumulator {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  return {
    nodes,
    edges,
    pushNode(node: GraphNode) {
      if (seenNodes.has(node.id)) return;
      seenNodes.add(node.id);
      nodes.push(node);
    },
  };
}

function toActionNode(a: Row, { isRoot = false }: { isRoot?: boolean } = {}): GraphNode {
  return {
    id: `action:${a.action_id}`,
    type: 'action',
    label: firstPresent(a.declared_goal, a.action_type, a.action_id),
    status: valueOrDefault(a.status, 'unknown'),
    riskScore: a.risk_score ?? null,
    agentId: valueOrNull(a.agent_id),
    agentName: valueOrNull(a.agent_name),
    actionType: valueOrNull(a.action_type),
    timestamp: valueOrNull(a.timestamp_start),
    isRoot,
    meta: {
      error_message: valueOrNull(a.error_message),
      parent_action_id: valueOrNull(a.parent_action_id),
    },
  };
}

function firstPresent(...values: unknown[]): unknown {
  return values.find(Boolean) ?? null;
}

function valueOrNull(value: unknown): unknown {
  return value || null;
}

function valueOrDefault(value: unknown, fallback: unknown): unknown {
  return value || fallback;
}

function addParentChain(acc: GraphAccumulator, action: Row, parentChain: Row[]): void {
  let childActionId = action.action_id;
  for (const parent of parentChain || []) {
    acc.pushNode(toActionNode(parent));
    acc.edges.push({
      id: `edge:pc:${parent.action_id}->${childActionId}`,
      source: `action:${parent.action_id}`,
      target: `action:${childActionId}`,
      type: 'parent_child',
      label: 'spawned',
    });
    childActionId = parent.action_id;
  }
}

function addSubActions(acc: GraphAccumulator, action: Row, subActions: Row[]): void {
  for (const sub of subActions || []) {
    acc.pushNode(toActionNode(sub));
    acc.edges.push({
      id: `edge:pc:${action.action_id}->${sub.action_id}`,
      source: `action:${action.action_id}`,
      target: `action:${sub.action_id}`,
      type: 'parent_child',
      label: 'spawned',
    });
  }
}

function addRelatedActions(acc: GraphAccumulator, action: Row, relatedActions: Row[]): void {
  for (const rel of relatedActions || []) {
    acc.pushNode(toActionNode(rel));
    acc.edges.push({
      id: `edge:rel:${action.action_id}-${rel.action_id}`,
      source: `action:${action.action_id}`,
      target: `action:${rel.action_id}`,
      type: 'related',
      label: 'correlated',
    });
  }
}

function assumptionStatus(a: Row): string {
  const invalidated = a.invalidated === 1 || a.invalidated === true;
  const validated = a.validated === 1 || a.validated === true;
  return invalidated ? 'invalidated' : validated ? 'validated' : 'unresolved';
}

function addAssumptions(acc: GraphAccumulator, action: Row, assumptions: Row[]): void {
  for (const a of assumptions || []) {
    const status = assumptionStatus(a);
    acc.pushNode({
      id: `assumption:${a.assumption_id}`,
      type: 'assumption',
      label: a.assumption || 'Assumption',
      status,
      meta: {
        invalidated_reason: a.invalidated_reason || null,
        drift_score: a.drift_score ?? null,
        created_at: a.created_at || null,
      },
    });
    acc.edges.push({
      id: `edge:as:${a.assumption_id}->${action.action_id}`,
      source: `assumption:${a.assumption_id}`,
      target: `action:${action.action_id}`,
      type: 'assumption_of',
      label: status,
    });
  }
}

function addOpenLoops(acc: GraphAccumulator, action: Row, loops: Row[]): void {
  for (const l of loops || []) {
    acc.pushNode({
      id: `loop:${l.loop_id}`,
      type: 'loop',
      label: firstPresent(l.description, l.loop_type, 'Open loop'),
      status: valueOrDefault(l.status, 'open'),
      meta: {
        priority: valueOrNull(l.priority),
        loop_type: valueOrNull(l.loop_type),
        created_at: valueOrNull(l.created_at),
      },
    });
    acc.edges.push({
      id: `edge:lp:${l.loop_id}->${action.action_id}`,
      source: `loop:${l.loop_id}`,
      target: `action:${action.action_id}`,
      type: 'loop_from',
      label: valueOrDefault(l.priority, 'open'),
    });
  }
}

/**
 * Build a read-only graph payload (nodes + edges) for an action, reusing
 * trace data plus correlated governance artifacts. Powers the Execution Graph
 * tab on the decision replay page.
 *
 * Node id conventions:
 *   action:<action_id>, assumption:<assumption_id>, loop:<loop_id>
 *
 * Edge types:
 *   parent_child   — parent action spawned child action
 *   related        — correlated action (same agent/system, nearby time window)
 *   assumption_of  — assumption supports the root action's decision basis
 *   loop_from      — open loop attached to the root action
 */
export async function buildActionGraph(
  sql: SqlClient,
  orgId: string,
  actionId: string,
): Promise<{ rootActionId: unknown; nodes: GraphNode[]; edges: GraphEdge[] } | null> {
  const trace = await getActionTraceData(sql, orgId, actionId);
  if (!trace) return null;

  const { action, assumptions, loops, relatedActions, subActions, parentChain } = trace;
  const acc = createGraphAccumulator();

  // Root action
  acc.pushNode(toActionNode(action, { isRoot: true }));

  // Parent chain — each parent spawned the next link toward the root
  addParentChain(acc, action, parentChain);

  // Sub-actions (root spawned them)
  addSubActions(acc, action, subActions);

  // Related actions (same agent/systems in nearby time window)
  addRelatedActions(acc, action, relatedActions);

  // Assumptions — edge flows from assumption into the action it supports
  addAssumptions(acc, action, assumptions);

  // Open loops — edge flows from loop into the action it blocks/questions
  addOpenLoops(acc, action, loops);

  return {
    rootActionId: action.action_id,
    nodes: acc.nodes,
    edges: acc.edges,
  };
}
