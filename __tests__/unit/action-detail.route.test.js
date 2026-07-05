import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockValidateActionOutcome,
  mockGetActionStatus,
  mockGetActionWithRelations,
  mockUpdateActionOutcome,
  mockPublishOrgEvent,
  mockScanSensitiveData,
  mockScoreAndStoreActionEpisode,
  mockRecordLearningRecommendationEvents,
  mockMaybeFireCostAlert,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateActionOutcome: vi.fn(),
  mockGetActionStatus: vi.fn(),
  mockGetActionWithRelations: vi.fn(),
  mockUpdateActionOutcome: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn(),
  mockScoreAndStoreActionEpisode: vi.fn(),
  mockRecordLearningRecommendationEvents: vi.fn(),
  mockMaybeFireCostAlert: vi.fn(async () => ({ fired: false })),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate.js', () => ({ validateActionOutcome: mockValidateActionOutcome }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/security.js', () => ({
  scanSensitiveData: mockScanSensitiveData,
  redactAny: function redactAny(value, findings) {
    if (typeof value === 'string') {
      const scan = mockScanSensitiveData(value);
      if (!scan.clean) findings.push(...scan.findings);
      return scan.redacted;
    }
    if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
      return out;
    }
    return value;
  },
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getActionStatus: mockGetActionStatus,
  getActionWithRelations: mockGetActionWithRelations,
  updateActionOutcome: mockUpdateActionOutcome,
}));
vi.mock('@/lib/learningLoop.service.js', () => ({
  scoreAndStoreActionEpisode: mockScoreAndStoreActionEpisode,
  recordLearningRecommendationEvents: mockRecordLearningRecommendationEvents,
}));
vi.mock('@/lib/cost-alerts.js', () => ({ maybeFireCostAlert: mockMaybeFireCostAlert }));

import { GET, PATCH } from '@/api/actions/[actionId]/route.js';

function req(body) {
  return makeRequest('http://localhost/api/actions/act_1', {
    headers: { 'x-org-id': 'org_test' },
    body,
  });
}

const routeCtx = { params: Promise.resolve({ actionId: 'act_1' }) };

