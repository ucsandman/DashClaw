/**
 * Core Router - submit tasks, dispatch to agents, handle lifecycle
 * Absorbed from Agent-Task-Router/src/router.js
 * Rewritten for Neon Postgres with org_id scoping
 */

import { randomUUID } from 'node:crypto';
import { listAgents, updateMetrics, getAllMetrics } from './registry';
import { findBestMatch, rankAgents } from './matcher';
import { safeUrlWithIps, buildPinnedDispatcher } from '../webhooks';
import type { SqlTag } from '../types/db';

type Row = Record<string, unknown>;

interface SubmitTaskInput {
  title: string;
  description?: string;
  requiredSkills?: unknown[];
  urgency?: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  callbackUrl?: string | null;
}

interface MatchResult {
  agent: { id: string; name?: string; endpoint?: string | null; [key: string]: unknown };
  score: number;
  reasons: string[];
}

interface RoutingResponse {
  task: Row;
  routing: Record<string, unknown>;
}

/**
 * Safely parse a JSON array stored as a string in a DB field.
 * Returns [] on null, undefined, or malformed JSON instead of throwing.
 */
function safeParseJsonArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse((val as string) || '[]');
  } catch {
    return [];
  }
}

/**
 * Submit and auto-route a task
 */
export async function submitTask(sql: SqlTag, orgId: string, task: SubmitTaskInput): Promise<RoutingResponse> {
  const id = `rt_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  const requiredSkills = JSON.stringify(task.requiredSkills || []);

  await sql`
    INSERT INTO routing_tasks (id, org_id, title, description, required_skills, urgency, timeout_seconds, max_retries, callback_url, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${task.title}, ${task.description || ''}, ${requiredSkills}, ${task.urgency || 'normal'}, ${task.timeoutSeconds || 3600}, ${task.maxRetries ?? 2}, ${task.callbackUrl || null}, ${now}, ${now})
  `;

  return routeTask(sql, orgId, id);
}

/**
 * Route a pending task to the best agent
 */
export async function routeTask(sql: SqlTag, orgId: string, taskId: string): Promise<RoutingResponse> {
  const taskRows = await sql`
    SELECT * FROM routing_tasks WHERE id = ${taskId} AND org_id = ${orgId}
  `;
  const task = taskRows[0];
  if (!task) throw new Error(`Task not found: ${taskId}`);

  if (task.status !== 'pending') {
    return { task: formatTask(task), routing: { status: 'already_routed', assigned_to: task.assigned_to } };
  }

  const candidates = await listAgents(sql, orgId) as unknown as Parameters<typeof findBestMatch>[1];
  const allMetrics = await getAllMetrics(sql, orgId) as unknown as Parameters<typeof findBestMatch>[2];
  const match = findBestMatch(task, candidates, allMetrics) as MatchResult | null;

  if (!match) {
    await logRouting(sql, orgId, taskId, null, 0, 'No matching agent available');
    return { task: formatTask(task), routing: { status: 'pending', reason: 'No matching agent available' } };
  }

  const now = new Date().toISOString();
  await sql`
    UPDATE routing_tasks SET status = 'assigned', assigned_to = ${match.agent.id}, updated_at = ${now}
    WHERE id = ${taskId} AND org_id = ${orgId}
  `;
  await sql`
    UPDATE routing_agents SET current_load = current_load + 1, updated_at = ${now}
    WHERE id = ${match.agent.id} AND org_id = ${orgId}
  `;

  const allRanked = rankAgents(task, candidates, allMetrics) as MatchResult[];
  await logRouting(sql, orgId, taskId, match.agent.id, match.score, match.reasons.join('; '), allRanked);

  const updatedRows = await sql`
    SELECT * FROM routing_tasks WHERE id = ${taskId} AND org_id = ${orgId}
  `;

  if (match.agent.endpoint) {
    dispatchToAgent(match.agent, updatedRows[0] as Row).catch((err: unknown) => {
      console.error(`Dispatch to ${match.agent.id} failed:`, (err as Error)?.message);
    });
  }

  return {
    task: formatTask(updatedRows[0] as Row),
    routing: {
      status: 'assigned',
      agent_id: match.agent.id,
      agent_name: match.agent.name,
      score: match.score,
      reasons: match.reasons,
    },
  };
}

/**
 * Complete a task
 */
export async function completeTask(
  sql: SqlTag,
  orgId: string,
  taskId: string,
  { success = true, result, error }: { success?: boolean; result?: unknown; error?: unknown } = {}
): Promise<RoutingResponse> {
  const taskRows = await sql`
    SELECT * FROM routing_tasks WHERE id = ${taskId} AND org_id = ${orgId}
  `;
  const task = taskRows[0];
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const status = success !== false ? 'completed' : 'failed';
  const now = new Date().toISOString();
  const resultJson = result ? JSON.stringify(result) : null;

  await sql`
    UPDATE routing_tasks SET status = ${status}, result = ${resultJson}, updated_at = ${now}
    WHERE id = ${taskId} AND org_id = ${orgId}
  `;

  if (task.assigned_to) {
    await sql`
      UPDATE routing_agents SET current_load = GREATEST(0, current_load - 1), updated_at = ${now}
      WHERE id = ${task.assigned_to} AND org_id = ${orgId}
    `;

    const createdAt = new Date(task.created_at as string);
    const durationMs = Date.now() - createdAt.getTime();
    const skills = safeParseJsonArray(task.required_skills);

    for (const skill of skills) {
      await updateMetrics(sql, orgId, task.assigned_to as string, skill as string, success !== false, durationMs);
    }
  }

  if (status === 'failed' && (task.retry_count as number) < (task.max_retries as number)) {
    await sql`
      UPDATE routing_tasks SET status = 'pending', assigned_to = NULL, retry_count = retry_count + 1, updated_at = ${now}
      WHERE id = ${taskId} AND org_id = ${orgId}
    `;
    return routeTask(sql, orgId, taskId);
  }

  if (status === 'failed') {
    await sql`
      UPDATE routing_tasks SET status = 'escalated', updated_at = ${now}
      WHERE id = ${taskId} AND org_id = ${orgId}
    `;
    const escalated = await sql`SELECT * FROM routing_tasks WHERE id = ${taskId} AND org_id = ${orgId}`;
    return { task: formatTask(escalated[0] as Row), routing: { status: 'escalated', reason: 'Max retries exceeded' } };
  }

  const completed = await sql`SELECT * FROM routing_tasks WHERE id = ${taskId} AND org_id = ${orgId}`;

  if (task.callback_url) {
    fireCallback(task.callback_url as string, completed[0] as Row).catch((err: unknown) => {
      console.error(`Callback failed for task ${taskId}:`, (err as Error)?.message);
    });
  }

  return { task: formatTask(completed[0] as Row), routing: { status: 'completed' } };
}

/**
 * List tasks with optional filters
 */
export async function listTasks(
  sql: SqlTag,
  orgId: string,
  { status, assignedTo, limit = 50 }: { status?: string; assignedTo?: string; limit?: number } = {}
): Promise<Row[]> {
  let rows;
  if (status && assignedTo) {
    rows = await sql`
      SELECT * FROM routing_tasks WHERE org_id = ${orgId} AND status = ${status} AND assigned_to = ${assignedTo}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else if (status) {
    rows = await sql`
      SELECT * FROM routing_tasks WHERE org_id = ${orgId} AND status = ${status}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else if (assignedTo) {
    rows = await sql`
      SELECT * FROM routing_tasks WHERE org_id = ${orgId} AND assigned_to = ${assignedTo}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT * FROM routing_tasks WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  }
  return rows.map(formatTask);
}

