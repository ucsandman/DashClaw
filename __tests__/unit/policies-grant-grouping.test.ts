import { describe, it, expect } from 'vitest';
import { groupGrants, formatTarget, addedWithinDays } from '@/policies/lib/grantGrouping';

const g = (policy_id: string, shape_key: string, created_at: string | null = null) => ({
  policy_id,
  label: shape_key.replace('::', ' → '),
  shape_key,
  created_at,
});

describe('groupGrants', () => {
  it('groups rules by action type, largest group first', () => {
    const groups = groupGrants([
      g('p1', 'api::stripe.com'),
      g('p2', 'file_write::C:\\Users\\x\\a.py'),
      g('p3', 'file_write::C:\\Users\\x\\b.py'),
      g('p4', 'deploy::'),
    ]);
    expect(groups.map((x) => x.type)).toEqual(['file_write', 'api', 'deploy']);
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it('dedupes identical shape_keys into one row carrying every policy id', () => {
    const groups = groupGrants([
      g('p1', 'api::stripe.com'),
      g('p2', 'api::stripe.com'),
      g('p3', 'api::github.com'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows).toHaveLength(2);
    const dup = groups[0]!.rows.find((r) => r.target === 'stripe.com')!;
    expect(dup.policy_ids).toEqual(['p1', 'p2']);
    expect(groups[0]!.policy_ids).toHaveLength(3);
  });

  it('handles a missing target as a null-target row', () => {
    const groups = groupGrants([g('p1', 'deploy::')]);
    expect(groups[0]!.rows[0]!.target).toBeNull();
  });
});

describe('formatTarget', () => {
  it('returns short targets untouched', () => {
    expect(formatTarget('stripe.com').display).toBe('stripe.com');
  });

  it('renders long paths basename-first with a middle-truncated dir and keeps the full path', () => {
    const full = 'C:\\Users\\sandm\\.claude\\plugins\\cache\\some\\deeply\\nested\\path\\dashclaw_pretool.py';
    const out = formatTarget(full, 48);
    expect(out.full).toBe(full);
    expect(out.display.startsWith('dashclaw_pretool.py')).toBe(true);
    expect(out.display).toContain('…');
    expect(out.display.length).toBeLessThan(full.length);
  });

  it('labels an empty target', () => {
    expect(formatTarget(null).display).toBe('(any target)');
  });
});

describe('addedWithinDays', () => {
  it('counts only grants created inside the window', () => {
    const now = new Date('2026-06-12T00:00:00Z');
    const n = addedWithinDays(
      [
        g('p1', 'a::x', '2026-06-10T00:00:00Z'),
        g('p2', 'a::y', '2026-05-01T00:00:00Z'),
        g('p3', 'a::z', null),
      ],
      7,
      now,
    );
    expect(n).toBe(1);
  });
});
