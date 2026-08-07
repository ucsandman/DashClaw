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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import type { DashClaw } from 'dashclaw';

export const PAIRING_REQUEST_KIND = 'dashclaw.pairing_request';

export interface AutoPairConfig {
  dashclawUrl: string;
  dashclawApiKey: string;
  agentId: string;
  autoPairing: boolean;
}

interface InboxMessage {
  id: string;
  body?: unknown;
}

// One attempt per gateway process per (url, agent). Added BEFORE the first
// await so concurrent tool calls cannot double-run the flow. Per-process on
// purpose: a transient failure retries at the next gateway start.
let attempted = new Set<string>();

/** Test-only: reset the per-process attempt guard. */
export function __resetAutoPairing(): void {
  attempted = new Set();
}

export function identityKeyPath(agentId: string): string {
  const safe = agentId.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(homedir(), '.dashclaw', 'identity', `${safe}.pem`);
}

/** Same fence contract as app/lib/pairing-request.ts. */
function directiveTargets(body: unknown, agentId: string): boolean {
  if (typeof body !== 'string') return false;
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match || !match[1]) return false;
  try {
    const parsed = JSON.parse(match[1]) as { kind?: string; agent_id?: string } | null;
    return parsed?.kind === PAIRING_REQUEST_KIND && parsed.agent_id === agentId;
  } catch {
    return false;
  }
}

function apiUrl(config: AutoPairConfig, pathAndQuery: string): string {
  return `${config.dashclawUrl.replace(/\/+$/, '')}${pathAndQuery}`;
}

async function fetchUnreadInbox(config: AutoPairConfig): Promise<InboxMessage[]> {
  const res = await fetch(
    apiUrl(
      config,
      `/api/messages?agent_id=${encodeURIComponent(config.agentId)}&direction=inbox&unread=true&limit=50`
    ),
    { headers: { 'x-api-key': config.dashclawApiKey } }
  );
  if (!res.ok) throw new Error(`messages GET failed (${res.status})`);
  const data = (await res.json()) as { messages?: InboxMessage[] };
  return Array.isArray(data.messages) ? data.messages : [];
}

async function markRead(config: AutoPairConfig, messageIds: string[]): Promise<void> {
  const res = await fetch(apiUrl(config, '/api/messages'), {
    method: 'PATCH',
    headers: { 'x-api-key': config.dashclawApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_ids: messageIds, action: 'read', agent_id: config.agentId }),
  });
  if (!res.ok) throw new Error(`messages PATCH failed (${res.status})`);
}

export async function maybeAutoPair(client: DashClaw, config: AutoPairConfig): Promise<void> {
  if (!config.autoPairing) return;
  const key = `${config.dashclawUrl}|${config.agentId}`;
  if (attempted.has(key)) return;
  attempted.add(key);

  try {
    const pemPath = identityKeyPath(config.agentId);
    if (existsSync(pemPath)) {
      // Already enrolled or pending. Deleting the pem + clicking Request
      // pairing again is the rotation path.
      return;
    }

    const inbox = await fetchUnreadInbox(config);
    const requests = inbox.filter((m) => directiveTargets(m.body, config.agentId));
    if (requests.length === 0) return;

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const created = await client.createPairing(publicKey);
    const pairingId =
      (created as { pairing?: { id?: string } }).pairing?.id ??
      (created as { id?: string }).id ??
      '(pending)';

    // POST-then-write: a failed POST leaves no pem, so the next gateway
    // start retries cleanly. A failed write AFTER a successful POST is the
    // one loud case — that pending pairing has no usable private key.
    try {
      mkdirSync(dirname(pemPath), { recursive: true });
      writeFileSync(pemPath, privateKey, { mode: 0o600 });
    } catch (err) {
      console.warn(
        `[dashclaw-governance] auto-pairing: submitted pairing ${pairingId} but FAILED to store ` +
          `the private key at ${pemPath}: ${errText(err)}. Reject that pairing on /identities, ` +
          `fix the disk issue, and click Request pairing again.`
      );
      return; // leave the message unread so a later gateway start retries
    }

    await markRead(config, requests.map((m) => m.id));
    console.log(
      `[dashclaw-governance] auto-pairing submitted (${pairingId}) — approve it on /identities. ` +
        `Private key stored at ${pemPath} (never sent).`
    );
  } catch (err) {
    console.warn(`[dashclaw-governance] auto-pairing skipped: ${errText(err)}`);
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
