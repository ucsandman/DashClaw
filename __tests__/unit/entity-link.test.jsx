import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import { EntityLink } from '@/components/context-menu/EntityLink';

afterEach(() => cleanup());

// Each type that has a DETAIL_PATH must render a real anchor to the right route.
const LINK_CASES = [
  ['decision', 'act_1', '/decisions/act_1'],
  ['session', 'sess_1', '/sessions/sess_1'],
  ['capability', 'cap_1', '/capabilities/cap_1'],
  ['workflow', 'wf_1', '/workflows/wf_1'],
  ['knowledge', 'col_1', '/knowledge/col_1'],
  ['policy', 'pol_1', '/policies?policy=pol_1'],
];

describe('EntityLink', () => {
  it.each(LINK_CASES)('renders an anchor for %s → %s with data-entity tags', (type, id, href) => {
    const { container } = render(<EntityLink type={type} id={id} name={`${type} name`} />);
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe(href);
    expect(a.getAttribute('data-entity-type')).toBe(type);
    expect(a.getAttribute('data-entity-id')).toBe(id);
    expect(a.textContent).toBe(`${type} name`);
  });

  it('renders a non-link span for a type without a destination, still tagged', () => {
    const { container } = render(<EntityLink type="signal" id="sig_1" name="a signal" />);
    expect(container.querySelector('a')).toBeNull();
    const span = container.querySelector('span[data-entity-type="signal"]');
    expect(span).not.toBeNull();
    expect(span.getAttribute('data-entity-id')).toBe('sig_1');
    expect(span.textContent).toBe('a signal');
  });

  it('forwards data-entity-status and falls back to the id as its label', () => {
    const { container } = render(<EntityLink type="decision" id="act_9" status="pending_approval" />);
    const a = container.querySelector('a');
    expect(a.getAttribute('data-entity-status')).toBe('pending_approval');
    expect(a.textContent).toBe('act_9');
  });
});
