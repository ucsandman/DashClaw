import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/repositories/capabilities.repository.js', () => ({
  getCapability: vi.fn(),
}));

vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: vi.fn(),
}));

vi.mock('@/lib/capability-invoke.js', () => ({
  resolveAuth: vi.fn(),
  invokeCapability: vi.fn(),
}));

vi.mock('@/lib/mapping.js', () => ({
  resolveEndpointUrl: vi.fn(),
  resolveInputPlaceholders: vi.fn((u) => u),
  resolveSettingsInMapping: vi.fn((m) => m),
}));

vi.mock('@/lib/encryption.js', () => ({
  decrypt: vi.fn(),
}));

import {
  prepareCapabilityInvocation,
  executeCapabilityInvocation,
} from '@/lib/capability-runtime.js';
import { getCapability } from '@/lib/repositories/capabilities.repository.js';
import { getSettings } from '@/lib/repositories/settings.repository.js';
import { resolveAuth, invokeCapability } from '@/lib/capability-invoke.js';
import { resolveEndpointUrl, resolveInputPlaceholders, resolveSettingsInMapping } from '@/lib/mapping.js';
import { decrypt } from '@/lib/encryption.js';

describe('prepareCapabilityInvocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads capability and resolves auth and endpoint from org settings', async () => {
    getCapability.mockResolvedValue({
      capability_id: 'cap_1',
      source_type: 'http_api',
      invocation_schema: {
        endpoint: '${API_BASE}/search',
        method: 'POST',
        auth: { type: 'bearer', token_setting: 'API_TOKEN' },
        request_mapping: { query: '$.query' },
        response_mapping: { answer: '$.answer' },
        timeout_ms: 1234,
      },
    });
    getSettings.mockResolvedValue([
      { key: 'API_BASE', value: 'https://api.example.com/search' },
      { key: 'API_TOKEN', value: 'secret' },
    ]);
    resolveAuth.mockReturnValue({ Authorization: 'Bearer secret' });
    resolveEndpointUrl.mockReturnValue('https://api.example.com/search');

    const prepared = await prepareCapabilityInvocation({}, 'org_1', 'cap_1');

    expect(resolveAuth).toHaveBeenCalledWith(
      { type: 'bearer', token_setting: 'API_TOKEN' },
      { API_BASE: 'https://api.example.com/search', API_TOKEN: 'secret' },
    );
    expect(resolveEndpointUrl).toHaveBeenCalledWith(
      '${API_BASE}/search',
      { API_BASE: 'https://api.example.com/search', API_TOKEN: 'secret' },
    );
    expect(prepared).toEqual({
      capability: expect.objectContaining({ capability_id: 'cap_1' }),
      schema: expect.objectContaining({ method: 'POST', timeout_ms: 1234 }),
      authHeaders: { Authorization: 'Bearer secret' },
      endpoint: 'https://api.example.com/search',
      settings: { API_BASE: 'https://api.example.com/search', API_TOKEN: 'secret' },
    });
  });

  it('decrypts an encrypted settings row with AAD org_1:<KEY> and passes the plaintext to resolveAuth', async () => {
    getCapability.mockResolvedValue({
      capability_id: 'cap_1',
      source_type: 'http_api',
      invocation_schema: {
        endpoint: 'https://api.example.com/buy',
        method: 'POST',
        auth: { type: 'bearer', token_setting: 'REGISTRAR_TOKEN' },
      },
    });
    getSettings.mockResolvedValue([
      { key: 'REGISTRAR_TOKEN', value: 'v2:ciphertext', encrypted: true },
    ]);
    decrypt.mockReturnValue('plain_token');
    resolveAuth.mockReturnValue({ Authorization: 'Bearer plain_token' });
    resolveEndpointUrl.mockReturnValue('https://api.example.com/buy');

    const prepared = await prepareCapabilityInvocation({}, 'org_1', 'cap_1');

    expect(decrypt).toHaveBeenCalledWith('v2:ciphertext', 'org_1:REGISTRAR_TOKEN');
    expect(resolveAuth).toHaveBeenCalledWith(
      { type: 'bearer', token_setting: 'REGISTRAR_TOKEN' },
      { REGISTRAR_TOKEN: 'plain_token' },
    );
    expect(prepared.settings).toEqual({ REGISTRAR_TOKEN: 'plain_token' });
  });

  it('omits an encrypted settings row when decrypt returns null', async () => {
    getCapability.mockResolvedValue({
      capability_id: 'cap_1',
      source_type: 'http_api',
      invocation_schema: {
        endpoint: 'https://api.example.com/buy',
        method: 'POST',
        auth: { type: 'bearer', token_setting: 'REGISTRAR_TOKEN' },
      },
    });
    getSettings.mockResolvedValue([
      { key: 'REGISTRAR_TOKEN', value: 'v2:ciphertext', encrypted: true },
    ]);
    decrypt.mockReturnValue(null);
    resolveAuth.mockReturnValue({});
    resolveEndpointUrl.mockReturnValue('https://api.example.com/buy');

    const prepared = await prepareCapabilityInvocation({}, 'org_1', 'cap_1');

    expect(prepared.settings).toEqual({});
  });

  it('throws when capability is missing', async () => {
    getCapability.mockResolvedValue(null);

    await expect(prepareCapabilityInvocation({}, 'org_1', 'cap_missing')).rejects.toThrow(
      'Capability not found: cap_missing',
    );
  });

  it('throws when capability is not http_api', async () => {
    getCapability.mockResolvedValue({
      capability_id: 'cap_1',
      source_type: 'webhook',
    });

    await expect(prepareCapabilityInvocation({}, 'org_1', 'cap_1')).rejects.toThrow(
      'Capability cap_1 is not an http_api type',
    );
  });
});

