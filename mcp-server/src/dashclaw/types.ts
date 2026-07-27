export type DashclawDecision = "allow" | "block" | "require_approval" | "warn";

export interface DashclawConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  mode: "authoritative";
}

export interface DashclawGuardPayload {
  action_type: string;
  declared_goal: string;
  systems_touched: string[];
  reversible: boolean;
  risk_score: number;
  metadata: Record<string, unknown>;
}

export interface DashclawGuardDecision {
  decision: DashclawDecision;
  reason: string;
  decisionId?: string;
  actionId?: string;
  verificationStatus?: string;
  signals?: unknown;
  raw: unknown;
}

export interface DashclawOutcomeInput {
  actionId: string;
  status: "success" | "error" | "not_executed";
  durationMs: number;
  summary: string;
  metadata: Record<string, unknown>;
  errorMessage?: string;
}

export interface DashclawStatusReport {
  configured: boolean;
  baseUrl?: string;
  mode: "authoritative";
  reachable: boolean;
  error?: string;
}