describe('/api/actions/[actionId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScanSensitiveData.mockReturnValue({ clean: true, redacted: '', findings: [] });
    mockScoreAndStoreActionEpisode.mockResolvedValue(null);
    mockRecordLearningRecommendationEvents.mockResolvedValue(undefined);
  });

  describe('GET', () => {
    it('returns 200 with action data', async () => {
      mockGetActionWithRelations.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
      const res = await GET(req(), routeCtx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.action_id).toBe('act_1');
    });

    it('returns 404 when action not found', async () => {
      mockGetActionWithRelations.mockResolvedValue(null);
      const res = await GET(req(), routeCtx);
      expect(res.status).toBe(404);
    });

    it('returns 500 on DB error', async () => {
      mockGetActionWithRelations.mockRejectedValue(new Error('db down'));
      const res = await GET(req(), routeCtx);
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH', () => {
    it('returns 400 on validation failure', async () => {
      mockValidateActionOutcome.mockReturnValue({ valid: false, errors: ['status required'] });
      const res = await PATCH(req({ bad: true }), routeCtx);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.details).toContain('status required');
    });

    it('returns 400 (not a 500 crash) for a null JSON body', async () => {
      // request.json() returns null for the literal body `null`; the route must
      // not crash on the early body.close_if_running read and 500.
      const res = await PATCH(req(null), routeCtx);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Validation failed');
      expect(mockValidateActionOutcome).not.toHaveBeenCalled();
    });

    it('returns 404 when action not found', async () => {
      mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
      mockUpdateActionOutcome.mockResolvedValue(null);
      const res = await PATCH(req({ status: 'completed' }), routeCtx);
      expect(res.status).toBe(404);
    });

    it('returns 200 and publishes SSE event on success', async () => {
      const updated = { action_id: 'act_1', status: 'completed', agent_id: 'a1' };
      mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
      mockUpdateActionOutcome.mockResolvedValue(updated);

      const res = await PATCH(req({ status: 'completed' }), routeCtx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.action.status).toBe('completed');

      // Verify SSE event was published
      expect(mockPublishOrgEvent).toHaveBeenCalledWith('action.updated', {
        orgId: 'org_test',
        action: updated,
      });
    });

    it('redacts sensitive data in output_summary via DLP', async () => {
      mockScanSensitiveData.mockReturnValue({
        clean: false,
        redacted: '[REDACTED]',
        findings: [{ category: 'api_key', severity: 'critical' }],
      });
      mockValidateActionOutcome.mockReturnValue({
        valid: true,
        data: { status: 'completed', output_summary: 'key=sk_live_abc123' },
        errors: [],
      });
      mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });

      const res = await PATCH(req({ status: 'completed', output_summary: 'key=sk_live_abc123' }), routeCtx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.security.clean).toBe(false);
      expect(data.security.findings_count).toBe(1);
    });

    it('continues when learning scoring fails', async () => {
      mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
      mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
      mockScoreAndStoreActionEpisode.mockRejectedValue(new Error('scoring broke'));

      const res = await PATCH(req({ status: 'completed' }), routeCtx);
      // Should still return 200 — learning is best-effort
      expect(res.status).toBe(200);
    });

    it('returns 500 on DB error', async () => {
      mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
      mockUpdateActionOutcome.mockRejectedValue(new Error('db down'));
      const res = await PATCH(req({ status: 'completed' }), routeCtx);
      expect(res.status).toBe(500);
    });

    it('surfaces cost_alert metadata in the response when a breach fires', async () => {
      mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
      mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
      mockMaybeFireCostAlert.mockResolvedValueOnce({
        fired: true,
        threshold: 1,
        signal: { severity: 'red' },
      });

      const res = await PATCH(req({ status: 'completed' }), routeCtx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.cost_alert).toEqual({ threshold: 1, severity: 'red' });
    });

    it('omits cost_alert when no breach fires', async () => {
      mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
      mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
      mockMaybeFireCostAlert.mockResolvedValueOnce({ fired: false });

      const res = await PATCH(req({ status: 'completed' }), routeCtx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).not.toHaveProperty('cost_alert');
    });

    describe('close_if_running (Stop hook contract)', () => {
      beforeEach(() => {
        // Override the default DLP mock which returns `redacted: ''`. For
        // these tests we want non-secret output_summary values to survive
        // the redaction pass untouched so we can assert on them.
        mockScanSensitiveData.mockImplementation((input) => ({
          clean: true,
          redacted: typeof input === 'string' ? input : '',
          findings: [],
        }));
      });

      it('splits close fields and token fields into two gated updates', async () => {
        // Stop hook sends close fields + tokens in one PATCH. Route must:
        //   1. send close fields (status, output_summary, timestamp_end)
        //      with gateStatus='running' — atomic compare-and-set so a
        //      terminal row written by PostToolUse isn't clobbered.
        //   2. send token fields (tokens_in, tokens_out, model)
        //      unconditionally so tokens always land.
        const fullData = {
          status: 'completed',
          output_summary: 'Auto-closed by Stop hook',
          timestamp_end: '2026-04-17T22:00:00Z',
          tokens_in: 100,
          tokens_out: 50,
          model: 'claude-opus-4-6',
        };
        mockValidateActionOutcome.mockReturnValue({ valid: true, data: fullData, errors: [] });
        const closedRow = { action_id: 'act_1', status: 'completed' };
        const tokenedRow = { action_id: 'act_1', status: 'completed', tokens_in: 100 };
        mockUpdateActionOutcome
          .mockResolvedValueOnce(closedRow)   // close call (gated)
          .mockResolvedValueOnce(tokenedRow); // token call (unconditional)

        const res = await PATCH(
          req({ ...fullData, close_if_running: true }),
          routeCtx,
        );
        expect(res.status).toBe(200);

        // Two repository calls — the close one gated, the token one not.
        expect(mockUpdateActionOutcome).toHaveBeenCalledTimes(2);
        const [, , , closeFields, closeOpts] = mockUpdateActionOutcome.mock.calls[0];
        expect(closeFields).toEqual({
          status: 'completed',
          output_summary: 'Auto-closed by Stop hook',
          timestamp_end: '2026-04-17T22:00:00Z',
        });
        expect(closeOpts).toEqual({ gateStatus: 'running', closeSource: 'stop_autoclose' });

        const [, , , tokenFields, tokenOpts] = mockUpdateActionOutcome.mock.calls[1];
        // tokenFields also carries a server-derived cost_estimate; we don't
        // pin the exact number here (it's covered by billing.test.js) but
        // we do pin the token + model fields and reject any leakage of the
        // close-only fields into this call.
        expect(tokenFields).toMatchObject({
          tokens_in: 100,
          tokens_out: 50,
          model: 'claude-opus-4-6',
        });
        expect(tokenFields).not.toHaveProperty('status');
        expect(tokenFields).not.toHaveProperty('output_summary');
        expect(tokenFields).not.toHaveProperty('timestamp_end');
        // No gate on the token call — tokens apply regardless of status.
        expect(tokenOpts).toBeUndefined();

        // Response returns the token result (most recent), not the close result.
        const body = await res.json();
        expect(body.action).toEqual(tokenedRow);
      });

      it('still records tokens when gate rejects close (already-terminal row)', async () => {
        // Simulates PostToolUse already having closed the action with a real
        // outcome. Close gate returns null (row status != 'running'), but
        // tokens still need to land.
        mockValidateActionOutcome.mockReturnValue({
          valid: true,
          data: {
            status: 'completed',
            output_summary: 'Auto-closed by Stop hook',
            timestamp_end: '2026-04-17T22:00:00Z',
            tokens_in: 42,
            tokens_out: 17,
          },
          errors: [],
        });
        const tokenedRow = { action_id: 'act_1', status: 'failed', tokens_in: 42 };
        mockUpdateActionOutcome
          .mockResolvedValueOnce(null)         // close gate mismatched
          .mockResolvedValueOnce(tokenedRow);  // tokens still apply

        const res = await PATCH(
          req({
            close_if_running: true,
            status: 'completed',
            output_summary: 'Auto-closed by Stop hook',
            timestamp_end: '2026-04-17T22:00:00Z',
            tokens_in: 42,
            tokens_out: 17,
          }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        // PostToolUse's real outcome ('failed') is preserved.
        expect(body.action).toEqual(tokenedRow);
      });

      it('re-fetches current row when gate rejects and there are no token fields', async () => {
        // A Stop hook with no usage to report still sends close_if_running.
        // If the gate mismatches (already terminal) AND there are no token
        // fields, the route falls back to GET so the response is accurate
        // rather than returning 404 for an action that plainly exists.
        mockValidateActionOutcome.mockReturnValue({
          valid: true,
          data: {
            status: 'completed',
            output_summary: 'Auto-closed by Stop hook',
            timestamp_end: '2026-04-17T22:00:00Z',
          },
          errors: [],
        });
        mockUpdateActionOutcome.mockResolvedValueOnce(null); // gate mismatched
        mockGetActionWithRelations.mockResolvedValue({
          action: { action_id: 'act_1', status: 'failed', error_message: 'real failure' },
        });

        const res = await PATCH(
          req({
            close_if_running: true,
            status: 'completed',
            output_summary: 'Auto-closed by Stop hook',
            timestamp_end: '2026-04-17T22:00:00Z',
          }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        // Caller sees the real terminal state, not a fabricated "completed".
        expect(body.action.status).toBe('failed');
      });

      it('persists outcome_metadata.spawned_agent_uuid via the UNGATED token call (Stop-hook path)', async () => {
        mockValidateActionOutcome.mockReturnValue({
          valid: true,
          data: { status: 'completed', timestamp_end: '2026-07-04T00:00:00Z' },
          errors: [],
        });
        mockUpdateActionOutcome
          .mockResolvedValueOnce({ action_id: 'act_1', status: 'completed' }) // gated close
          .mockResolvedValueOnce({ action_id: 'act_1', status: 'completed' }); // ungated lineage

        const res = await PATCH(
          req({
            close_if_running: true,
            status: 'completed',
            timestamp_end: '2026-07-04T00:00:00Z',
            outcome_metadata: { spawned_agent_uuid: 'uuid_spawn_1', exit_code: 0, error_type: 'x' },
          }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        expect(mockUpdateActionOutcome).toHaveBeenCalledTimes(2);
        // Close call stays gated; lineage rides the ungated call's options.
        expect(mockUpdateActionOutcome.mock.calls[0][4]).toEqual({ gateStatus: 'running', closeSource: 'stop_autoclose' });
        expect(mockUpdateActionOutcome.mock.calls[1][4]).toEqual({ spawnedAgentUuid: 'uuid_spawn_1' });
        // The rest of outcome_metadata stays dropped — never a repository field.
        for (const call of mockUpdateActionOutcome.mock.calls) {
          expect(call[3]).not.toHaveProperty('outcome_metadata');
          expect(call[3]).not.toHaveProperty('exit_code');
          expect(call[3]).not.toHaveProperty('error_type');
        }
      });

      it('lineage stamp still lands when the close gate rejects (already-terminal row)', async () => {
        // Sync spawn: the spawn's PostToolUse patch arrives after Stop
        // auto-closed the spawn row. The gated close returns null but the
        // ungated lineage write must still land and return the row.
        mockValidateActionOutcome.mockReturnValue({
          valid: true,
          data: { status: 'completed', timestamp_end: '2026-07-04T00:00:00Z' },
          errors: [],
        });
        const terminalRow = { action_id: 'act_1', status: 'completed' };
        mockUpdateActionOutcome
          .mockResolvedValueOnce(null)          // gate mismatched (terminal)
          .mockResolvedValueOnce(terminalRow);  // lineage write applies anyway

        const res = await PATCH(
          req({
            close_if_running: true,
            status: 'completed',
            timestamp_end: '2026-07-04T00:00:00Z',
            outcome_metadata: { spawned_agent_uuid: 'uuid_spawn_2' },
          }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        expect(mockUpdateActionOutcome).toHaveBeenCalledTimes(2);
        expect(mockUpdateActionOutcome.mock.calls[1][4]).toEqual({ spawnedAgentUuid: 'uuid_spawn_2' });
        const body = await res.json();
        expect(body.action).toEqual(terminalRow);
      });

      it('omits close_if_running from validated data so the flag never hits the DB', async () => {
        // The flag is a route-level contract, not a column. validateActionOutcome
        // is called with the full body, but only validated fields go to the
        // repository. This guards against accidentally persisting the flag.
        mockValidateActionOutcome.mockReturnValue({
          valid: true,
          data: { status: 'completed', timestamp_end: '2026-04-17T22:00:00Z' },
          errors: [],
        });
        mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });

        const res = await PATCH(
          req({ close_if_running: true, status: 'completed', timestamp_end: '2026-04-17T22:00:00Z' }),
          routeCtx,
        );
        expect(res.status).toBe(200);

        // Inspect every call — none should have close_if_running in the
        // fields object passed to the repository.
        for (const call of mockUpdateActionOutcome.mock.calls) {
          const fields = call[3];
          expect(fields).not.toHaveProperty('close_if_running');
        }
      });
    });

    describe('outcome_metadata.spawned_agent_uuid (fleet attribution, normal PATCH path)', () => {
      it('persists the key via the ungated call on the normal completion path', async () => {
        mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
        mockUpdateActionOutcome
          .mockResolvedValueOnce({ action_id: 'act_1', status: 'completed' }) // gated close
          .mockResolvedValueOnce({ action_id: 'act_1', status: 'completed' }); // ungated lineage

        const res = await PATCH(
          req({ status: 'completed', outcome_metadata: { spawned_agent_uuid: 'uuid_norm', exit_code: 1 } }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        expect(mockUpdateActionOutcome).toHaveBeenCalledTimes(2);
        expect(mockUpdateActionOutcome.mock.calls[0][4]).toEqual({ gateStatus: 'running', closeSource: 'outcome' });
        expect(mockUpdateActionOutcome.mock.calls[1][4]).toEqual({ spawnedAgentUuid: 'uuid_norm' });
        for (const call of mockUpdateActionOutcome.mock.calls) {
          expect(call[3]).not.toHaveProperty('outcome_metadata');
          expect(call[3]).not.toHaveProperty('exit_code');
        }
      });

      it('ignores a non-string or oversized spawned_agent_uuid (no extra repository call)', async () => {
        mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
        mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });

        let res = await PATCH(
          req({ status: 'completed', outcome_metadata: { spawned_agent_uuid: 12345 } }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        expect(mockUpdateActionOutcome).toHaveBeenCalledTimes(1); // gated close only

        mockUpdateActionOutcome.mockClear();
        mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
        res = await PATCH(
          req({ status: 'completed', outcome_metadata: { spawned_agent_uuid: 'x'.repeat(201) } }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        expect(mockUpdateActionOutcome).toHaveBeenCalledTimes(1);
      });

      it('ignores a non-object outcome_metadata', async () => {
        mockValidateActionOutcome.mockReturnValue({ valid: true, data: { status: 'completed' }, errors: [] });
        mockUpdateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
        const res = await PATCH(
          req({ status: 'completed', outcome_metadata: 'uuid_not_an_object' }),
          routeCtx,
        );
        expect(res.status).toBe(200);
        expect(mockUpdateActionOutcome).toHaveBeenCalledTimes(1);
      });
    });
  });
});
