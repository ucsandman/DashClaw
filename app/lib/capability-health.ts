import type { SqlTag } from './types/db';

/** A capability row as read from the DB; shape is dynamic so fields stay loose. */
interface Capability {
  capability_id?: unknown;
  name?: unknown;
  slug: string;
  category?: unknown;
  risk_level?: unknown;
  health_status?: string;
  invocation_schema?: { circuit_breaker?: CircuitBreakerConfig | null } | null;
  [key: string]: unknown;
}

interface CircuitBreakerConfig {
  enabled?: boolean;
  consecutive_failures?: number;
  [key: string]: unknown;
}

function capabilityInvocationMarkers(capability: Capability) {
  const legacy = JSON.stringify([`capability:${capability.slug}`]);
  const capabilityId = typeof capability.capability_id === 'string' ? capability.capability_id.trim() : '';
  return {
    legacy,
    stable: capabilityId
      ? JSON.stringify([`capability:${capability.slug}`, `capability-id:${capabilityId}`])
      : null,
  };
}

export interface CircuitBreakerResult {
  open: boolean;
  consecutive_failures?: number;
}

export async function checkCircuitBreaker(
  sql: SqlTag,
  orgId: string,
  capability: Capability,
): Promise<CircuitBreakerResult> {
  const cb = capability.invocation_schema?.circuit_breaker;
  if (!cb || !cb.enabled) {
    return { open: false };
  }

  if (capability.health_status === 'healthy') {
    return { open: false };
  }

  const threshold = cb.consecutive_failures || 5;
  const systemsTouched = capabilityInvocationMarkers(capability);

  const rows = await sql`
    SELECT status FROM action_records
    WHERE org_id = ${orgId}
      AND (systems_touched = ${systemsTouched.stable}
        OR (action_type = 'capability_invoke' AND systems_touched = ${systemsTouched.legacy}))
    ORDER BY timestamp_start DESC
    LIMIT ${threshold}
  `;

  if (rows.length < threshold) {
    return { open: false };
  }

  const allFailed = rows.every((row) => row.status === 'failed');
  if (allFailed) {
    return { open: true, consecutive_failures: threshold };
  }

  return { open: false };
}
