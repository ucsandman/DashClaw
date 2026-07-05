// app/policies/lib/behaviorClient.ts
// Browser client for the behavior-learning suggestion endpoints
// (/api/behavior/suggestions, /api/behavior/simulate). The Judgment Spine's
// behavior adapter reuses these so decisions dispatch through the behavior
// engine's own routes — no aggregate route, no new persistence. Simulate is
// the gate: adopt is disabled until a simulation resolves for the row.

export interface BehaviorEvidenceExample {
  event_id?: string;
  command_shape?: string;
  write_path?: string;
  tool?: string;
  outcome_status?: string;
  risk_score?: number | null;
}

export interface BehaviorSuggestion {
  id: string;
  type: string;
  agent_id: string;
  severity: string;
  false_positive_risk: string;
  confidence: number;
  expected_effect: string;
  matching_sample_size: number;
  sample_size: number;
  target: string;
  advisory: boolean;
  enforceable: boolean;
  evidence_examples?: BehaviorEvidenceExample[];
  rule?: Record<string, unknown>;
}

export interface BehaviorSuggestionsPayload {
  agents: unknown[];
  suggestions: BehaviorSuggestion[];
  dismissed?: number;
  sample_count: number;
  sample_source: 'local' | 'uploaded';
}

export interface BehaviorSimulation {
  total: number;
  allow: number;
  warn: number;
  require_approval: number;
  block: number;
  likely_false_positives?: number;
}

/** The undo contract the behavior engine exposes (v4.4): deletes the judgment row, keeps any draft policy. */
export interface BehaviorUndoResult {
  ok: boolean;
  suggestion_id: string;
  removed: boolean;
  policy_kept: boolean;
}

export interface BehaviorAdoptResult {
  adopted: boolean;
  advisory: boolean;
  note?: string;
  policy?: { id?: string } | null;
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}

export async function fetchBehaviorSuggestions(agentId?: string): Promise<BehaviorSuggestionsPayload> {
  const params = new URLSearchParams();
  if (agentId) params.set('agent_id', agentId);
  const qs = params.toString();
  const res = await fetch(`/api/behavior/suggestions${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw await errorFrom(res, `Failed to load behavior suggestions (${res.status})`);
  return res.json();
}

/** Replay the suggestion's rule over the captured samples. Returns null if the server declined to simulate. */
export async function simulateBehaviorSuggestion(suggestionId: string): Promise<BehaviorSimulation | null> {
  const res = await fetch('/api/behavior/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestion_id: suggestionId }),
  });
  if (!res.ok) throw await errorFrom(res, `Simulation failed (${res.status})`);
  const body = await res.json().catch(() => ({}));
  return body?.simulation ?? null;
}

/** Adopt = create an INACTIVE draft (enforceable) or record an accepted observation (advisory). Requires a prior simulation. */
export async function adoptBehaviorSuggestion(suggestionId: string): Promise<BehaviorAdoptResult> {
  const res = await fetch('/api/behavior/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'adopt', suggestion_id: suggestionId, acknowledged_simulation: true }),
  });
  if (!res.ok) throw await errorFrom(res, `Adoption failed (${res.status})`);
  return res.json();
}

export async function dismissBehaviorSuggestion(
  suggestionId: string,
  reason: string | null,
  suppressSimilar: boolean,
): Promise<void> {
  const res = await fetch('/api/behavior/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'dismiss',
      suggestion_id: suggestionId,
      reason: reason || null,
      suppress_similar: suppressSimilar,
    }),
  });
  if (!res.ok) throw await errorFrom(res, `Dismiss failed (${res.status})`);
}

/** Undo a dismiss or an adoption. The draft policy (if any) is kept — echoed as policy_kept. */
export async function undoBehaviorSuggestion(suggestionId: string): Promise<BehaviorUndoResult> {
  const res = await fetch('/api/behavior/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'undo', suggestion_id: suggestionId }),
  });
  if (!res.ok) throw await errorFrom(res, `Undo failed (${res.status})`);
  return res.json();
}
