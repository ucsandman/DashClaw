'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type StatusLevel = 'ok' | 'info' | 'warn' | 'critical';

const LEVEL_DOT: Record<StatusLevel, string> = {
  ok: 'bg-status-success',
  info: 'bg-status-info',
  warn: 'bg-status-warning',
  critical: 'bg-status-error',
};
const LEVEL_TEXT: Record<StatusLevel, string> = {
  ok: 'text-success',
  info: 'text-info',
  warn: 'text-warning',
  critical: 'text-error',
};

interface CategoryStatusRowProps {
  icon: LucideIcon;
  label: string;
  /** Short status word (e.g. "Clear", "3 open") — paired with the dot so status is never color-alone. */
  statusWord: string;
  level: StatusLevel;
  count: number;
  href: string;
  active: boolean;
  onToggle: () => void;
}

/**
 * One governance-category row in the left scorecard. It is BOTH a status readout
 * (icon + label + AA status glyph + count) AND a filter control for the live
 * ledger (aria-pressed). A nested chevron link drills into the deep page.
 */
export function CategoryStatusRow({ icon: Icon, label, statusWord, level, count, href, active, onToggle }: CategoryStatusRowProps) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-md pr-1 transition-colors ${active ? 'bg-brand-subtle' : 'hover:bg-white/[0.04]'}`}
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left"
      >
        <Icon size={14} className="shrink-0 text-tertiary" aria-hidden="true" />
        <span className="flex-1 truncate text-sm text-secondary">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_DOT[level]}`} aria-hidden="true" />
          <span className={`text-[11px] tabular-nums ${LEVEL_TEXT[level]}`}>{statusWord}</span>
        </span>
        <span className="ml-2 shrink-0 text-sm font-semibold tabular-nums text-white">{count}</span>
      </button>
      <Link
        href={href}
        aria-label={`Open ${label}`}
        className="shrink-0 rounded p-1 text-tertiary transition-colors hover:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <ChevronRight size={13} aria-hidden="true" />
      </Link>
    </div>
  );
}
