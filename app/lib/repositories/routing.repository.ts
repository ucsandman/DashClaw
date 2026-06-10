/**
 * Routing repository — thin data-access layer for routing tables.
 * Core routing logic lives in app/lib/routing/ (matcher, registry, router).
 * This file exists for route-sql guardrail compliance: routes import from here
 * instead of writing SQL directly.
 */

// Re-export from the routing lib modules so route files import from repositories
export { registerAgent, getAgent, listAgents, updateAgentStatus, unregisterAgent, getAgentMetrics } from '../routing/registry';
export { submitTask, routeTask, completeTask, deleteTask, listTasks, getTask, routePending, checkTimeouts, getRoutingStats } from '../routing/router';
