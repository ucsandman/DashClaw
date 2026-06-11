// __tests__/unit/policy-review-repository.test.ts
import { describe, expect, it } from 'vitest';
import { groupWarnDecisions } from '@/lib/repositories/policy-review.repository';

const warn = (actionType: string, target: string, createdAt: string, id = Math.random().toString(36).slice(2)) => ({
  id,
  action_type: actionType,
  context: JSON.stringify({ target }),
  created_at: createdAt,
  decision: 'warn',
});

describe('groupWarnDecisions', () => {
  it('groups rows by shape with counts and latest timestamp', () => {
    const rows = [
      warn('api', 'https://api.stripe.com/v1/a', '2026-06-10T01:00:00Z'),
      warn('api', 'https://api.stripe.com/v1/b', '2026-06-10T02:00:00Z'),
      warn('sync', 'https://hub.example.com/x', '2026-06-10T03:00:00Z'),
    ];
    const groups = groupWarnDecisions(rows, {});
    expect(groups).toHaveLength(2);
    const api = groups.find((g) => g.shape.key === 'api::api.stripe.com')!;
    expect(api.count).toBe(2);
    expect(api.latest_at).toBe('2026-06-10T02:00:00Z');
    expect(api.sample_id).toBeTruthy();
  });

  it('excludes groups dismissed after their latest decision', () => {
    const rows = [warn('api', 'https://api.stripe.com/v1/a', '2026-06-10T01:00:00Z')];
    const groups = groupWarnDecisions(rows, { 'api::api.stripe.com': '2026-06-10T05:00:00Z' });
    expect(groups).toHaveLength(0);
  });

  it('keeps a dismissed group when newer decisions arrived after dismissal', () => {
    const rows = [warn('api', 'https://api.stripe.com/v1/a', '2026-06-10T06:00:00Z')];
    const groups = groupWarnDecisions(rows, { 'api::api.stripe.com': '2026-06-10T05:00:00Z' });
    expect(groups).toHaveLength(1);
  });

  it('sorts groups by count descending', () => {
    const rows = [
      warn('sync', 'https://a.example.com/x', '2026-06-10T01:00:00Z'),
      warn('api', 'https://b.example.com/x', '2026-06-10T01:00:00Z'),
      warn('api', 'https://b.example.com/y', '2026-06-10T02:00:00Z'),
    ];
    const groups = groupWarnDecisions(rows, {});
    expect(groups[0]!.shape.action_type).toBe('api');
  });
});