/**
 * Get a single task
 */
export async function getTask(sql: SqlTag, orgId: string, taskId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT * FROM routing_tasks WHERE id = ${taskId} AND org_id = ${orgId}
  `;
  return rows[0] ? formatTask(rows[0]) : null;
}

export async function deleteTask(sql: SqlTag, orgId: string, taskId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM routing_tasks WHERE id = ${taskId} AND org_id = ${orgId} RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Route all pending tasks
 */
export async function routePending(sql: SqlTag, orgId: string): Promise<RoutingResponse[]> {
  const pending = await sql`
    SELECT id FROM routing_tasks WHERE org_id = ${orgId} AND status = 'pending'
    ORDER BY
      CASE urgency WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END ASC,
      created_at ASC
  `;
  const results: RoutingResponse[] = [];
  for (const { id } of pending as Array<{ id: string }>) {
    results.push(await routeTask(sql, orgId, id));
  }
  return results;
}

/**
 * Check for timed-out tasks and re-route or escalate
 */
export async function checkTimeouts(sql: SqlTag, orgId: string): Promise<RoutingResponse[]> {
  const timedOut = await sql`
    SELECT * FROM routing_tasks
    WHERE org_id = ${orgId}
    AND status IN ('assigned', 'in_progress')
    AND created_at::timestamp + (timeout_seconds || ' seconds')::interval < NOW()
  `;

  const results: RoutingResponse[] = [];
  const now = new Date().toISOString();

  for (const task of timedOut) {
    if (task.assigned_to) {
      await sql`
        UPDATE routing_agents SET current_load = GREATEST(0, current_load - 1), updated_at = ${now}
        WHERE id = ${task.assigned_to} AND org_id = ${orgId}
      `;
    }

    if ((task.retry_count as number) < (task.max_retries as number)) {
      await sql`
        UPDATE routing_tasks SET status = 'pending', assigned_to = NULL, retry_count = retry_count + 1, updated_at = ${now}
        WHERE id = ${task.id} AND org_id = ${orgId}
      `;
      results.push(await routeTask(sql, orgId, task.id as string));
    } else {
      await sql`
        UPDATE routing_tasks SET status = 'escalated', updated_at = ${now}
        WHERE id = ${task.id} AND org_id = ${orgId}
      `;
      const escalated = await sql`SELECT * FROM routing_tasks WHERE id = ${task.id} AND org_id = ${orgId}`;
      results.push({ task: formatTask(escalated[0] as Row), routing: { status: 'escalated', reason: 'Timed out after max retries' } });
    }
  }

  return results;
}

/**
 * Get routing stats for an org
 */
export async function getRoutingStats(sql: SqlTag, orgId: string) {
  const agentCounts = await sql`
    SELECT
      COUNT(*) FILTER (WHERE TRUE) as total,
      COUNT(*) FILTER (WHERE status = 'available') as available,
      COUNT(*) FILTER (WHERE status = 'busy') as busy,
      COUNT(*) FILTER (WHERE status = 'offline') as offline
    FROM routing_agents WHERE org_id = ${orgId}
  `;
  const taskCounts = await sql`
    SELECT
      COUNT(*) FILTER (WHERE TRUE) as total,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'escalated') as escalated
    FROM routing_tasks WHERE org_id = ${orgId}
  `;
  const decisionCount = await sql`
    SELECT COUNT(*) as total FROM routing_decisions WHERE org_id = ${orgId}
  `;

  return {
    agents: agentCounts[0] || { total: 0, available: 0, busy: 0, offline: 0 },
    tasks: taskCounts[0] || { total: 0, pending: 0, assigned: 0, completed: 0, failed: 0, escalated: 0 },
    routing: { total_decisions: decisionCount[0]?.total || 0 },
  };
}

// --- Helpers ---

function formatTask(task: Row): Row {
  return {
    ...task,
    required_skills: safeParseJsonArray(task.required_skills),
  };
}

async function logRouting(
  sql: SqlTag,
  orgId: string,
  taskId: string,
  agentId: string | null,
  score: number,
  reason: string,
  candidates: MatchResult[] = []
): Promise<void> {
  const id = `rd_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  const candidatesJson = JSON.stringify(candidates.map(c => ({
    agent_id: c.agent.id,
    score: c.score,
    reasons: c.reasons,
  })));

  await sql`
    INSERT INTO routing_decisions (id, org_id, task_id, candidates, selected_agent_id, selected_score, reason, created_at)
    VALUES (${id}, ${orgId}, ${taskId}, ${candidatesJson}, ${agentId}, ${score}, ${reason}, ${now})
  `;
}

async function dispatchToAgent(agent: MatchResult['agent'], task: Row): Promise<void> {
  if (!agent.endpoint) return;
  const validatedIps = await safeUrlWithIps(agent.endpoint);
  const dispatcher = buildPinnedDispatcher(validatedIps);
  const response = await fetch(agent.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'task.assigned', task }),
    redirect: 'manual',
    dispatcher,
  } as RequestInit);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function fireCallback(url: string, task: Row): Promise<void> {
  try {
    const validatedIps = await safeUrlWithIps(url);
    const dispatcher = buildPinnedDispatcher(validatedIps);
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: `task.${task.status}`, task }),
      redirect: 'manual',
      dispatcher,
    } as RequestInit);
  } catch (err: unknown) {
    console.error(`Callback to ${url} failed:`, (err as Error)?.message);
  }
}
