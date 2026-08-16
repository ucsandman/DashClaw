export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse, after } from 'next/server';
import { createPublicKey, verify as verifyEd25519 } from 'node:crypto';
import { getSql } from '../../../lib/db';
import {
  getActionSummary,
  recordApproval,
} from '../../../lib/repositories/actions.repository';
import { clearApprovalNotifications } from '../../../lib/approvalNotifications';

// Discord REST base; v10 per RESEARCH §Standard Stack.
const DISCORD_API = 'https://discord.com/api/v10';

// custom_id shape: verb:action_id. Strict regex mitigates T-02-02-03.
const CALLBACK_DATA_RE = /^(ap|dn):(act_[a-z0-9_-]{1,57})$/;

const FETCH_TIMEOUT_MS = 1500;

// Anti-replay: reject any signed request whose timestamp is more than 5
// minutes off from now. Discord includes the timestamp in the signed data,
// so an attacker can't tamper with it without breaking the signature.
// Mitigates T-02-02-02.
const TIMESTAMP_SKEW_SECONDS = 5 * 60;

// Fixed DER prefix that turns a raw 32-byte Ed25519 public key into SPKI.
const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex');

// Discord interaction type / callback type constants.
const PING = 1;
const MESSAGE_COMPONENT = 3;
const PONG = 1;
const DEFERRED_UPDATE_MESSAGE = 6;

/**
 * Verify a Discord interaction signature. Mitigates T-02-02-01 (spoofing)
 * and T-02-02-02 (replay) before any DB work is attempted.
 *
 * The signature is over (timestamp + rawBody). Callers MUST pass the raw
 * request body bytes — re-serialized JSON does not match (Pitfall 1).
 */
