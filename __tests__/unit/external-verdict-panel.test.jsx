import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the /policies external-provider config wiring (RFC 2026-08-13 §6):
// the panel must seed from GET /api/settings, save every EXTERNAL_VERDICT_*
// key via POST /api/settings with category 'general' (the guard cache reads
// them with that exact filter), default the posture to fail_closed, and never
// clear a server-masked secret client-side (the server skips masked writes).

const { default: ExternalVerdictPanel } = await import('@/policies/components/ExternalVerdictPanel');

const CONFIGURED = [
  { key: 'EXTERNAL_VERDICT_ENABLED', value: 'true' },
  { key: 'EXTERNAL_VERDICT_PROVIDER', value: 'agent-memory-pama' },
  { key: 'EXTERNAL_VERDICT_PROVIDER_URL', value: '••••••••dict' },
  { key: 'EXTERNAL_VERDICT_TIMEOUT_MS', value: '800' },
  { key: 'EXTERNAL_VERDICT_POSTURE', value: 'fail_open' },
];

function makeFetch(settings = CONFIGURED) {
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (String(url).startsWith('/api/settings') && method === 'GET') {
      return { ok: true, json: async () => ({ settings }) };
    }
    if (String(url) === '/api/settings' && method === 'POST') {
      return { ok: true, json: async () => ({ success: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function postedBody(fetchFn, key) {
  const call = fetchFn.mock.calls.find(
    (c) => c[0] === '/api/settings' && c[1]?.method === 'POST' && JSON.parse(c[1].body).key === key,
  );
  return call ? JSON.parse(call[1].body) : null;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('ExternalVerdictPanel', () => {
  it('seeds the form from GET /api/settings', async () => {
    global.fetch = makeFetch();
    render(<ExternalVerdictPanel />);
    await waitFor(() => expect(screen.getByDisplayValue('agent-memory-pama')).toBeTruthy());
    expect(screen.getByDisplayValue('800')).toBeTruthy();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('saves every key with category general', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<ExternalVerdictPanel />);
    await screen.findByDisplayValue('agent-memory-pama');

    fireEvent.click(screen.getByText('Save provider'));

    await waitFor(() => expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_ENABLED')).toBeTruthy());
    for (const key of [
      'EXTERNAL_VERDICT_ENABLED', 'EXTERNAL_VERDICT_PROVIDER', 'EXTERNAL_VERDICT_PROVIDER_URL',
      'EXTERNAL_VERDICT_TIMEOUT_MS', 'EXTERNAL_VERDICT_POSTURE',
    ]) {
      const body = postedBody(fetchFn, key);
      expect(body, key).toBeTruthy();
      expect(body.category, key).toBe('general');
    }
    expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_ENABLED').value).toBe('true');
    expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_POSTURE').value).toBe('fail_open');
  });

  it('defaults the posture to fail_closed on a fresh org', async () => {
    const fetchFn = makeFetch([]);
    global.fetch = fetchFn;
    render(<ExternalVerdictPanel />);
    await screen.findByRole('switch');

    fireEvent.click(screen.getByText('Save provider'));

    await waitFor(() => expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_POSTURE')).toBeTruthy());
    expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_POSTURE').value).toBe('fail_closed');
    expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_ENABLED').value).toBe('false');
  });

  it('never clears a server-masked URL client-side', async () => {
    const fetchFn = makeFetch();
    global.fetch = fetchFn;
    render(<ExternalVerdictPanel />);
    await screen.findByDisplayValue('agent-memory-pama');

    fireEvent.click(screen.getByText('Save provider'));

    await waitFor(() => expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_PROVIDER_URL')).toBeTruthy());
    // Untouched masked value goes back as-is; the server's masked-write skip
    // keeps the stored secret. An empty string here would DELETE the URL.
    expect(postedBody(fetchFn, 'EXTERNAL_VERDICT_PROVIDER_URL').value).toBe('••••••••dict');
  });
});
