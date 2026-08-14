/**
 * External policy verdict seam (RFC docs/rfcs/2026-08-13-external-policy-verdict-input.md,
 * frozen v1 contract, #219). Three layers:
 *   1. config — org-settings keys → ExternalVerdictConfig via the guard hot-path cache
 *   2. wire client — fetchExternalVerdict mapping/identity/posture (Task 2)
 *   3. seam — evaluateGuard integration, the ten #220 adversarial cases (Task 3)
 * This file is the executable conformance spec named by docs/external-verdict-provider.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(async () => []),
}));

vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));

import { createSqlMock } from '../helpers.js';
import {
  getExternalVerdictConfig,
  invalidateGuardExternalVerdictCache,
  __resetGuardCaches,
} from '../../app/lib/guard/caches';

function makeSql() {
  return createSqlMock({ taggedResponses: [[]] });
}

function settingsRows(map) {
  return Object.entries(map).map(([key, value]) => ({ key, value, encrypted: false, category: 'general' }));
}

describe('external verdict config (org-settings → guard cache)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockGetSettings.mockResolvedValue([]);
  });

  it('defaults to disabled, fail_closed, 1200ms when no settings rows exist', async () => {
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.enabled).toBe(false);
    expect(cfg.url).toBeNull();
    expect(cfg.posture).toBe('fail_closed');
    expect(cfg.timeoutMs).toBe(1200);
  });

  it('parses an enabled provider config from settings rows', async () => {
    mockGetSettings.mockResolvedValue(settingsRows({
      EXTERNAL_VERDICT_ENABLED: 'true',
      EXTERNAL_VERDICT_PROVIDER: 'agent-memory-pama',
      EXTERNAL_VERDICT_PROVIDER_URL: 'https://provider.example.com/verdict',
      EXTERNAL_VERDICT_AUTH_TOKEN: 'tok_abc',
      EXTERNAL_VERDICT_TIMEOUT_MS: '800',
      EXTERNAL_VERDICT_POSTURE: 'fail_open',
    }));
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.enabled).toBe(true);
    expect(cfg.url).toBe('https://provider.example.com/verdict');
    expect(cfg.authToken).toBe('tok_abc');
    expect(cfg.timeoutMs).toBe(800);
    expect(cfg.posture).toBe('fail_open');
    expect(cfg.providerId).toBe('agent-memory-pama');
  });

  it('clamps timeout to 100..5000 and falls back to URL host for providerId', async () => {
    mockGetSettings.mockResolvedValue(settingsRows({
      EXTERNAL_VERDICT_ENABLED: 'true',
      EXTERNAL_VERDICT_PROVIDER_URL: 'https://provider.example.com/verdict',
      EXTERNAL_VERDICT_TIMEOUT_MS: '99999',
    }));
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.providerId).toBe('provider.example.com');
  });

  it('treats an unknown posture string as fail_closed', async () => {
    mockGetSettings.mockResolvedValue(settingsRows({
      EXTERNAL_VERDICT_ENABLED: 'true',
      EXTERNAL_VERDICT_PROVIDER_URL: 'https://provider.example.com/verdict',
      EXTERNAL_VERDICT_POSTURE: 'fail_openish',
    }));
    const cfg = await getExternalVerdictConfig(makeSql(), 'org_1');
    expect(cfg.posture).toBe('fail_closed');
  });

  it('serves from cache within TTL and re-reads after invalidation', async () => {
    const sql = makeSql();
    await getExternalVerdictConfig(sql, 'org_1');
    await getExternalVerdictConfig(sql, 'org_1');
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
    invalidateGuardExternalVerdictCache('org_1');
    await getExternalVerdictConfig(sql, 'org_1');
    expect(mockGetSettings).toHaveBeenCalledTimes(2);
  });
});
