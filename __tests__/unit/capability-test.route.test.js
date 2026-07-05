import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockPrepareCapabilityInvocation,
  mockExecuteCapabilityInvocation,
  mockUpdateCapability,
  mockCreateActionRecord,
  mockUpdateActionOutcome,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockPrepareCapabilityInvocation: vi.fn(),
  mockExecuteCapabilityInvocation: vi.fn(),
  mockUpdateCapability: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockUpdateActionOutcome: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId, getUserId: () => 'key_test1' }));
vi.mock('@/lib/capability-runtime.js', () => ({
  prepareCapabilityInvocation: mockPrepareCapabilityInvocation,
  executeCapabilityInvocation: mockExecuteCapabilityInvocation,
}));
vi.mock('@/lib/repositories/capabilities.repository.js', () => ({
  updateCapability: mockUpdateCapability,
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: mockCreateActionRecord,
  updateActionOutcome: mockUpdateActionOutcome,
}));
vi.mock('@/lib/apiErrors.js', () => ({
  apiErrorResponse: (error, label) => new Response(JSON.stringify({ error: error.message, label }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  }),
}));

import { POST } from '@/api/capabilities/[capabilityId]/test/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_1');
  mockUpdateCapability.mockResolvedValue({});
  mockCreateActionRecord.mockResolvedValue({});
  mockUpdateActionOutcome.mockResolvedValue({});
});

describe('POST /api/capabilities/[capabilityId]/test', () => {
  it('records a successful test run and marks the capability certified', async () => {
    mockPrepareCapabilityInvocation.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Research Agent', slug: 'research-agent' },
      schema: { method: 'POST' },
      endpoint: 'https://api.example.com/test',
      authHeaders: { Authorization: 'Bearer token' },
    });
    mockExecuteCapabilityInvocation.mockResolvedValue({
      success: true,
      data: { answer: 'ok' },
      elapsed_ms: 42,
    });

    const req = makeRequest('http://localhost/api/capabilities/cap_1/test', {
      body: { query: 'What is x402?' },
    });
    const res = await POST(req, { params: Promise.resolve({ capabilityId: 'cap_1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.tested).toBe(true);
    expect(body.result.answer).toBe('ok');
    expect(body.health_status).toBe('healthy');
    expect(body.certification_status).toBe('certified');
    expect(body.test_action_id).toMatch(/^act_/);
    expect(mockCreateActionRecord).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({
        orgId: 'org_1',
        actionStatus: 'running',
        data: expect.objectContaining({
          action_type: 'capability_test',
          agent_id: 'anonymous',
          systems_touched: ['capability:research-agent'],
          declared_goal: 'Test capability: Research Agent',
        }),
      }),
    );
    expect(mockUpdateActionOutcome).toHaveBeenCalledWith(mockSql, 'org_1', body.test_action_id, {
      status: 'completed',
      output_summary: JSON.stringify({ answer: 'ok' }).slice(0, 500),
      error_message: null,
      timestamp_end: expect.any(String),
      duration_ms: 42,
    });
    expect(mockUpdateCapability).toHaveBeenCalledWith(mockSql, 'org_1', 'cap_1', { health_status: 'healthy' });
  });

  it('records a failed test run and marks certification as failed', async () => {
    mockPrepareCapabilityInvocation.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Research Agent', slug: 'research-agent' },
      schema: { method: 'POST' },
      endpoint: 'https://api.example.com/test',
      authHeaders: { Authorization: 'Bearer token' },
    });
    mockExecuteCapabilityInvocation.mockResolvedValue({
      success: false,
      error: 'capability_input_invalid',
      message: 'input.query is required',
    });

    const req = makeRequest('http://localhost/api/capabilities/cap_1/test', {
      body: {},
    });
    const res = await POST(req, { params: Promise.resolve({ capabilityId: 'cap_1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('capability_input_invalid');
    expect(body.health_status).toBe('failing');
    expect(body.certification_status).toBe('failed');
    expect(body.test_action_id).toMatch(/^act_/);
    expect(mockUpdateActionOutcome).toHaveBeenCalledWith(mockSql, 'org_1', body.test_action_id, {
      status: 'failed',
      output_summary: 'input.query is required',
      error_message: 'input.query is required',
      timestamp_end: expect.any(String),
      duration_ms: 0,
    });
    expect(mockUpdateCapability).toHaveBeenCalledWith(mockSql, 'org_1', 'cap_1', { health_status: 'failing' });
  });

  it('returns 404 when capability is missing', async () => {
    mockPrepareCapabilityInvocation.mockRejectedValue(new Error('Capability not found: cap_missing'));

    const req = makeRequest('http://localhost/api/capabilities/cap_missing/test', {
      body: { query: 'x402' },
    });
    const res = await POST(req, { params: Promise.resolve({ capabilityId: 'cap_missing' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('capability_not_found');
  });
});
