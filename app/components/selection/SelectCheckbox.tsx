'use client';

import type { MouseEvent } from 'react';
import { Square, CheckSquare } from 'lucide-react';

interface SelectCheckboxProps {
  checked: boolean;
  onToggle: (e: MouseEvent) => void;
  label?: string;
  size?: number;
}

/**
 * The lucide Square/CheckSquare toggle used for both per-row selection and the
 * header select-all control — matches the dense /decisions aesthetic and keeps
 * every page's checkbox identical + accessible (`role="checkbox"` + aria-checked).
 */
export function SelectCheckbox({ checked, onToggle, label = 'Select', size = 16 }: SelectCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="rounded p-0.5 text-tertiary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
    >
      {checked ? <CheckSquare size={size} className="text-brand" /> : <Square size={size} aria-hidden="true" />}
    </button>
  );
}
