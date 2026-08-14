/**
 * External policy verdict wire client (RFC docs/rfcs/2026-08-13-external-
 * policy-verdict-input.md, frozen v1 contract, #219).
 *
 * One job: call the org's configured provider with the evaluated act, validate
 * the response against the contract, and return typed evidence. The JOIN with
 * the local decision lives in evaluate.ts (raiseDecision — tighten-only by
 * construction); this module never touches a guard accumulator.
 *
 * Contract hard lines enforced here:
 * - E3 identity binding: the provider must echo `input_identity` verbatim; a
 *   mismatch discards the verdict (failure, never reuse).
 * - Only the four contract verdicts map; anything else (`transform`, ...) is
 *   `unsupported_verdict` — it can never become an implicit allow.
 * - An unavailable provider is recorded as exactly that (`status:
 *   'unavailable'`), never as successful external governance.
 */
import { safeFetch } from '../url-safety';
import { digestJson } from '../integrity/canonicalize';
import type { ExternalVerdictConfig } from './caches';

export const EXTERNAL_VERDICT_MAP = {
  allow: 'allow',
  warn: 'warn',
  escalate: 'require_approval',
  deny: 'block',
} as const;

/** Provider evidence larger than this is dropped (marker kept) — breakdown
 *  rows are audit evidence, not a blob store. */
const EVIDENCE_MAX_CHARS = 4_096;

/** Below this remaining budget the call is doomed; skip it and take the
 *  posture instead of starting a fetch that cannot finish. */
const MIN_CALL_BUDGET_MS = 100;

export interface ExternalVerdictEvidence {
  provider_id: string;
  status: 'ok' | 'unavailable';
  regime: 'external+local' | 'external_unavailable';
  posture: 'fail_closed' | 'fail_open';
  latency_ms: number;
  raw_verdict?: string;
  mapped_verdict?: 'allow' | 'warn' | 'require_approval' | 'block';
  reason_code?: string | null;
  policy_source?: string | null;
  policy_version?: string | null;
  input_identity?: string;
  failure?: 'timeout' | 'budget' | 'http_error' | 'malformed' | 'identity_mismatch' | 'unsupported_verdict' | 'unsafe_url' | 'error';
  evidence?: unknown;
  evidence_truncated?: true;
}

/**
 * The act-identity digest both sides bind to: house canonical JSON, house
 * 'sha256:' + base64url format (integrity/canonicalize — the same digest
 * family as the act-content grant binding). Sent in the wire request; the
 * provider echoes it verbatim.
 */
export function computeInputIdentity(payload: {
  org_id: string;
  agent_id: string | null;
  action_type: string | null;
  declared_goal: string | null;
  act: unknown;
}): string {
  return digestJson({
    org_id: payload.org_id,
    agent_id: payload.agent_id ?? null,
    action_type: payload.action_type ?? null,
    declared_goal: payload.declared_goal ?? null,
    act: payload.act ?? null,
  });
}

export async function fetchExternalVerdict(
  cfg: ExternalVerdictConfig,
  request: Record<string, unknown>,
  budgetMs: number,
): Promise<ExternalVerdictEvidence> {
  const base: ExternalVerdictEvidence = {
    provider_id: cfg.providerId,
    posture: cfg.posture,
    status: 'unavailable',
    regime: 'external_unavailable',
    latency_ms: 0,
  };
  if (budgetMs < MIN_CALL_BUDGET_MS) return { ...base, failure: 'budget' };

  const started = Date.now();
  const fail = (failure: NonNullable<ExternalVerdictEvidence['failure']>): ExternalVerdictEvidence =>
    ({ ...base, failure, latency_ms: Date.now() - started });

  let res: Response;
  try {
    res = await safeFetch(cfg.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.authToken ? { authorization: `Bearer ${cfg.authToken}` } : {}),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(budgetMs),
    });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'UNSAFE_URL') return fail('unsafe_url');
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return fail('timeout');
    return fail('error');
  }

  if (!res.ok) return fail('http_error');

  let body: Record<string, unknown>;
  try {
    body = await res.json() as Record<string, unknown>;
  } catch {
    return fail('malformed');
  }
  if (!body || typeof body !== 'object') return fail('malformed');

  const raw = typeof body.decision === 'string' ? body.decision : null;
  if (!raw) return fail('malformed');
  const mapped = EXTERNAL_VERDICT_MAP[raw as keyof typeof EXTERNAL_VERDICT_MAP];
  if (!mapped) return fail('unsupported_verdict');
  // E3 — the verdict binds to THIS act or it binds to nothing.
  if (body.input_identity !== request.input_identity) return fail('identity_mismatch');

  const evidenceStr = body.evidence !== undefined ? JSON.stringify(body.evidence) : null;
  return {
    ...base,
    status: 'ok',
    regime: 'external+local',
    latency_ms: Date.now() - started,
    raw_verdict: raw,
    mapped_verdict: mapped,
    reason_code: typeof body.reason === 'string' ? body.reason : null,
    policy_source: typeof body.policy_source === 'string' ? body.policy_source : null,
    policy_version: typeof body.policy_version === 'string' ? body.policy_version : null,
    input_identity: request.input_identity as string,
    ...(evidenceStr != null && evidenceStr.length <= EVIDENCE_MAX_CHARS
      ? { evidence: body.evidence }
      : evidenceStr != null
        ? { evidence_truncated: true as const }
        : {}),
  };
}