describe('executeCapabilityInvocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes the resolved capability contract', async () => {
    invokeCapability.mockResolvedValue({
      success: true,
      data: { answer: 'ok' },
      elapsed_ms: 45,
    });

    const result = await executeCapabilityInvocation({
      endpoint: 'https://api.example.com/search',
      authHeaders: { Authorization: 'Bearer secret' },
      schema: {
        method: 'POST',
        request_mapping: { query: '$.query' },
        response_mapping: { answer: '$.answer' },
        timeout_ms: 2500,
      },
      body: { query: 'test' },
    });

    expect(invokeCapability).toHaveBeenCalledWith({
      endpoint: 'https://api.example.com/search',
      method: 'POST',
      authHeaders: { Authorization: 'Bearer secret' },
      body: { query: 'test' },
      requestMapping: { query: '$.query' },
      responseMapping: { answer: '$.answer' },
      timeoutMs: 2500,
    });
    expect(result).toEqual({
      success: true,
      data: { answer: 'ok' },
      elapsed_ms: 45,
    });
  });

  it('fails fast when input does not satisfy input_schema', async () => {
    const result = await executeCapabilityInvocation({
      endpoint: 'https://api.example.com/search',
      authHeaders: { Authorization: 'Bearer secret' },
      schema: {
        method: 'POST',
        input_schema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
          },
        },
      },
      body: {},
    });

    expect(invokeCapability).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'capability_input_invalid',
      message: expect.stringContaining("query"),
    });
  });

  it('fails when mapped output does not satisfy output_schema', async () => {
    invokeCapability.mockResolvedValue({
      success: true,
      data: {},
      elapsed_ms: 45,
    });

    const result = await executeCapabilityInvocation({
      endpoint: 'https://api.example.com/search',
      authHeaders: { Authorization: 'Bearer secret' },
      schema: {
        method: 'POST',
        output_schema: {
          type: 'object',
          required: ['answer'],
          properties: {
            answer: { type: 'string' },
          },
        },
      },
      body: { query: 'test' },
    });

    expect(result).toEqual({
      success: false,
      error: 'capability_output_invalid',
      message: expect.stringContaining("answer"),
      elapsed_ms: 45,
    });
  });

  it('resolves input placeholders in the endpoint and settings in the request mapping before invoking', async () => {
    resolveInputPlaceholders.mockReturnValue('https://api.example.com/domains/x.com/buy');
    resolveSettingsInMapping.mockReturnValue({ registrant: 'contact_123' });
    invokeCapability.mockResolvedValue({
      success: true,
      data: {},
      elapsed_ms: 12,
    });

    const settings = { REGISTRANT_CONTACT: 'contact_123' };
    await executeCapabilityInvocation({
      endpoint: 'https://api.example.com/domains/${input.domain}/buy',
      authHeaders: {},
      schema: {
        method: 'POST',
        request_mapping: { registrant: '$settings.REGISTRANT_CONTACT' },
      },
      body: { domain: 'x.com' },
      settings,
    });

    expect(resolveInputPlaceholders).toHaveBeenCalledWith(
      'https://api.example.com/domains/${input.domain}/buy',
      { domain: 'x.com' },
    );
    expect(resolveSettingsInMapping).toHaveBeenCalledWith(
      { registrant: '$settings.REGISTRANT_CONTACT' },
      settings,
    );
    expect(invokeCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://api.example.com/domains/x.com/buy',
        requestMapping: { registrant: 'contact_123' },
      }),
    );
  });

  it('fails fast without invoking when resolveInputPlaceholders throws capability_input_invalid', async () => {
    const err = new Error("Input field 'domain' is required by the capability endpoint");
    err.code = 'capability_input_invalid';
    resolveInputPlaceholders.mockImplementation(() => { throw err; });

    const result = await executeCapabilityInvocation({
      endpoint: 'https://api.example.com/domains/${input.domain}/buy',
      authHeaders: {},
      schema: { method: 'POST' },
      body: {},
    });

    expect(invokeCapability).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: 'capability_input_invalid',
      message: err.message,
    });
  });
});
