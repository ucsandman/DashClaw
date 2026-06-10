import { baseAgentId } from './agent-identity-resolve';

/**
 * Operator-initiated pairing requests ride the existing messages rails
 * (dashboard → agent inbox). Messages have no structured metadata column, so
 * the machine-readable directive is a fenced JSON block inside the body —
 * this module is the single source of that format for the dashboard (build),
 * agents/tests (parse), and docs/agent-identity.md (contract).
 */

export const PAIRING_REQUEST_KIND = 'dashclaw.pairing_request';
export const PAIRING_REQUEST_SUBJECT = 'Pairing request — enroll your agent identity';

export interface PairingRequestDirective {
  kind: typeof PAIRING_REQUEST_KIND;
  agent_id: string;
  dashboard_url: string;
  action: string;
}

export function buildPairingRequestMessage(agentId: string, dashboardUrl: string) {
  const directive: PairingRequestDirective = {
    kind: PAIRING_REQUEST_KIND,
    agent_id: agentId,
    dashboard_url: dashboardUrl,
    action: 'Generate a keypair, POST your PEM public key to /api/pairings, then await admin approval.',
  };
  const body = [
    'An operator asked this agent to enroll an identity so its actions can be cryptographically verified.',
    '',
    'How: generate a keypair locally (never share the private key), POST the public PEM to /api/pairings,',
    'then wait for admin approval. MCP agents: call the dashclaw_pair tool. Node SDK: claw.createPairing(pem).',
    'Python SDK: claw.create_pairing(pem). Details: docs/agent-identity.md.',
    '',
    '```json',
    JSON.stringify(directive, null, 2),
    '```',
  ].join('\n');

  return {
    from_agent_id: 'dashboard',
    to_agent_id: agentId,
    message_type: 'action',
    urgent: true,
    doc_ref: 'docs/agent-identity.md',
    subject: PAIRING_REQUEST_SUBJECT,
    body,
  };
}

/** Parse the fenced directive out of a message body; null when absent/invalid. */
export function parsePairingRequestDirective(body: unknown): PairingRequestDirective | null {
  if (typeof body !== 'string') return null;
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && parsed.kind === PAIRING_REQUEST_KIND && typeof parsed.agent_id === 'string') {
      return parsed as PairingRequestDirective;
    }
  } catch {
    /* not a directive */
  }
  return null;
}

export interface UnidentifiedAgent {
  agent_id: string;
  agent_name: string | null;
  action_count: number;
  last_active: string | null;
}

/**
 * Fleet agents with no identity and no pending pairing, collapsed via
 * baseAgentId so composed sub-agents (`parent:type`) — which inherit the
 * parent's identity — neither appear separately nor get spurious requests.
 */
export function computeUnidentified(
  fleetAgents: Array<Record<string, any>>,
  identifiedIds: Iterable<string>,
  pendingIds: Iterable<string>,
): UnidentifiedAgent[] {
  const covered = new Set<string>();
  for (const id of identifiedIds) covered.add(id);
  for (const id of pendingIds) covered.add(id);

  const out = new Map<string, UnidentifiedAgent>();
  for (const a of fleetAgents) {
    const rawId = String(a.agent_id || '');
    if (!rawId) continue;
    const key = baseAgentId(rawId) || rawId;
    // Covered if the collapsed id OR the raw id has an identity/pending row.
    if (covered.has(key) || covered.has(rawId)) continue;
    const existing = out.get(key);
    const actionCount = Number(a.action_count) || 0;
    const lastActive = (a.last_active as string) || null;
    if (!existing) {
      out.set(key, {
        agent_id: key,
        agent_name: key === rawId ? (a.agent_name as string) || null : null,
        action_count: actionCount,
        last_active: lastActive,
      });
    } else {
      existing.action_count += actionCount;
      if (lastActive && (!existing.last_active || lastActive > existing.last_active)) {
        existing.last_active = lastActive;
      }
      if (!existing.agent_name && key === rawId) existing.agent_name = (a.agent_name as string) || null;
    }
  }
  return Array.from(out.values()).sort((a, b) => b.action_count - a.action_count);
}
