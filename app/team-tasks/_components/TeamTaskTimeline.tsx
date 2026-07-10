'use client';

import {
  ArrowRightLeft, MessageSquare, CircleAlert, CheckCircle2,
  Flag, Info, PlayCircle, UserCheck, Clock,
} from 'lucide-react';

interface TeamTaskTimelineProps {
  events: any[];
}

const TYPE_META: Record<string, { icon: React.ElementType; badge: string; iconClass: string; label: string }> = {
  task_created: { icon: PlayCircle, badge: 'bg-info-subtle', iconClass: 'text-info', label: 'Created' },
  lead_assigned: { icon: UserCheck, badge: 'bg-info-subtle', iconClass: 'text-info', label: 'Lead assigned' },
  delegation: { icon: ArrowRightLeft, badge: 'bg-info-subtle', iconClass: 'text-info', label: 'Delegation' },
  reply: { icon: MessageSquare, badge: 'bg-success-subtle', iconClass: 'text-success', label: 'Reply' },
  status: { icon: Info, badge: 'bg-tertiary', iconClass: 'text-tertiary', label: 'Status' },
  approval_needed: { icon: Clock, badge: 'bg-warning-subtle', iconClass: 'text-warning', label: 'Approval needed' },
  result: { icon: Flag, badge: 'bg-success-subtle', iconClass: 'text-success', label: 'Result' },
  error: { icon: CircleAlert, badge: 'bg-error-subtle', iconClass: 'text-error', label: 'Error' },
  done: { icon: CheckCircle2, badge: 'bg-success-subtle', iconClass: 'text-success', label: 'Done' },
};

function formatTs(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

// 'status' is a literal key defined in TYPE_META above; the assertion is safe
// and only needed because noUncheckedIndexedAccess widens Record lookups to
// `T | undefined`.
const DEFAULT_META = TYPE_META.status!;

export default function TeamTaskTimeline({ events }: TeamTaskTimelineProps) {
  if (!events || events.length === 0) {
    return <div className="text-sm text-tertiary py-4">No events yet.</div>;
  }
  return (
    <div className="space-y-0">
      {events.map((event, idx) => {
        const meta = TYPE_META[event.type] ?? DEFAULT_META;
        const Icon = meta.icon;
        return (
          <div key={event.id ?? idx} className="flex gap-3 py-3">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full ${meta.badge} flex items-center justify-center flex-shrink-0`}>
                <Icon size={14} className={meta.iconClass} />
              </div>
              {idx < events.length - 1 && <div className="w-px flex-1 bg-white/[0.06] mt-2" />}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <div className="flex items-center gap-2 text-xs mb-1">
                <span className="text-tertiary">{formatTs(event.ts)}</span>
                <span className="text-tertiary uppercase font-medium">{meta.label}</span>
                <span className="text-disabled">{event.from_agent} → {event.to_agent}</span>
              </div>
              <div className="text-sm text-secondary">{event.summary}</div>
              {event.body && (
                <div className="text-xs text-tertiary mt-1 whitespace-pre-wrap">{event.body}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
