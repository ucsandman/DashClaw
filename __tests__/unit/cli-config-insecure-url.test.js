import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The CLI sends x-api-key over whatever scheme the configured base URL has.
// resolveConfig must warn (not refuse — LAN self-hosting over http is a
// supported setup) when that scheme is plaintext http to a non-local host.
import { resolveConfig, __resetInsecureUrlWarning } from '../../cli/lib/config.js';

function envFor(baseUrl) {
  return { DASHCLAW_BASE_URL: baseUrl, DASHCLAW_API_KEY: 'oc_live_test_placeholder' };
}

describe('CLI insecure base-url warning', () => {
  let errSpy;

  beforeEach(() => {
    __resetInsecureUrlWarning();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('warns once for plaintext http to a non-local host', async () => {
    await resolveConfig({ env: envFor('http://dashclaw.example.com'), interactive: false });
    await resolveConfig({ env: envFor('http://dashclaw.example.com'), interactive: false });
    const warnings = errSpy.mock.calls.filter((c) => String(c[0]).includes('plaintext'));
    expect(warnings).toHaveLength(1);
  });

  it('does not warn for http://localhost', async () => {
    await resolveConfig({ env: envFor('http://localhost:3000'), interactive: false });
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes('plaintext'))).toHaveLength(0);
  });

  it('does not warn for http://127.0.0.1', async () => {
    await resolveConfig({ env: envFor('http://127.0.0.1:3000'), interactive: false });
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes('plaintext'))).toHaveLength(0);
  });

  it('does not warn for https', async () => {
    await resolveConfig({ env: envFor('https://my-dashclaw.vercel.app'), interactive: false });
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes('plaintext'))).toHaveLength(0);
  });
});
