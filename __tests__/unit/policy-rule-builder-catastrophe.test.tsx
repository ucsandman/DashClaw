import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { default: PolicyRuleBuilderSection } = await import(
  '@/policies/components/PolicyRuleBuilderSection'
);

const baseForm = {
  type: 'catastrophe_floor',
  name: 'Catastrophe Floor',
  action: 'require_approval',
  actionTypes: [],
  floorMinRisk: 85,
  floorRequireIrreversible: true,
  ungrantable: false,
};

function renderSection(form = baseForm, onChange = () => {}) {
  return render(
    <PolicyRuleBuilderSection form={form} actionOptions={['deploy', 'message']} onChange={onChange} />,
  );
}

describe('PolicyRuleBuilderSection — catastrophe_floor', () => {
  it('renders the catastrophe floor fields (action types, min risk, irreversible, ungrantable)', () => {
    renderSection();
    expect(screen.getByText('Destructive Action Types (required)')).toBeTruthy();
    expect(screen.getByLabelText('Catastrophe floor minimum risk score')).toBeTruthy();
    expect(screen.getByLabelText('Catastrophe floor action')).toBeTruthy();
    expect(screen.getByText('Only irreversible acts')).toBeTruthy();
    expect(screen.getByText('Ungrantable')).toBeTruthy();
  });

  it('checks the irreversible box by default', () => {
    const { container } = renderSection();
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    expect(boxes[0]!.checked).toBe(true); // floorRequireIrreversible
    expect(boxes[1]!.checked).toBe(false); // ungrantable
  });

  it('offers destructive presets as one-click toggles', () => {
    renderSection();
    expect(screen.getByText('delete_data')).toBeTruthy();
    expect(screen.getByText('drop_table')).toBeTruthy();
    expect(screen.getByText('rm_rf')).toBeTruthy();
  });

  it('toggling a preset writes the action type into the form', () => {
    const onChange = vi.fn();
    renderSection(baseForm, onChange);
    fireEvent.click(screen.getByText('delete_data'));
    expect(onChange).toHaveBeenCalledWith('actionTypes', ['delete_data']);
  });

  it('toggling ungrantable writes the flag into the form', () => {
    const onChange = vi.fn();
    const { container } = renderSection(baseForm, onChange);
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    fireEvent.click(boxes[1]!);
    expect(onChange).toHaveBeenCalledWith('ungrantable', true);
  });

  it('renders nothing catastrophe-specific for other policy types', () => {
    renderSection({ ...baseForm, type: 'rate_limit' });
    expect(screen.queryByText('Destructive Action Types (required)')).toBeNull();
  });
});
