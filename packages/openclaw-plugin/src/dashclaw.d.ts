/**
 * Ambient type declarations for the `dashclaw` npm package.
 *
 * The published package ships as ESM JavaScript without `.d.ts` files, so we
 * describe only the surface this plugin touches: the `DashClaw` client and the
 * shapes of `guard()`, `createAction()`, `waitForApproval()`, and
 * `updateOutcome()` responses.
 *
 * Shapes mirror `dashclaw@4.2.x+/dashclaw.js` (the x402 methods require >= 4.2.0):
 *   - `guard()`  → `{ decision, action_id, reason, signals }`
 *   - `createAction()` → API returns `{ action, action_id, decision, ... }`
 *   - `waitForApproval()` → `{ action }`
 *   - `recordPurchase()` → `{ action, purchase, decision }` (x402, POST /api/x402/purchases)
 *   - `recordPurchaseResult()` → POST /api/artifacts (x402 result snapshot)
 */
declare module 'dashclaw' {
  export interface GuardDecision {
    decision: 'allow' | 'block' | 'warn' | 'require_approval';
    action_id: string;
    reason?: string;
    signals?: string[];
  }

  export interface ActionRecord {
    action_id?: string;
    id?: string;
    status?: string;
    approved_by?: string | null;
    error_message?: string | null;
    [key: string]: unknown;
  }

  /** Envelope returned by `POST /api/actions`. */
  export interface CreateActionResult {
    action: ActionRecord;
    action_id?: string;
    [key: string]: unknown;
  }

  export interface WaitForApprovalResult {
    action: ActionRecord;
  }

  export interface DashClawOptions {
    baseUrl: string;
    apiKey: string;
    agentId: string;
  }

  export class DashClaw {
    constructor(opts: DashClawOptions);
    guard(context: Record<string, unknown>): Promise<GuardDecision>;
    createAction(action: Record<string, unknown>): Promise<CreateActionResult>;
    updateOutcome(
      actionId: string,
      outcome: Record<string, unknown>
    ): Promise<unknown>;
    waitForApproval(
      actionId: string,
      opts?: { timeout?: number; interval?: number }
    ): Promise<WaitForApprovalResult>;
    recordAssumption(assumption: Record<string, unknown>): Promise<unknown>;
    createSession(
      agentId?: string,
      workspace?: string,
      branch?: string | null
    ): Promise<{ session?: { id?: string }; [key: string]: unknown }>;
    updateSession(
      sessionId: string,
      updates: Record<string, unknown>
    ): Promise<unknown>;

    // --- x402 spend governance (added in dashclaw 4.1.x) ---------------------
    /** POST /api/x402/purchases — govern + record a paid capability acquisition. */
    recordPurchase(data: Record<string, unknown>): Promise<{
      action: ActionRecord;
      purchase?: Record<string, unknown>;
      decision?: GuardDecision;
      [key: string]: unknown;
    }>;
    /** POST /api/artifacts — attach the x402 result snapshot to its purchase action. */
    recordPurchaseResult(
      actionId: string,
      result: { summary?: string; data?: unknown; url?: string }
    ): Promise<unknown>;
    /** GET /api/x402/providers — list the org's registered x402 providers. */
    listProviders(
      filters?: Record<string, unknown>
    ): Promise<{ providers?: unknown[]; [key: string]: unknown } | unknown[]>;
    /** POST /api/x402/providers — register an x402 provider (only `name` is required). */
    createProvider(
      data: Record<string, unknown>
    ): Promise<{ provider?: Record<string, unknown>; [key: string]: unknown }>;
  }

  export class ApprovalDeniedError extends Error {
    status: string;
  }

  export class GuardBlockedError extends Error {
    decision: GuardDecision;
  }
}
