import { describe, expect, it } from 'vitest';
import {
  mapRequest,
  mapResponse,
  resolveEndpointUrl,
  resolveInputPlaceholders,
  resolveSettingsInMapping,
} from '../../app/lib/mapping.js';

describe('mapRequest', () => {
  it('maps flat fields from source using dot-paths', () => {
    const source = { query: 'What is x402?', budget: 0.25 };
    const mapping = { query: '$.query', budget: '$.budget' };
    expect(mapRequest(source, mapping)).toEqual({ query: 'What is x402?', budget: 0.25 });
  });

  it('maps nested output structure', () => {
    const source = { query: 'test', budget: 0.5, mode: 'live' };
    const mapping = {
      query: '$.query',
      options: { budget: '$.budget', mode: '$.mode' },
    };
    expect(mapRequest(source, mapping)).toEqual({
      query: 'test',
      options: { budget: 0.5, mode: 'live' },
    });
  });

  it('omits fields when source path is undefined', () => {
    const source = { query: 'test' };
    const mapping = { query: '$.query', missing: '$.nonexistent' };
    expect(mapRequest(source, mapping)).toEqual({ query: 'test' });
  });

  it('returns source as-is when mapping is null or empty', () => {
    const source = { query: 'test' };
    expect(mapRequest(source, null)).toEqual({ query: 'test' });
    expect(mapRequest(source, {})).toEqual({ query: 'test' });
  });
});

describe('mapResponse', () => {
  it('maps response fields using dot-paths', () => {
    const source = { answer: 'hello', elapsedMs: 1200 };
    const mapping = { answer: '$.answer', elapsed_ms: '$.elapsedMs' };
    expect(mapResponse(source, mapping)).toEqual({ answer: 'hello', elapsed_ms: 1200 });
  });

  it('returns source as-is when mapping is null', () => {
    const source = { raw: 'data' };
    expect(mapResponse(source, null)).toEqual({ raw: 'data' });
  });
});

describe('resolveEndpointUrl', () => {
  it('replaces ${VAR} with values from settings', () => {
    const url = '${RESEARCH_API_URL}/v1/research';
    const settings = { RESEARCH_API_URL: 'http://localhost:3849' };
    expect(resolveEndpointUrl(url, settings)).toBe('http://localhost:3849/v1/research');
  });

  it('throws when a variable is not found in settings', () => {
    const url = '${MISSING_VAR}/path';
    try {
      resolveEndpointUrl(url, {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('endpoint_not_configured');
      expect(err.message).toContain('MISSING_VAR');
    }
  });

  it('returns url as-is when no variables present', () => {
    const url = 'http://example.com/api';
    expect(resolveEndpointUrl(url, {})).toBe('http://example.com/api');
  });

  it('leaves ${input.*} placeholders untouched while resolving settings', () => {
    const url = '${API_BASE}/domains/${input.domain}/buy';
    const settings = { API_BASE: 'https://api.example.com' };
    expect(resolveEndpointUrl(url, settings)).toBe('https://api.example.com/domains/${input.domain}/buy');
  });
});

describe('resolveInputPlaceholders', () => {
  it('substitutes and URL-encodes ${input.<field>} from the invocation body', () => {
    const url = 'https://api.example.com/domains/${input.domain}/buy';
    expect(resolveInputPlaceholders(url, { domain: 'x y.com' })).toBe(
      'https://api.example.com/domains/x%20y.com/buy',
    );
  });

  it('throws capability_input_invalid when the field is missing', () => {
    const url = 'https://api.example.com/domains/${input.domain}/buy';
    try {
      resolveInputPlaceholders(url, {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('capability_input_invalid');
    }
  });

  it('throws capability_input_invalid when the field is an object', () => {
    const url = 'https://api.example.com/domains/${input.domain}/buy';
    try {
      resolveInputPlaceholders(url, { domain: { nested: true } });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('capability_input_invalid');
    }
  });
});

describe('resolveSettingsInMapping', () => {
  it('resolves a string setting', () => {
    const mapping = { registrant: '$settings.REGISTRANT_CONTACT' };
    const settings = { REGISTRANT_CONTACT: 'contact_123' };
    expect(resolveSettingsInMapping(mapping, settings)).toEqual({ registrant: 'contact_123' });
  });

  it('JSON-parses a setting whose value is a JSON object string', () => {
    const mapping = { registrant: '$settings.REGISTRANT_CONTACT' };
    const settings = { REGISTRANT_CONTACT: '{"name":"Acme","email":"a@b.com"}' };
    expect(resolveSettingsInMapping(mapping, settings)).toEqual({
      registrant: { name: 'Acme', email: 'a@b.com' },
    });
  });

  it('recurses into nested objects and arrays', () => {
    const mapping = {
      query: '$.query',
      nested: { registrant: '$settings.REGISTRANT_CONTACT' },
      list: ['$settings.REGISTRANT_CONTACT', 'literal'],
    };
    const settings = { REGISTRANT_CONTACT: 'contact_123' };
    expect(resolveSettingsInMapping(mapping, settings)).toEqual({
      query: '$.query',
      nested: { registrant: 'contact_123' },
      list: ['contact_123', 'literal'],
    });
  });

  it('leaves $.field paths and literals alone', () => {
    const mapping = { query: '$.query', mode: 'live', count: 3 };
    expect(resolveSettingsInMapping(mapping, {})).toEqual({ query: '$.query', mode: 'live', count: 3 });
  });

  it('throws endpoint_not_configured when the setting is missing', () => {
    const mapping = { registrant: '$settings.REGISTRANT_CONTACT' };
    try {
      resolveSettingsInMapping(mapping, {});
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err.code).toBe('endpoint_not_configured');
    }
  });
});
