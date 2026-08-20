// app/policies/lib/shortListClient.ts
// Browser client for the Short List section's writes. Thin on purpose: the
// section needs the STATUS and the BODY of every write (a 409 SHORT_LIST_FULL
// is a UI state, not an error to swallow), so each call resolves to a plain
// { ok, status, json } instead of throwing.

export interface ClientResult {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}

export interface PolicyPatch {
  active?: boolean;
  rules?: Record<string, unknown>;
  policy_type?: string;
}

export interface PolicyCreate {
  name: string;
  policy_type: string;
  /** JSON text — POST /api/policies validates `rules` as a string. */
  rules: string;
}

async function send(url: string, method: string, body: unknown): Promise<ClientResult> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export function patchPolicy(id: string, body: PolicyPatch): Promise<ClientResult> {
  return send('/api/policies', 'PATCH', { id, ...body });
}

export function createPolicy(body: PolicyCreate): Promise<ClientResult> {
  return send('/api/policies', 'POST', body);
}

export function installPack(pack: string = 'catastrophe-only'): Promise<ClientResult> {
  return send('/api/policies/import', 'POST', { pack });
}

/** The hard ten-line cap answers 409 with this code; the UI opens remove-one. */
export function isShortListFull(res: ClientResult): boolean {
  return res.status === 409 && res.json?.code === 'SHORT_LIST_FULL';
}

/**
 * The current stored rules for one policy. PATCH replaces `rules` wholesale, so
 * every partial edit (promote to hold, undo one shape exception) has to read
 * the row first. GET /api/policies has no by-id form; the list is small.
 */
export async function fetchPolicyRules(id: string): Promise<Record<string, unknown>> {
  const res = await fetch('/api/policies');
  if (!res.ok) throw new Error('Could not read that rule.');
  const data = (await res.json()) as { policies?: Array<{ id: string; rules?: unknown }> };
  const row = (data.policies || []).find((p) => p.id === id);
  if (!row) throw new Error('That rule is no longer here.');
  if (row.rules && typeof row.rules === 'object') return row.rules as Record<string, unknown>;
  if (typeof row.rules === 'string') {
    try {
      return JSON.parse(row.rules) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}
