export type JsonObject = Record<string, unknown>;

export type Act = {
  kind: 'shell' | 'http' | 'sql' | 'file' | string;
  command?: string;
  statement?: string;
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body_excerpt?: string;
    [key: string]: unknown;
  };
  file?: {
    path?: string;
    content_excerpt?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type GuardVerdict = 'allow' | 'warn' | 'block' | 'require_approval' | 'allow_contained';

export interface GuardContext extends JsonObject {
  action_type: string;
  declared_goal: string;
  risk_score?: number;
  confidence?: number;
  agent_id?: string;
  agent_name?: string;
  systems_touched?: string[];
  reversible?: boolean;
  target?: string;
  write_paths?: string[];
  act?: Act;
  client_capabilities?: string[];
  idempotency_key?: string;
  approval_wait_seconds?: number;
}

export interface GuardDecision extends JsonObject {
  decision: GuardVerdict;
  reason?: string | null;
  reasons?: string[];
  warnings?: string[];
  signals?: string[];
  action_id?: string;
  decision_id?: string;
  recorded?: boolean;
  execution_claim_required?: boolean;
  claim_protocol?: number;
  risk_score?: number;
  agent_risk_score?: number;
  verification_status?: 'verified' | 'unverified' | 'expired' | 'failed' | 'unknown_issuer';
}

export interface ActionRecord extends JsonObject {
  action_id: string;
  status: string;
  approved_by?: string | null;
  action_type?: string;
  declared_goal?: string;
  risk_score?: number;
}

export interface ActionResponse extends JsonObject {
  action: ActionRecord;
  action_id: string;
  idempotent_replay?: boolean;
}

export interface ApprovalResult extends JsonObject {
  action: ActionRecord;
  open_loops?: JsonObject[];
  assumptions?: JsonObject[];
  message_summary?: JsonObject;
}

export interface ActionOutcome extends JsonObject {
  action_id: string;
  status: 'pending' | 'completed' | 'partial' | 'failed' | 'lost_confirmation';
  outcome_at?: string | null;
  summary?: string | null;
  error_message?: string | null;
  progress?: JsonObject | null;
  elapsed_ms?: number | null;
}

export interface DashClawOptions {
  baseUrl: string;
  apiKey: string;
  agentId: string;
  agentName?: string;
  authToken?: string;
  timeoutMs?: number;
}

export interface RunGovernedParams extends GuardContext {
  wait?: boolean;
}

export class ApprovalDeniedError extends Error {
  decision: unknown;
}

export class GuardBlockedError extends Error {
  decision: GuardDecision;
}

export class ApprovalPendingError extends Error {
  actionId: string;
}

export class ExecutionClaimError extends Error {
  actionId: string;
  attemptId: string;
}

export class OutcomeConfirmationError extends Error {
  actionId: string;
}

export function scrubAct<T extends Act | null | undefined>(act: T): T;

export class DashClaw {
  constructor(options: DashClawOptions);
  readonly baseUrl: string;
  readonly agentId: string;

  guard(context: GuardContext, options?: { record?: boolean }): Promise<GuardDecision>;
  createAction(action: GuardContext): Promise<ActionResponse>;
  runGoverned<T>(act: Act, params: RunGovernedParams, fn: () => T | Promise<T>): Promise<T>;
  guardedFetch(url: string | URL, init?: RequestInit, params?: Partial<RunGovernedParams>): Promise<Response>;
  claimExecution(actionId: string, act: Act): Promise<{
    claimed: true;
    action_id: string;
    attempt_id: string;
    claimed_at?: string;
  }>;
  updateOutcome(actionId: string, outcome: JsonObject): Promise<JsonObject>;
  getAction(actionId: string): Promise<ApprovalResult>;
  getPendingApprovals(limit?: number, offset?: number): Promise<JsonObject>;
  approveAction(actionId: string, decision: 'allow' | 'deny', reasoning?: string): Promise<JsonObject>;
  resolveContainment(actionId: string, verdict: 'promote' | 'discard'): Promise<JsonObject>;
  listContained(options?: { status?: string; limit?: number }): Promise<JsonObject>;
  recordAssumption(assumption: JsonObject): Promise<JsonObject>;
  waitForApproval(actionId: string, options?: { timeout?: number; interval?: number }): Promise<ApprovalResult>;
  getSignals(): Promise<JsonObject>;
  actionContext(actionId: string): {
    recordAssumption(assumption: JsonObject): Promise<JsonObject>;
    updateOutcome(outcome: JsonObject): Promise<JsonObject>;
  };
  createPairing(publicKeyPem: string, options?: { algorithm?: string; agentName?: string }): Promise<JsonObject>;
  waitForPairing(pairingId: string, options?: { timeout?: number; interval?: number }): Promise<JsonObject>;
  scanPromptInjection(text: string, options?: { source?: string }): Promise<JsonObject>;
  createSession(agentId: string, workspace?: string, branch?: string | null): Promise<JsonObject>;
  getSession(sessionId: string): Promise<JsonObject>;
  updateSession(sessionId: string, updates: JsonObject): Promise<JsonObject>;
  listSessions(filters?: JsonObject): Promise<JsonObject>;
  getSessionEvents(sessionId: string): Promise<JsonObject>;
  getActionGraph(actionId: string): Promise<JsonObject>;
  reportActionOutcome(actionId: string, payload: JsonObject): Promise<JsonObject>;
  getActionOutcome(actionId: string): Promise<ActionOutcome>;
  reportActionSuccess(actionId: string, summary?: string): Promise<JsonObject>;
  reportActionFailure(actionId: string, errorMessage: string, summary?: string): Promise<JsonObject>;
  reportActionPartial(actionId: string, progress: JsonObject, summary?: string): Promise<JsonObject>;
  deriveIdempotencyKey(parts: JsonObject): string;
  simulatePolicy(input?: { policy_type?: string; rules?: JsonObject; days?: number }): Promise<JsonObject>;
  createDelegationConstraint(rules: JsonObject, options?: JsonObject): Promise<JsonObject>;
  createTeamTask(task: JsonObject): Promise<JsonObject>;
  appendTeamTaskEvent(taskId: string, event: JsonObject): Promise<JsonObject>;
  updateTeamTask(taskId: string, patch: JsonObject): Promise<JsonObject>;
  submitPlan(plan: JsonObject): Promise<JsonObject>;
  getPlan(planId: string): Promise<JsonObject>;
  attestPlan(planId: string, planHash: string): Promise<JsonObject>;
  listPlans(options?: JsonObject): Promise<JsonObject>;
  resolvePlan(planId: string, verdict: string, options?: JsonObject): Promise<JsonObject>;
  waitForPlanReview(planId: string, options?: { timeout?: number; interval?: number }): Promise<JsonObject>;
}
