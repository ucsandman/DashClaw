import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));

import { detectSentiment, autoTag } from '@/lib/feedback.js';

describe('detectSentiment', () => {
  it('detects positive sentiment', () => {
    expect(detectSentiment('This is great, excellent work!')).toBe('positive');
    expect(detectSentiment('Amazing results, love it')).toBe('positive');
  });

  it('detects negative sentiment', () => {
    expect(detectSentiment('This is terrible, awful experience')).toBe('negative');
    expect(detectSentiment('Broken and frustrating')).toBe('negative');
  });

  it('detects neutral sentiment', () => {
    expect(detectSentiment('The system processed the request')).toBe('neutral');
  });

  it('handles empty input', () => {
    expect(detectSentiment('')).toBe('neutral');
  });

  it('handles mixed sentiment (majority wins)', () => {
    // More positive words than negative
    const result = detectSentiment('Great and excellent but one bad thing');
    expect(['positive', 'neutral']).toContain(result);
  });
});

describe('autoTag', () => {
  it('tags performance-related feedback', () => {
    const tags = autoTag('Response was very slow, latency is terrible');
    expect(tags).toContain('performance');
  });

  it('tags accuracy-related feedback', () => {
    const tags = autoTag('The output was wrong and inaccurate');
    expect(tags).toContain('accuracy');
  });

  it('tags cost-related feedback', () => {
    const tags = autoTag('Too expensive, high cost per query');
    expect(tags).toContain('cost');
  });

  it('tags security-related feedback', () => {
    const tags = autoTag('Concerned about data privacy and security');
    expect(tags).toContain('security');
  });

  it('tags reliability feedback', () => {
    const tags = autoTag('Keeps crashing with errors and timeouts');
    expect(tags).toContain('reliability');
  });

  it('tags UX feedback', () => {
    const tags = autoTag('The interface is confusing and hard to use');
    expect(tags).toContain('ux');
  });

  it('returns empty array for untaggable text', () => {
    const tags = autoTag('Lorem ipsum dolor sit amet');
    expect(tags).toEqual([]);
  });

  it('returns multiple tags when applicable', () => {
    const tags = autoTag('Slow, inaccurate, and expensive');
    expect(tags.length).toBeGreaterThanOrEqual(2);
    expect(tags).toContain('performance');
    expect(tags).toContain('accuracy');
  });
});
