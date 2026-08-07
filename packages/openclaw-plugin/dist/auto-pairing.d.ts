/**
 * Auto-pairing consumer — answers the operator's /identities "Request
 * pairing" click without an LLM in the loop.
 *
 * On the first tool call per gateway process the plugin checks this agent's
 * DashClaw inbox for a `dashclaw.pairing_request` directive (the fenced-JSON
 * contract in app/lib/pairing-request.ts). When one targets this agent it
 * generates an RSA-2048 keypair locally, POSTs the public PEM via the SDK's
 * createPairing, stores the private key at
 * ~/.dashclaw/identity/<agent_id>.pem (mode 600 — same path as the MCP
 * dashclaw_pair tool), and marks the message read. Identity creation still
 * happens only when an admin approves the pairing on /identities.
 *
 * Custody rule: the private key never leaves this machine and is never
 * logged. Failure rule: every error is a console.warn — this path must
 * never throw into or block a tool call.
 */
import type { DashClaw } from 'dashclaw';
export declare const PAIRING_REQUEST_KIND = "dashclaw.pairing_request";
export interface AutoPairConfig {
    dashclawUrl: string;
    dashclawApiKey: string;
    agentId: string;
    autoPairing: boolean;
}
/** Test-only: reset the per-process attempt guard. */
export declare function __resetAutoPairing(): void;
export declare function identityKeyPath(agentId: string): string;
export declare function maybeAutoPair(client: DashClaw, config: AutoPairConfig): Promise<void>;
