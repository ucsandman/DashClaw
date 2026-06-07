import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// The three relocated surfaces are self-contained; stub them as markers so this
// suite only verifies the disclosure + switcher wiring, i.e. that every former
// tab is still reachable after being demoted to Advanced.
vi.mock('@/policies/components/ShieldsGrid', () => ({ default: () => <div data-testid="shields-grid" /> }));
vi.mock('@/policies/components/CustomTab', () => ({ default: () => <div data-testid="custom-tab" /> }));
vi.mock('@/policies/components/ActivityTab', () => ({ default: () => <div data-testid="activity-tab" /> }));

import AdvancedSection from '@/policies/components/AdvancedSection.jsx';

describe('AdvancedSection', () => {
  it('is collapsed by default and mounts nothing heavy', () => {
    render(<AdvancedSection />);
    expect(screen.getByText('Advanced')).toBeTruthy();
    expect(screen.queryByTestId('shields-grid')).toBeNull();
    expect(screen.queryByTestId('custom-tab')).toBeNull();
    expect(screen.queryByTestId('activity-tab')).toBeNull();
  });

  it('expands to expose Shields, Custom, and Activity (no capability lost)', () => {
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));

    // Shields is the default view inside Advanced.
    expect(screen.getByTestId('shields-grid')).toBeTruthy();

    fireEvent.click(screen.getByText('Custom'));
    expect(screen.getByTestId('custom-tab')).toBeTruthy();
    expect(screen.queryByTestId('shields-grid')).toBeNull();

    fireEvent.click(screen.getByText('Activity'));
    expect(screen.getByTestId('activity-tab')).toBeTruthy();
    expect(screen.queryByTestId('custom-tab')).toBeNull();
  });
});