function verifyDiscordSignature(
  rawBody: string,
  signatureHex: string | null,
  timestampStr: string | null,
  publicKeyHex: string | undefined,
): boolean {
  if (!signatureHex || !timestampStr || !publicKeyHex) return false;
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestampStr);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_SKEW_SECONDS) return false;
  try {
    // node:crypto wants an SPKI key; Discord publishes a raw 32-byte one, so
    // prepend the fixed Ed25519 SPKI header.
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_HEADER, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return verifyEd25519(
      null,
      Buffer.from(timestampStr + rawBody),
      key,
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}

function unauthorized() {
  return NextResponse.json({ error: 'invalid request signature' }, { status: 401 });
}

/**
 * Resolve the approval asynchronously after the route has acked Discord.
 * Runs via next/server `after()` so Vercel keeps the lambda alive past the
 * 3-second ack deadline. Never throws — PATCH @original surfaces failures.
 */
async function resolveApproval(
  verb: string,
  actionId: string,
  discordUserId: string,
  appId: string,
  interactionToken: string,
) {
  const orgId = process.env.DISCORD_APPROVER_ORG_ID;
  if (!orgId) {
    await editOriginal(appId, interactionToken,
      'Server misconfigured: DISCORD_APPROVER_ORG_ID is not set');
    return;
  }

  const sql = getSql();
  const action = await getActionSummary(sql, orgId, actionId);
  if (!action) {
    await editOriginal(appId, interactionToken, 'Action not found');
    return;
  }
  if (action.status !== 'pending_approval') {
    await editOriginal(appId, interactionToken,
      `Already resolved — status: ${action.status}`);
    return;
  }

  const userId = `discord:${discordUserId}`;
  const isApprove = verb === 'ap';

  let updated;
  try {
    updated = await recordApproval(sql, orgId, actionId, {
      newStatus: isApprove ? 'running' : 'failed',
      errorMessage: isApprove ? null : 'Denied via Discord',
      decision: isApprove ? 'allow' : 'deny',
      userId,
      safeReasoning: (isApprove ? null : 'Denied via Discord') as unknown as string | undefined,
    });
  } catch (err) {
    console.warn('[DiscordInteractions] recordApproval failed:', (err as Error).message);
    await editOriginal(appId, interactionToken, 'Approval failed');
    return;
  }

  if (!updated) {
    // Atomic UPDATE matched zero rows — another channel (Telegram, dashboard)
    // resolved the action between getActionSummary and recordApproval.
    await editOriginal(appId, interactionToken,
      'Already resolved — resolved by another channel');
    return;
  }

  await editOriginal(appId, interactionToken,
    buildResolvedText(action, isApprove ? 'APPROVED' : 'DENIED', actionId));

  // Clear the approval message in every OTHER channel (Telegram) — this Discord
  // message was just edited inline above, so resolvedVia skips it.
  await clearApprovalNotifications(sql, {
    orgId, actionId, decision: isApprove ? 'allow' : 'deny', resolvedBy: userId, resolvedVia: 'discord',
  });
}

async function editOriginal(appId: string, interactionToken: string, content: string) {
  try {
    await fetch(
      // Path segments encodeURIComponent'd so a malformed appId/token can never
      // break out of the path and change the request host (pinned to DISCORD_API).
      `${DISCORD_API}/webhooks/${encodeURIComponent(appId)}/${encodeURIComponent(interactionToken)}/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, components: [] }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  } catch (err) {
    console.warn('[DiscordInteractions] editOriginal failed:', (err as Error).message);
  }
}

function buildResolvedText(action: any, decisionLabel: string, actionId: string) {
  const ts = new Date().toTimeString().slice(0, 8);
  const goal = (action.declared_goal || '—').slice(0, 200);
  return [
    `${decisionLabel} — ${ts}`,
    '',
    `Agent:   ${action.agent_id || 'unknown'}`,
    `Action:  ${action.action_type || 'unknown'}`,
    `Goal: ${goal}`,
    '',
    actionId,
  ].join('\n');
}

export async function POST(request: Request) {
  // CRITICAL: verify signature on raw body BEFORE JSON.parse. request.json()
  // would consume the stream and re-serialize, which breaks the signature
  // (Pitfall 1). T-02-02-01 mitigation.
  const rawBody = await request.text();
  const sig = request.headers.get('x-signature-ed25519');
  const ts = request.headers.get('x-signature-timestamp');

  if (!verifyDiscordSignature(rawBody, sig, ts, process.env.DISCORD_PUBLIC_KEY)) {
    return unauthorized();
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // PING handshake — Discord Developer Portal saves the Interactions URL
  // only if this returns {type: 1}.
  if (body.type === PING) return NextResponse.json({ type: PONG });

  // Anything other than MESSAGE_COMPONENT is acknowledged as a no-op so the
  // endpoint stays well-behaved if Discord introduces new interaction types.
  if (body.type !== MESSAGE_COMPONENT) {
    return NextResponse.json({ type: PONG });
  }

  // T-02-02-04: sender-identity check AFTER signature verify. DM context
  // carries body.user; guild context carries body.member.user. Phase 2 is
  // DM-only (D-04) so body.user.id is authoritative.
  const discordUserId = String(body.user?.id ?? body.member?.user?.id ?? '');
  if (discordUserId !== process.env.DISCORD_APPROVER_USER_ID) {
    // Collapse to 401 (not 403) so we don't leak "signature correct but
    // sender wrong" as a distinguishable response. Mirrors Telegram.
    return unauthorized();
  }

  const customId = body.data?.custom_id ?? '';
  const match = customId.match(CALLBACK_DATA_RE);
  if (!match) {
    // Unknown button — silent ack (type 6). No repo work.
    return NextResponse.json({ type: DEFERRED_UPDATE_MESSAGE });
  }
  const verb = match[1] as string;
  const actionId = match[2] as string;

  const appId = body.application_id;
  const interactionToken = body.token;

  // Ack inside the 3-second window; DB + PATCH @original happen in after().
  after(() => resolveApproval(verb, actionId, discordUserId, appId, interactionToken));

  return NextResponse.json({ type: DEFERRED_UPDATE_MESSAGE });
}
