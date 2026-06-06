import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PosturePill } from '@/widget/components/PosturePill';

afterEach(cleanup);

describe('PosturePill', () => {
  const cases = [
    ['calm', 'Calm'],
    ['active', 'Active'],
    ['approval', 'Approval'],
    ['elevated', 'Elevated'],
    ['offline', 'Offline'],
  ];

  for (const [status, label] of cases) {
    it(`renders an icon + visible text label for "${status}" (never color-only)`, () => {
      const { container } = render(<PosturePill status={status} />);
      // visible text label present
      expect(container.textContent).toContain(label);
      const el = container.querySelector('[role="status"]');
      expect(el).toBeTruthy();
      // accessible name carries the human-readable status
      expect(el.getAttribute('aria-label')).toContain(label);
      // a distinct icon shape accompanies the label
      expect(el.querySelector('svg')).toBeTruthy();
    });
  }

  it('falls back to the offline meta for an unknown status', () => {
    const { container } = render(<PosturePill status={'mystery'} />);
    expect(container.textContent).toContain('Offline');
  });
});
