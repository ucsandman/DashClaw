'use client';

import { Activity, Users, Clock } from 'lucide-react';
import { formatRelativeTime } from '../lib/missionHelpers';

interface CommandStripProps {
  posture: { label: string; bg: string; border: string; color: string; pulse?: boolean };
  fleetCount: number;
  healthStatus: string;
  interventionCount: number;
  lastActivity: any;
}

export function CommandStrip({ posture, fleetCount, healthStatus, interventionCount, lastActivity }: CommandStripProps) {
  const healthDot =
    healthStatus === 'healthy' ? 'bg-status-success' : healthStatus === 'degraded' ? 'bg-status-warning' : 'bg-[var(--color-text-disabled)]';
  const healthLabel = healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'degraded' ? 'Degraded' : 'Unknown';
  const healthColor = healthStatus === 'healthy' ? 'text-success' : healthStatus === 'degraded' ? 'text-warning' : 'text-tertiary';

  return (
    <div className="mb-5 rounded-xl border border-border bg-surface-tertiary px-5 py-3">
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Posture</span>
          <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 ${posture.bg} ${posture.border}`} role="status" aria-label={`Posture ${posture.label}`}>
            <div className={`h-1.5 w-1.5 rounded-full ${posture.color.replace('text-', 'bg-')} ${posture.pulse ? 'animate-pulse' : ''}`} />
            <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${posture.color}`}>{posture.label}</span>
          </div>
        </div>

        <div className="hidden h-3.5 w-px bg-border sm:block" />

        <div className="flex items-center gap-2">
          <Users size={13} className="text-tertiary" aria-hidden="true" />
          <span className="text-sm font-medium tabular-nums text-white">{fleetCount}</span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">agents</span>
        </div>

        <div className="hidden h-3.5 w-px bg-border sm:block" />

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Database</span>
          <span className={`h-1.5 w-1.5 rounded-full ${healthDot}`} aria-hidden="true" />
          <span className={`text-sm font-medium ${healthColor}`}>{healthLabel}</span>
        </div>

        <div className="hidden h-3.5 w-px bg-border sm:block" />

        <div className="flex items-center gap-2">
          <Activity size={13} className="text-tertiary" aria-hidden="true" />
          <span className="text-sm font-medium tabular-nums text-white">{interventionCount}</span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">
            {interventionCount === 1 ? 'intervention' : 'interventions'}
          </span>
        </div>

        <div className="hidden h-3.5 w-px bg-border sm:block" />

        <div className="hidden items-center gap-2 sm:flex">
          <Clock size={13} className="text-tertiary" aria-hidden="true" />
          <span className="text-sm tabular-nums text-secondary">{formatRelativeTime(lastActivity)}</span>
        </div>
      </div>
    </div>
  );
}
