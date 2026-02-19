import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockLoadFramework, mockListFrameworks, mockMapPolicies, mockGetActivePolicies,
        mockConvertPolicies, mockGenMd, mockGenJson, mockAnalyzeGaps, mockCreateSnapshot,
        mockGetGuardEvidence, mockGetActionEvidence, mockListSnapshots } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockLoadFramework: vi.fn(),
  mockListFrameworks: vi.fn(),
  mockMapPolicies: vi.fn(),
  mockGetActivePolicies: vi.fn(),
  mockConvertPolicies: vi.fn(),
  mockGenMd: vi.fn(),
  mockGenJson: vi.fn(),
  mockAnalyzeGaps: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockGetGuardEvidence: vi.fn(),
  mockGetActionEvidence: vi.fn(),
  mockListSnapshots: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/compliance/mapper.js', () => ({ mapPolicies: mockMapPolicies, loadFramework: mockLoadFramework, listFrameworks: mockListFrameworks }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({ getActivePolicies: mockGetActivePolicies }));
vi.mock('@/lib/guardrails/converter.js', () => ({ convertPolicies: mockConvertPolicies }));
vi.mock('@/lib/compliance/reporter.js', () => ({ generateMarkdownReport: mockGenMd, generateJsonReport: mockGenJson }));
vi.mock('@/lib/compliance/analyzer.js', () => ({ analyzeGaps: mockAnalyzeGaps }));
vi.mock('@/lib/repositories/compliance.repository.js', () => ({
  createSnapshot: mockCreateSnapshot,
  listSnapshots: mockListSnapshots,
  getGuardDecisionEvidence: mockGetGuardEvidence,
  getActionRecordEvidence: mockGetActionEvidence,
}));

import { GET as ExportsGET, POST as ExportsPOST } from '@/api/compliance/exports/route.js';

describe('/api/compliance/exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockSql.mockImplementation(async () => []);
  });

  describe('GET', () => {
    it('returns export list', async () => {
      mockSql.mockResolvedValueOnce([
        { id: 'ce_001', name: 'Test Export', frameworks: '["soc2"]', status: 'completed', file_size_bytes: 1024, created_at: new Date().toISOString() },
      ]);
      const res = await ExportsGET(makeRequest('http://localhost/api/compliance/exports', { headers: { 'x-org-id': 'org_test' } }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.exports).toBeDefined();
    });
  });

  describe('POST', () => {
    it('returns 400 when frameworks missing', async () => {
      const res = await ExportsPOST(makeRequest('http://localhost/api/compliance/exports', {
        headers: { 'x-org-id': 'org_test' },
        body: { name: 'Test' },
      }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when frameworks empty', async () => {
      const res = await ExportsPOST(makeRequest('http://localhost/api/compliance/exports', {
        headers: { 'x-org-id': 'org_test' },
        body: { frameworks: [] },
      }));
      expect(res.status).toBe(400);
    });
  });
});
