/**
 * Integration: an operator "Request pairing" message round-trips the messages
 * rails end-to-end — POST /api/messages (real route: validation, redaction,
 * field limits) lands in a shared in-memory store, and the agent's inbox read
 * (GET /api/messages?direction=inbox — the same path the MCP
 * dashclaw_inbox_list tool calls) returns it with the machine-readable
 * directive intact (i.e. PII redaction did not mangle the fenced JSON).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
import {
  buildPairingRequestMessage,
  parsePairingRequestDirective,
  PAIRING_REQUEST_SUBJECT,
} from '../../app/lib/pairing-request';

const { mockSql, store } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  store: { messages: [] },
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/agents.repository.js', () => ({
  agentExistsInOrg: vi.fn(async () => true),
}));
vi.mock('@/lib/events.js', () => ({
  EVENTS: new Proxy({}, { get: (_t, k) => String(k) }),
  publishOrgEvent: vi.fn(async () => {}),
}));
// In-memory message store standing in for Postgres: createMessage captures the
// EXACT row the route built (post-redaction), listMessages applies the inbox
// semantics (to_agent_id match or broadcast).
vi.mock('@/lib/repositories/messagesContext.repository.js', () => ({
  // Real signature: createMessage(sql, payload) with orgId inside the payload.
  createMessage: vi.fn(async (sql, payload) => {
    const stored = { ...payload, org_id: payload.orgId, created_at: new Date().toISOString(), is_read: 0 };
    store.messages.push(stored);
    return stored;
  }),
  listMessages: vi.fn(async (sql, orgId, { agentId, direction }) => {
    if (direction === 'sent') return store.messages.filter((m) => m.org_id === orgId && m.from_agent_id === agentId);
    return store.messages.filter((m) => m.org_id === orgId && (m.to_agent_id === agentId || m.to_agent_id === 'all'));
  }),
  getUnreadMessageCount: vi.fn(async () => 1),
  getAttachmentsForMessages: vi.fn(async () => []),
  createAttachment: vi.fn(),
  getMessageForUpdate: vi.fn(),
  getMessagesForUpdate: vi.fn(),
  getMessageThread: vi.fn(),
  getOrgAttachmentBytes: vi.fn(async () => 0),
  archiveMessage: vi.fn(),
  batchArchiveMessages: vi.fn(),
  batchMarkMessagesRead: vi.fn(),
  markBroadcastRead: vi.fn(),
  markMessageRead: vi.fn(),
  touchMessageThread: vi.fn(),
  updateMessageReadBy: vi.fn(),
}));

const { GET, POST } = await import('@/api/messages/route.js');

beforeEach(() => {
  store.messages.length = 0;
});

describe('pairing request → agent inbox (messages rails)', () => {
  it('the request survives the real POST route and appears in the target inbox with a parseable directive', async () => {
    // 1. Operator clicks "Request pairing" — the dashboard POSTs the directive.
    const message = buildPairingRequestMessage('clawdbot', 'https://dash.example.com');
    const postRes = await POST(makeRequest('http://test/api/messages', {
      headers: { 'x-org-id': 'org_int' },
      body: message,
    }));
    expect(postRes.status).toBe(201);

    // 2. The agent's next session lists its inbox — the exact read the MCP
    //    dashclaw_inbox_list tool performs (GET /api/messages, direction=inbox).
    const inboxRes = await GET(makeRequest(
      'http://test/api/messages?agent_id=clawdbot&direction=inbox',
      { headers: { 'x-org-id': 'org_int' } },
    ));
    expect(inboxRes.status).toBe(200);
    const inbox = (await inboxRes.json()).messages;
    expect(inbox).toHaveLength(1);
    expect(inbox[0].subject).toBe(PAIRING_REQUEST_SUBJECT);
    expect(inbox[0].from_agent_id).toBe('dashboard');

    // 3. The machine-readable directive survived redaction/limits intact.
    const directive = parsePairingRequestDirective(inbox[0].body);
    expect(directive).toMatchObject({
      kind: 'dashclaw.pairing_request',
      agent_id: 'clawdbot',
      dashboard_url: 'https://dash.example.com',
    });
  });

  it('another agent does NOT see the request', async () => {
    await POST(makeRequest('http://test/api/messages', {
      headers: { 'x-org-id': 'org_int' },
      body: buildPairingRequestMessage('clawdbot', 'https://dash.example.com'),
    }));
    const otherRes = await GET(makeRequest(
      'http://test/api/messages?agent_id=deploy-runner&direction=inbox',
      { headers: { 'x-org-id': 'org_int' } },
    ));
    expect((await otherRes.json()).messages).toHaveLength(0);
  });
});
