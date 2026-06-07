import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { BulkActionBar } from '@/components/selection/BulkActionBar';

afterEach(cleanup);

describe('BulkActionBar', () => {
  it('renders nothing at zero selection', () => {
    const { container } = render(<BulkActionBar count={0} actions={[]} onClear={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the count in an aria-live region and renders actions', () => {
    const onDelete = vi.fn();
    const { container, getByText } = render(
      <BulkActionBar
        count={3}
        actions={[{ id: 'del', label: 'Delete', onClick: onDelete, danger: true }]}
        onClear={() => {}}
      />,
    );
    expect(getByText('3 selected')).toBeTruthy();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    fireEvent.click(getByText('Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('calls onClear from the clear button', () => {
    const onClear = vi.fn();
    const { getByLabelText } = render(<BulkActionBar count={2} actions={[]} onClear={onClear} />);
    fireEvent.click(getByLabelText('Clear selection'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('disables an action when disabled is set', () => {
    const onClick = vi.fn();
    const { getByText } = render(
      <BulkActionBar count={1} actions={[{ id: 'x', label: 'Nope', onClick, disabled: true }]} onClear={() => {}} />,
    );
    const btn = getByText('Nope').closest('button')!;
    expect(btn.disabled).toBe(true);
  });
});
