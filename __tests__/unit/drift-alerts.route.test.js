import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockListAlerts, mockDetectDrift, mockComputeBaselines, mockRecordSnapshots } = vi.hoisted(() => ({
  mockListAlerts: vi.fn(),
  mockDetectDrift: vi.fn(),
  mockComputeBaselines: vi.fn(),
  mockRecordSnapshots: vi.fn(),
}));

vi.mock('@/lib/drift.js', () => ({
  listAlerts: mockListAlerts,
  detectDrift: mockDetectDrift,
  computeBaselines: mockComputeBaselines,
  recordSnapshots: mockRecordSnapshots,
}));

import { GET, POST } from '@/api/drift/alerts/route.js';

describe('/api/drift/alerts', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns alerts list', async () => {
      mockListAlerts.mockResolvedValue([
        { id: 'da_001', metric: 'risk_score', severity: 'warning', z_score: 2.5 },
      ]);
      const res = await GET(makeRequest('http://localhost/api/drift/alerts', { headers: { 'x-org-id': 'org_test' } }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.alerts).toHaveLength(1);
      expect(data.alerts[0].severity).toBe('warning');
    });

    it('passes filter params to listAlerts', async () => {
      mockListAlerts.mockResolvedValue([]);
      await GET(makeRequest('http://localhost/api/drift/alerts?severity=critical&agent_id=bot1', { headers: { 'x-org-id': 'org_test' } }));
      expect(mockListAlerts).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ severity: 'critical', agent_id: 'bot1' })
      );
    });
  });

  describe('POST', () => {
    it('runs drift detection by default', async () => {
      mockDetectDrift.mockResolvedValue({ alerts_generated: 2, alerts: [] });
      const res = await POST(makeRequest('http://localhost/api/drift/alerts', {
        headers: { 'x-org-id': 'org_test' },
        body: {},
      }));
      expect(res.status).toBe(201);
      expect(mockDetectDrift).toHaveBeenCalled();
    });

    it('computes baselines when action=compute_baselines', async () => {
      mockComputeBaselines.mockResolvedValue({ baselines_computed: 5, results: [] });
      const res = await POST(makeRequest('http://localhost/api/drift/alerts', {
        headers: { 'x-org-id': 'org_test' },
        body: { action: 'compute_baselines', lookback_days: 30 },
      }));
      expect(res.status).toBe(201);
      expect(mockComputeBaselines).toHaveBeenCalled();
    });

    it('records snapshots when action=record_snapshots', async () => {
      mockRecordSnapshots.mockResolvedValue({ snapshots_recorded: 10, results: [] });
      const res = await POST(makeRequest('http://localhost/api/drift/alerts', {
        headers: { 'x-org-id': 'org_test' },
        body: { action: 'record_snapshots' },
      }));
      expect(res.status).toBe(201);
      expect(mockRecordSnapshots).toHaveBeenCalled();
    });
  });
});
