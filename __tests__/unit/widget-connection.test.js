import { describe, it, expect } from 'vitest';
import { deriveConnection, STALE_AFTER_MS, OFFLINE_AFTER_MS } from '@/widget/connection.js';

describe('deriveConnection', () => {
  const now = 1_700_000_000_000;

  it('live on a fresh success with no error', () => {
    expect(deriveConnection({ lastSuccessTs: now - 1_000, now, hasError: false })).toBe('live');
  });

  it('reconnecting on a recent error after a prior success', () => {
    expect(deriveConnection({ lastSuccessTs: now - 1_000, now, hasError: true })).toBe('reconnecting');
  });

  it('reconnecting when the last success is stale (but not offline-old)', () => {
    expect(deriveConnection({ lastSuccessTs: now - (STALE_AFTER_MS + 1_000), now, hasError: false })).toBe(
      'reconnecting',
    );
  });

  it('offline when there has been no success for a long time', () => {
    expect(deriveConnection({ lastSuccessTs: now - (OFFLINE_AFTER_MS + 1_000), now, hasError: false })).toBe(
      'offline',
    );
  });

  it('reconnecting before the first success (initial connect)', () => {
    expect(deriveConnection({ lastSuccessTs: null, now, hasError: false })).toBe('reconnecting');
  });

  it('offline when it has never connected and is erroring', () => {
    expect(deriveConnection({ lastSuccessTs: null, now, hasError: true })).toBe('offline');
  });
});
