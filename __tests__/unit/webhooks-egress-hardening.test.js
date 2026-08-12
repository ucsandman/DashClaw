/**
 * Outbound-delivery hardening regressions (adversarial review, 2026-08-11):
 *   1. the delivery timeout must cover the BODY read, not just the headers
 *   2. fireWebhooksForApproval must not resolve before its POSTs settle
 *   3. failure_count must increment server-side or the breaker never trips
 *   4. org-webhook signatures must bind a timestamp
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { createSqlMock } from '../helpers.js';

const { mockDnsLookup, mockFetch } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup, resolve4: vi.fn() },
  lookup: mockDnsLookup,
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: (v) => ({ clean: true, redacted: v, findings: [] }) }));
vi.stubGlobal('fetch', mockFetch);
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetch: (...args) => mockFetch(...args) };
});

import {
  deliverGuardWebhook,
  deliverWebhook,
  fireWebhooksForApproval,
  updateWebhookFailureState,
} from '@/lib/webhooks.js';
import { invokeCapability } from '@/lib/capability-invoke.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

/**
 * A response whose body never produces a byte and never ends — the "answers
 * 200, then trickles forever" host. text() hangs the same way a real one does.
 */
function neverEndingResponse() {
  return {
    ok: true,
    status: 200,
    body: { async *[Symbol.asyncIterator]() { await new Promise(() => {}); } },
    text: () => new Promise(() => {}),
  };
}

/**
 * A response that keeps producing 1 KiB chunks. text() drains the whole stream
 * (what a real Response.text() does), so anything that buffers before
 * truncating never finishes.
 */
function endlessBodyResponse() {
  const state = { chunks: 0 };
  const chunk = new TextEncoder().encode('x'.repeat(1024));
  const body = {
    async *[Symbol.asyncIterator]() {
      // Macrotask-paced so an unbounded reader still yields to the event loop.
      while (state.chunks < 100000) {
        await new Promise((r) => setTimeout(r, 1));
        state.chunks += 1;
        yield chunk;
      }
    },
  };
  return {
    state,
    res: {
      ok: true,
      status: 200,
      body,
      text: async () => {
        let out = '';
        for await (const c of body) out += new TextDecoder().decode(c);
        return out;
      },
    },
  };
}

describe('delivery timeout covers the response body', () => {
  it('aborts a guard delivery whose body never arrives', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    mockFetch.mockResolvedValue(neverEndingResponse());

    const result = await deliverGuardWebhook({
      url: 'https://example.com/guard',
      policyId: 'pol_1',
      orgId: 'org_1',
      payload: { a: 1 },
      timeoutMs: 50,
      sql,
    });

    expect(result.success).toBe(false);
    expect(sql.taggedCalls[0].values[5]).toBe('failed');
    expect(sql.taggedCalls[0].values[7]).toBe('Request timed out');
  }, 3000);

  it('stops reading a webhook response after the byte cap instead of buffering it all', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    const { state, res } = endlessBodyResponse();
    mockFetch.mockResolvedValue(res);

    const result = await deliverWebhook({
      webhookId: 'wh_1',
      orgId: 'org_1',
      url: 'https://example.com/hook',
      secret: 'sec123',
      eventType: 'signals.detected',
      payload: { a: 1 },
      sql,
    });

    expect(result.success).toBe(true);
    // 8 KiB cap, 1 KiB chunks — a handful of reads, not the whole stream.
    expect(state.chunks).toBeLessThanOrEqual(16);
    expect(sql.taggedCalls[0].values[7].length).toBe(2000);
  }, 3000);

  it('times out a capability whose JSON body never arrives', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });

    const result = await invokeCapability({
      endpoint: 'https://example.com/capability',
      method: 'POST',
      body: { a: 1 },
      timeoutMs: 50,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('capability_timeout');
  }, 3000);
});

