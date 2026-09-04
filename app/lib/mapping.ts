/**
 * Dot-path request/response mapper for capability invocations.
 * Resolves $.field paths from a source object into a target shape.
 */

function resolvePath(source: Record<string, unknown>, path: unknown): unknown {
  if (typeof path !== 'string' || !path.startsWith('$.')) return undefined;
  const key = path.slice(2);
  return source[key];
}

function mapObject(source: Record<string, unknown>, mapping: unknown): Record<string, unknown> | null {
  if (!mapping || typeof mapping !== 'object') return null;
  const result: Record<string, unknown> = {};
  let hasKeys = false;

  for (const [key, value] of Object.entries(mapping as Record<string, unknown>)) {
    if (typeof value === 'string' && value.startsWith('$.')) {
      const resolved = resolvePath(source, value);
      if (resolved !== undefined) {
        result[key] = resolved;
        hasKeys = true;
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = mapObject(source, value);
      if (nested !== null) {
        result[key] = nested;
        hasKeys = true;
      }
    } else {
      result[key] = value;
      hasKeys = true;
    }
  }

  return hasKeys ? result : null;
}

export function mapRequest(source: Record<string, unknown>, mapping: unknown): Record<string, unknown> {
  if (!mapping || Object.keys(mapping as Record<string, unknown>).length === 0) return source;
  const mapped = mapObject(source, mapping);
  return mapped || source;
}

export function mapResponse(source: Record<string, unknown>, mapping: unknown): Record<string, unknown> {
  if (!mapping || Object.keys(mapping as Record<string, unknown>).length === 0) return source;
  const mapped = mapObject(source, mapping);
  return mapped || source;
}

export function resolveEndpointUrl(url: string, settings: Record<string, unknown>): string {
  return url.replace(/\$\{([^}]+)\}/g, (match: string, varName: string) => {
    // `${input.<field>}` is a per-invocation path parameter, resolved from the
    // request body at execute time (resolveInputPlaceholders) — not a setting.
    if (varName.startsWith('input.')) return match;
    const value = settings[varName];
    if (value === undefined || value === null || value === '') {
      const err = new Error(`Setting '${varName}' not configured for capability endpoint`) as Error & { code?: string };
      err.code = 'endpoint_not_configured';
      throw err;
    }
    return String(value);
  });
}

/**
 * Resolve `${input.<field>}` path parameters from the invocation body. A
 * registrar buy is `POST /domains/{domain}/buy`: the domain is per call, so it
 * cannot be a setting. URL-encoded; a missing or non-scalar field is an input
 * error (`capability_input_invalid`), never an empty segment.
 */
export function resolveInputPlaceholders(url: string, input: unknown): string {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  return url.replace(/\$\{input\.([^}]+)\}/g, (_match: string, field: string) => {
    const value = source[field];
    if (value === undefined || value === null || value === '' || typeof value === 'object') {
      const err = new Error(`Input field '${field}' is required by the capability endpoint`) as Error & { code?: string };
      err.code = 'capability_input_invalid';
      throw err;
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * Resolve `$settings.<KEY>` values inside a request mapping from org settings,
 * so server-held data (a registrant contact, an account id) rides the request
 * without ever passing through the agent. A value that parses as JSON is
 * inserted as that object; anything else as the string. Missing → error.
 */
export function resolveSettingsInMapping(mapping: unknown, settings: Record<string, unknown>): unknown {
  if (typeof mapping === 'string') {
    if (!mapping.startsWith('$settings.')) return mapping;
    const key = mapping.slice('$settings.'.length);
    const value = settings[key];
    if (value === undefined || value === null || value === '') {
      const err = new Error(`Setting '${key}' not configured for capability request mapping`) as Error & { code?: string };
      err.code = 'endpoint_not_configured';
      throw err;
    }
    if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
      try { return JSON.parse(value); } catch { return value; }
    }
    return value;
  }
  if (Array.isArray(mapping)) return mapping.map((v) => resolveSettingsInMapping(v, settings));
  if (mapping && typeof mapping === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(mapping as Record<string, unknown>)) out[k] = resolveSettingsInMapping(v, settings);
    return out;
  }
  return mapping;
}
