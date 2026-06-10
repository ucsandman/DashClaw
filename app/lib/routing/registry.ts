/**
 * Agent Registry - register, unregister, query agents and capabilities
 * Absorbed from Agent-Task-Router/src/registry.js
 * Rewritten for Neon Postgres with org_id scoping
 */

import { randomUUID } from 'node:crypto';
import type { SqlTag } from '../types/db';

type AgentRow = Record<string, unknown>;

interface AgentInput {
  id?: string;
  name?: string;
  capabilities?: unknown;
  maxConcurrent?: number;
  endpoint?: string | null;
}

/**
 * Register an agent for routing
 */
export async function registerAgent(sql: SqlTag, orgId: string, agent: AgentInput): Promise<AgentRow | undefined> {
  const id = agent.id || `ra_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  const capabilities = JSON.stringify(agent.capabilities || []);

  const result = await sql`
    INSERT INTO routing_agents (id, org_id, name, capabilities, max_concurrent, status, endpoint, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${agent.name}, ${capabilities}, ${agent.maxConcurrent || 3}, 'available', ${agent.endpoint || null}, ${now}, ${now})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      capabilities = EXCLUDED.capabilities,
      max_concurrent = EXCLUDED.max_concurrent,
      endpoint = EXCLUDED.endpoint,
      updated_at = ${now}
    RETURNING *
  `;

  return result[0];
}

/**
 * Get a single agent by ID
 */
export async function getAgent(sql: SqlTag, orgId: string, agentId: string): Promise<AgentRow | null> {
  const rows = await sql`
    SELECT * FROM routing_agents WHERE id = ${agentId} AND org_id = ${orgId}
  `;
  return rows[0] || null;
}

/**
 * List agents, optionally filtered by status
 */
export async function listAgents(sql: SqlTag, orgId: string, status?: string): Promise<AgentRow[]> {
  if (status) {
    return sql`
      SELECT * FROM routing_agents WHERE org_id = ${orgId} AND status = ${status}
      ORDER BY name ASC
    `;
  }
  return sql`
    SELECT * FROM routing_agents WHERE org_id = ${orgId}
    ORDER BY name ASC
  `;
}

/**
 * Update agent status
 */
export async function updateAgentStatus(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  status: string,
): Promise<AgentRow | null> {
  const now = new Date().toISOString();
  const result = await sql`
    UPDATE routing_agents SET status = ${status}, updated_at = ${now}
    WHERE id = ${agentId} AND org_id = ${orgId}
    RETURNING *
  `;
  return result[0] || null;
}

/**
 * Unregister (delete) an agent
 */
export async function unregisterAgent(sql: SqlTag, orgId: string, agentId: string): Promise<AgentRow | null> {
  const agent = await getAgent(sql, orgId, agentId);
  if (!agent) return null;

  await sql`DELETE FROM routing_agents WHERE id = ${agentId} AND org_id = ${orgId}`;
  return agent;
}

/**
 * Get metrics for an agent
 */
export async function getAgentMetrics(sql: SqlTag, orgId: string, agentId: string): Promise<AgentRow[]> {
  return sql`
    SELECT * FROM routing_agent_metrics WHERE agent_id = ${agentId} AND org_id = ${orgId}
  `;
}

/**
 * Get all metrics for an org (used by matcher)
 */
export async function getAllMetrics(sql: SqlTag, orgId: string): Promise<AgentRow[]> {
  return sql`
    SELECT * FROM routing_agent_metrics WHERE org_id = ${orgId}
  `;
}

/**
 * Update metrics after task completion
 */
export async function updateMetrics(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  skill: string,
  success: boolean,
  durationMs?: number,
): Promise<void> {
  const id = `ram_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();

  await sql`
    INSERT INTO routing_agent_metrics (id, org_id, agent_id, skill, tasks_completed, tasks_failed, avg_duration_ms, last_completed_at, created_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${skill}, ${success ? 1 : 0}, ${success ? 0 : 1}, ${durationMs || 0}, ${now}, ${now})
    ON CONFLICT (org_id, agent_id, skill) DO UPDATE SET
      tasks_completed = routing_agent_metrics.tasks_completed + ${success ? 1 : 0},
      tasks_failed = routing_agent_metrics.tasks_failed + ${success ? 0 : 1},
      avg_duration_ms = CASE
        WHEN routing_agent_metrics.tasks_completed + routing_agent_metrics.tasks_failed > 0
        THEN ((routing_agent_metrics.avg_duration_ms * (routing_agent_metrics.tasks_completed + routing_agent_metrics.tasks_failed)) + ${durationMs || 0})
             / (routing_agent_metrics.tasks_completed + routing_agent_metrics.tasks_failed + 1)
        ELSE ${durationMs || 0}
      END,
      last_completed_at = ${now}
  `;
}
