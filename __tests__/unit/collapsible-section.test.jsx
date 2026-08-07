import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { CollapsibleSection } from '@/components/ui/CollapsibleSection';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('CollapsibleSection', () => {
  it('renders title and children when open by default', () => {
    render(
      <CollapsibleSection id="test-section" title="Pending Pairings">
        <div>section content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('Pending Pairings')).toBeTruthy();
    expect(screen.getByText('section content')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pending Pairings/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the header hides children and persists collapsed state to localStorage', () => {
    render(
      <CollapsibleSection id="test-section" title="Pending Pairings">
        <div>section content</div>
      </CollapsibleSection>
    );

    fireEvent.click(screen.getByRole('button', { name: /Pending Pairings/ }));

    expect(screen.queryByText('section content')).toBeNull();
    expect(localStorage.getItem('dashclaw.section.test-section')).toBe('0');
  });

  it('starts collapsed on remount when localStorage holds "0"', () => {
    localStorage.setItem('dashclaw.section.test-section', '0');

    render(
      <CollapsibleSection id="test-section" title="Pending Pairings">
        <div>section content</div>
      </CollapsibleSection>
    );

    expect(screen.queryByText('section content')).toBeNull();
  });

  it('forceOpen renders content even when localStorage holds "0", without writing to localStorage', () => {
    localStorage.setItem('dashclaw.section.test-section', '0');

    render(
      <CollapsibleSection id="test-section" title="Pending Pairings" forceOpen>
        <div>section content</div>
      </CollapsibleSection>
    );

    expect(screen.getByText('section content')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pending Pairings/ }).getAttribute('aria-expanded')).toBe('true');
    // forceOpen only overrides what renders — it must not itself persist "1".
    expect(localStorage.getItem('dashclaw.section.test-section')).toBe('0');
  });

  it('keeps actions clickable without toggling the section', () => {
    let actionClicks = 0;
    render(
      <CollapsibleSection
        id="test-section"
        title="Pending Pairings"
        actions={<button onClick={() => { actionClicks += 1; }}>Approve all</button>}
      >
        <div>section content</div>
      </CollapsibleSection>
    );

    fireEvent.click(screen.getByText('Approve all'));

    expect(actionClicks).toBe(1);
    expect(screen.getByText('section content')).toBeTruthy();
    expect(localStorage.getItem('dashclaw.section.test-section')).toBeNull();
  });
});