describe('fireWebhooksForApproval promise represents the work', () => {
  it('does not resolve until the delivery settles', async () => {
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'wh_1', url: 'https://example.com/hook', secret: 'sec', events: '["all"]', failure_count: 0 }],
        [], // delivery INSERT
        [{ failure_count: 0, active: 1 }], // failure state UPDATE
      ],
    });

    let releaseFetch;
    mockFetch.mockReturnValue(new Promise((resolve) => { releaseFetch = resolve; }));

    let settled = false;
    const fired = fireWebhooksForApproval('org_1', 'approval_pending', { action_id: 'act_1' }, sql)
      .then(() => { settled = true; });

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    releaseFetch({ ok: true, status: 200, text: async () => 'ok' });
    await fired;

    expect(settled).toBe(true);
    // The delivery audit row is committed by the time the promise resolves.
    expect(sql.taggedCalls.some((c) => c.text.includes('INSERT INTO webhook_deliveries'))).toBe(true);
  });
});

/**
 * Models the one thing that matters here: a server-side expression reads the
 * CURRENT row, a bound value overwrites whatever the caller last saw.
 */
function makeCounterSql(initial = 0) {
  const row = { failure_count: initial, active: 1 };
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...values.map(() => '?'));
    if (!/UPDATE webhooks/.test(text)) return Promise.resolve([]);

    if (/failure_count\s*=\s*COALESCE\(failure_count/.test(text)) {
      row.failure_count = (row.failure_count || 0) + 1;
      if (/active = CASE WHEN/.test(text) && row.failure_count >= 10) row.active = 0;
    } else if (/failure_count = 0/.test(text)) {
      row.failure_count = 0;
    } else if (/failure_count = \?/.test(text)) {
      row.failure_count = values[0];
      if (/active = 0/.test(text)) row.active = 0;
    }
    return Promise.resolve([{ failure_count: row.failure_count, active: row.active }]);
  };
  sql.row = row;
  return sql;
}

describe('failure_count increments survive concurrency', () => {
  const stale = { id: 'wh_1', failure_count: 0 };

  it('counts every overlapping failure, not just the last write', async () => {
    const sql = makeCounterSql(0);

    await Promise.all([
      updateWebhookFailureState(stale, 'org_1', false, sql),
      updateWebhookFailureState(stale, 'org_1', false, sql),
      updateWebhookFailureState(stale, 'org_1', false, sql),
    ]);

    expect(sql.row.failure_count).toBe(3);
  });

  it('trips the disable breaker at 10 even when every caller read a stale count', async () => {
    const sql = makeCounterSql(0);

    await Promise.all(
      Array.from({ length: 10 }, () => updateWebhookFailureState(stale, 'org_1', false, sql))
    );

    expect(sql.row.failure_count).toBe(10);
    expect(sql.row.active).toBe(0);
  });

  it('still resets to zero on success', async () => {
    const sql = makeCounterSql(7);
    await updateWebhookFailureState(stale, 'org_1', true, sql);
    expect(sql.row.failure_count).toBe(0);
  });
});

describe('org webhook signature binds a timestamp', () => {
  it('ships the timestamped v1 signature alongside the legacy header', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await deliverWebhook({
      webhookId: 'wh_1',
      orgId: 'org_1',
      url: 'https://example.com/hook',
      secret: 'sec123',
      eventType: 'approval_pending',
      payload: { a: 1 },
      sql,
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    const ts = headers['X-DashClaw-Timestamp'];
    expect(ts).toMatch(/^\d+$/);

    const expected = crypto.createHmac('sha256', 'sec123').update(`${ts}.{"a":1}`).digest('hex');
    expect(headers['X-DashClaw-Signature-V1']).toBe(`v1=${expected}`);
    // Legacy receivers keep working: the plain body HMAC is unchanged.
    expect(headers['X-DashClaw-Signature']).toBe(
      crypto.createHmac('sha256', 'sec123').update('{"a":1}').digest('hex')
    );
  });
});
