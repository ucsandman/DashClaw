import React from 'react';
import { ShieldCheck, Activity, Clock, AlertTriangle, WifiOff, type LucideIcon } from 'lucide-react';
import type { WidgetPostureStatus } from '../../lib/widget/summary';

// `offline` is a client-only state (connection lost) layered on top of the
// server-computed operational posture.
export type PosturePillStatus = WidgetPostureStatus | 'offline';

interface PostureMeta {
  label: string;
  Icon: LucideIcon;
  /** Token text color — brand orange is reserved for "needs you" (approval). */
  tone: string;
  hint: string;
}

const POSTURE: Record<PosturePillStatus, PostureMeta> = {
  calm: { label: 'Calm', Icon: ShieldCheck, tone: 'text-success', hint: 'All clear' },
  active: { label: 'Active', Icon: Activity, tone: 'text-info', hint: 'Agents working' },
  approval: { label: 'Approval', Icon: Clock, tone: 'text-brand', hint: 'Waiting for approval' },
  elevated: { label: 'Elevated', Icon: AlertTriangle, tone: 'text-error', hint: 'Elevated risk' },
  offline: { label: 'Offline', Icon: WifiOff, tone: 'text-tertiary', hint: 'Disconnected' },
};

/**
 * Header posture pill. Always pairs an icon (distinct shape per state) AND a
 * text label — never color alone (WCAG). No motion: calm under pressure.
 */
export function PosturePill({ status }: { status: PosturePillStatus }) {
  const meta = POSTURE[status] ?? POSTURE.offline;
  const Icon = meta.Icon;
  return (
    <span
      role="status"
      aria-label={`Status: ${meta.label} — ${meta.hint}`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-tertiary px-2.5 py-1 text-xs font-semibold ${meta.tone}`}
    >
      <Icon size={13} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
