import { describe, it, expect } from 'vitest';
import { bumpReleasePlan } from '../../scripts/lib/bump-release-plan.mjs';

const plan = (v) =>
  JSON.stringify(
    {
      node: {
        current_version: v,
        next_bump: 'none',
        reason: `no Node SDK source change in ${v} - version advances per the unified model; the tag-triggered release workflow (G7) republishes the unchanged content at ${v} so the registry stays aligned with the platform version.`,
        domains: ['platform'],
      },
      python: {
        current_version: v,
        next_bump: 'none',
        reason: `no Python SDK source change in ${v} - version advances per the unified model.`,
        domains: ['platform'],
      },
      reason: `${v} some release description. Platform only.`,
      domains: ['platform'],
    },
    null,
    2
  );

describe('bumpReleasePlan', () => {
  it('advances both current_version fields to the new version', () => {
    const out = JSON.parse(bumpReleasePlan(plan('5.15.0'), '5.16.0'));
    expect(out.node.current_version).toBe('5.16.0');
    expect(out.python.current_version).toBe('5.16.0');
  });

  it('substitutes the prior version inside every reason string', () => {
    const out = JSON.parse(bumpReleasePlan(plan('5.15.0'), '5.16.0'));
    expect(out.node.reason).not.toContain('5.15.0');
    expect(out.node.reason.match(/5\.16\.0/g)?.length).toBe(2);
    expect(out.python.reason).toContain('5.16.0');
    expect(out.reason.startsWith('5.16.0 ')).toBe(true);
  });

  it('preserves structure, next_bump, and domains untouched', () => {
    const out = JSON.parse(bumpReleasePlan(plan('5.15.0'), '5.16.0'));
    expect(out.node.next_bump).toBe('none');
    expect(out.domains).toEqual(['platform']);
    expect(Object.keys(out).sort()).toEqual(['domains', 'node', 'python', 'reason']);
  });

  it('is idempotent when the plan already carries the target version', () => {
    const once = bumpReleasePlan(plan('5.16.0'), '5.16.0');
    expect(JSON.parse(once).node.current_version).toBe('5.16.0');
    expect(JSON.parse(once).node.reason).toContain('5.16.0');
  });

  it('escapes regex metacharacters in the prior version (dots do not match any char)', () => {
    // "5.15.0" as a naive regex would also match "5x15y0" — prove it does not.
    const text = plan('5.15.0').replace(
      'some release description',
      'mentions 5x15y0 which must survive'
    );
    const out = JSON.parse(bumpReleasePlan(text, '5.16.0'));
    expect(out.reason).toContain('5x15y0 which must survive');
  });

  it('ends with a trailing newline for clean diffs', () => {
    expect(bumpReleasePlan(plan('5.15.0'), '5.16.0').endsWith('}\n')).toBe(true);
  });
});
