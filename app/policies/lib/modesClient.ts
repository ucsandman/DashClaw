// Typed client for the Policy Modes API (/api/policies/modes*). Browser-side.
// Imports only the PolicyMode *type* from the lib (erased at build) — never the
// compiler/friction runtime (which pulls server-only deps).
import type { PolicyMode } from '../../lib/policy-modes/catalog';
import type {
  PolicySummary,
  PolicySummaryMode,
  PolicySummaryRule,
  PolicySummaryShield,
  RuleBucket,
} from '../../lib/policy-modes/summary';

export type { PolicyMode };
export type { PolicySummary, PolicySummaryMode, PolicySummaryRule, PolicySummaryShield, RuleBucket };

export interface PolicyModeSummary extends PolicyMode {
  policy_count: number;
}

export interface CompiledPolicyView {
  name: string;
  policy_type: string;
  decision: string;
  rules: Record<string, unknown>;
}

export type FrictionView =
  | { available: false; reason: string }
  | {
      available: true;
      sample_size: number;
      window_days: number;
      summary: { total: number; allow: number; warn: number; require_approval: number; block: number };
      excluded_policy_types: string[];
    };

export interface ModePreview {
  mode: PolicyMode;
  policies: CompiledPolicyView[];
  summary: { total: number; warn: number; require_approval: number; block: number };
  friction: FrictionView;
}

export interface ModeImportResult {
  mode_id: string;
  imported: number;
  /** Pre-existing mode policies turned back on + refreshed (idempotent apply). */
  reactivated: number;
  skipped: number;
  errors: string[];
  policies: Array<Record<string, unknown>>;
}

export async function fetchModes(): Promise<PolicyModeSummary[]> {
  const res = await fetch('/api/policies/modes');
  if (!res.ok) throw new Error(`Failed to load modes (${res.status})`);
  const data = await res.json();
  return data.modes ?? [];
}

export async function previewMode(modeId: string): Promise<ModePreview> {
  const res = await fetch('/api/policies/modes/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode_id: modeId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Preview failed (${res.status})`);
  }
  return res.json();
}

export async function importMode(modeId: string): Promise<ModeImportResult> {
  const res = await fetch('/api/policies/modes/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode_id: modeId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Apply failed (${res.status})`);
  }
  return res.json();
}

export async function fetchSummary(): Promise<PolicySummary> {
  const res = await fetch('/api/policies/summary');
  if (!res.ok) throw new Error(`Failed to load posture (${res.status})`);
  return res.json();
}
