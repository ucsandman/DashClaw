import { invokeCapability, resolveAuth } from './capability-invoke';
import { assertPayloadMatchesSchema, validateInvocationSchema } from './capability-contracts';
import { resolveEndpointUrl } from './mapping';
import { getCapability } from './repositories/capabilities.repository';
import { getSettings } from './repositories/settings.repository';
import type { SqlTag } from './types/db';

interface InvocationSchema {
  auth?: unknown;
  endpoint?: unknown;
  method?: string;
  input_schema?: unknown;
  output_schema?: unknown;
  request_mapping?: unknown;
  response_mapping?: unknown;
  timeout_ms?: number;
  retry_policy?: unknown;
  [key: string]: unknown;
}

interface CapabilityRow {
  source_type?: string;
  invocation_schema?: InvocationSchema | null;
  [key: string]: unknown;
}

interface PreparedInvocation {
  capability: CapabilityRow;
  schema: InvocationSchema;
  authHeaders: Record<string, string>;
  endpoint: string;
}

interface CapabilityResult {
  success: boolean;
  error?: string;
  message?: string;
  data?: unknown;
  elapsed_ms?: number;
  [key: string]: unknown;
}

async function loadOrgSettings(sql: SqlTag, orgId: string): Promise<Record<string, unknown>> {
  const orgSettings: Record<string, unknown> = {};

  try {
    const rows = await getSettings(sql, orgId);
    for (const row of rows) {
      orgSettings[row.key as string] = row.value;
    }
  } catch {
    // Settings table may not exist yet in some deployments.
  }

  return orgSettings;
}

export async function prepareCapabilityInvocation(
  sql: SqlTag,
  orgId: string,
  capabilityId: string,
): Promise<PreparedInvocation> {
  const capability = (await getCapability(sql, orgId, capabilityId)) as CapabilityRow | null;
  if (!capability) {
    throw new Error(`Capability not found: ${capabilityId}`);
  }

  if (capability.source_type !== 'http_api') {
    throw new Error(`Capability ${capabilityId} is not an http_api type`);
  }

  const schema: InvocationSchema = capability.invocation_schema || {};
  validateInvocationSchema(capability.source_type, schema);
  const orgSettings = await loadOrgSettings(sql, orgId);
  const authHeaders = resolveAuth(schema.auth as Parameters<typeof resolveAuth>[0], orgSettings as Record<string, string | undefined>);
  const endpoint = resolveEndpointUrl(schema.endpoint as string, orgSettings);

  return {
    capability,
    schema,
    authHeaders,
    endpoint,
  };
}

export async function executeCapabilityInvocation({
  endpoint,
  authHeaders,
  schema,
  body,
}: {
  endpoint: string;
  authHeaders: Record<string, string>;
  schema: InvocationSchema;
  body: unknown;
}): Promise<CapabilityResult> {
  try {
    assertPayloadMatchesSchema(body, schema.input_schema as Record<string, unknown> | null | undefined, 'input');
  } catch (err) {
    return {
      success: false,
      error: (err as { code?: string }).code || 'capability_input_invalid',
      message: (err as Error).message,
    };
  }

  const result = await invokeCapability({
    endpoint,
    method: schema.method || 'POST',
    authHeaders,
    body,
    requestMapping: schema.request_mapping,
    responseMapping: schema.response_mapping,
    timeoutMs: schema.timeout_ms || 60000,
    retryPolicy: schema.retry_policy as Parameters<typeof invokeCapability>[0]['retryPolicy'],
  });

  // invokeCapability returns AttemptResult | undefined; the undefined branch is
  // the retry loop falling through with no attempts, which never happens for a
  // real invocation. Guard it to satisfy the type and preserve a clear error.
  if (!result) {
    return { success: false, error: 'capability_no_result', message: 'Capability invocation returned no result' };
  }

  if (!result.success) {
    // AttemptResult matches CapabilityResult's named fields; it just lacks the
    // string index signature. The cast bridges that (no runtime change).
    return result as CapabilityResult;
  }

  try {
    assertPayloadMatchesSchema(result.data, schema.output_schema as Record<string, unknown> | null | undefined, 'output');
  } catch (err) {
    return {
      success: false,
      error: (err as { code?: string }).code || 'capability_output_invalid',
      message: (err as Error).message,
      elapsed_ms: result.elapsed_ms,
    };
  }

  return result as CapabilityResult;
}
