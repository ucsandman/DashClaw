// __tests__/unit/policy-review-repository.test.ts
import { describe, expect, it } from 'vitest';
import { groupWarnDecisions, toIso } from '@/lib/repositories/policy-review.repository';

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

  it('groups a row whose created_at is a Date instance with an ISO latest_at', () => {
    const dateObj = new Date('2026-06-10T03:00:00Z');
    const row = {
      id: 'abc',
      action_type: 'api',
      context: JSON.stringify({ target: 'https://api.stripe.com/v1/a' }),
      created_at: dateObj,
      decision: 'warn',
    };
    const groups = groupWarnDecisions([row], {});
    expect(groups).toHaveLength(1);
    // latest_at must be the ISO string so the dismissal comparison works
    expect(groups[0]!.latest_at).toBe('2026-06-10T03:00:00.000Z');
  });

  it('correctly handles Postgres space-format created_at vs ISO dismissal stamp', () => {
    // Neon driver may return '2026-06-10 06:00:00' (UTC, no zone suffix)
    // Dismissal is at 05:00:00Z — the row is NEWER, so the group must survive.
    const row = {
      id: 'def',
      action_type: 'api',
      context: JSON.stringify({ target: 'https://api.stripe.com/v1/b' }),
      created_at: '2026-06-10 06:00:00',
      decision: 'warn',
    };
    const groups = groupWarnDecisions([row], { 'api::api.stripe.com': '2026-06-10T05:00:00Z' });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.latest_at).toBe('2026-06-10T06:00:00Z');
  });
});

describe('toIso', () => {
  it('returns empty string for null/undefined', () => {
    expect(toIso(null)).toBe('');
    expect(toIso(undefined)).toBe('');
    expect(toIso('')).toBe('');
  });

  it('converts a Date instance to ISO string', () => {
    const d = new Date('2026-06-10T03:00:00Z');
    expect(toIso(d)).toBe('2026-06-10T03:00:00.000Z');
  });

  it('converts Postgres space-format (no zone suffix) to ISO with Z', () => {
    expect(toIso('2026-06-10 06:00:00')).toBe('2026-06-10T06:00:00Z');
  });

  it('leaves already-ISO strings unchanged', () => {
    expect(toIso('2026-06-10T06:00:00Z')).toBe('2026-06-10T06:00:00Z');
  });

  it('leaves strings with a timezone offset unchanged', () => {
    expect(toIso('2026-06-10 06:00:00+02:00')).toBe('2026-06-10 06:00:00+02:00');
  });
});
