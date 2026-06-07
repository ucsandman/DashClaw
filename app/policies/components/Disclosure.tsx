'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface DisclosureProps {
  /** Always-visible trigger label. */
  summary: ReactNode;
  /** Optional secondary line under the label. */
  hint?: ReactNode;
  /** Optional trailing element rendered on the right of the trigger. */
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Visual emphasis: 'panel' = bordered card trigger, 'plain' = quiet inline link. */
  tone?: 'panel' | 'plain';
}

/**
 * Accessible collapsible region. Trigger is a real <button> carrying
 * aria-expanded + aria-controls; the panel is keyboard- and screen-reader
 * addressable. Motion is a single color/transform transition, suppressed under
 * prefers-reduced-motion.
 */
export default function Disclosure({ summary, hint, meta, children, defaultOpen = false, tone = 'panel' }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  const triggerClass =
    tone === 'panel'
      ? 'flex w-full items-center gap-3 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-left transition-colors hover:border-border-hover'
      : 'flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-tertiary transition-colors hover:text-secondary';

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={triggerClass}
      >
        <ChevronDown
          size={tone === 'panel' ? 16 : 14}
          aria-hidden="true"
          className={`shrink-0 text-tertiary transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
        <span className="min-w-0 flex-1">
          <span className={tone === 'panel' ? 'block text-sm font-medium text-secondary' : 'text-xs font-medium'}>
            {summary}
          </span>
          {hint && <span className="mt-0.5 block text-xs text-tertiary">{hint}</span>}
        </span>
        {meta && <span className="shrink-0 text-xs text-tertiary">{meta}</span>}
      </button>
      <div id={panelId} hidden={!open} className={tone === 'panel' ? 'mt-3' : 'mt-2'}>
        {open && children}
      </div>
    </div>
  );
}
