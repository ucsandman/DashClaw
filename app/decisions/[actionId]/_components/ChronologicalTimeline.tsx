'use client';

import {
  CheckCircle2, XCircle, Clock, Target,
  AlertTriangle, ShieldCheck, Rocket
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { TimelineMessage } from '../../../components/MessageTrail';
import { formatTime } from './helpers';

interface ChronologicalTimelineProps {
  timelineEvents: any[];
  messages: any[];
  messageCorrelation: string;
  messageThreadName: string | null;
}

export default function ChronologicalTimeline({
  timelineEvents, messages, messageCorrelation, messageThreadName
}: ChronologicalTimelineProps) {
  return (
    <Card hover={false}>
      <CardHeader title="Chronological Timeline" icon={Clock} count={timelineEvents.length} />
      <CardContent>
        {(messages.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-border text-[11px]">
            <span className="text-tertiary uppercase tracking-wider font-medium">
              Messages: {messages.length}
            </span>
            {messageCorrelation === 'time_window' && (
              <span
                className="text-[10px] font-bold text-warning/80 uppercase tracking-widest border border-warning/20 bg-warning-subtle rounded px-1.5 py-0.5"
                title="No messages tagged this action explicitly; showing messages sent during the action's time window."
              >
                inferred from timing
              </span>
            )}
            {messageCorrelation === 'explicit' && (
              <span
                className="text-[10px] font-bold text-success/80 uppercase tracking-widest border border-success/20 bg-success-subtle rounded px-1.5 py-0.5"
                title="Messages were tagged with this action_id by the SDK."
              >
                explicitly linked
              </span>
            )}
            {messageThreadName && (
              <span className="text-tertiary">
                Thread: <span className="text-secondary">{messageThreadName}</span>
              </span>
            )}
          </div>
        )}
        <div className="space-y-0">
          {timelineEvents.length === 0 && (
            <div className="text-sm text-tertiary py-4">No timeline events to display.</div>
          )}
          {timelineEvents.map((event, idx) => {
            if (event.type === 'message') {
              return <TimelineMessage key={`msg-${event.data.id}`} message={event.data} />;
            }
            if (event.type === 'guard') {
              return (
                <div key={`guard-${idx}`} className="flex gap-3 py-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-success-subtle flex items-center justify-center flex-shrink-0">
                      <ShieldCheck size={14} className="text-success" />
                    </div>
                    <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                      <span className="text-tertiary uppercase font-medium">Guard</span>
                    </div>
                    <div className="text-sm text-secondary">
                      Decision: <span className={event.data.decision === 'allow' ? 'text-success' : 'text-error'}>{event.data.decision?.toUpperCase()}</span>
                      {event.data.risk_score != null && <span className="text-tertiary ml-2">(risk {event.data.risk_score})</span>}
                    </div>
                  </div>
                </div>
              );
            }
            if (event.type === 'action_start') {
              return (
                <div key={`start-${idx}`} className="flex gap-3 py-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-info-subtle flex items-center justify-center flex-shrink-0">
                      <Rocket size={14} className="text-info" />
                    </div>
                    <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                      <span className="text-tertiary uppercase font-medium">Action Started</span>
                    </div>
                    <div className="text-sm text-secondary">
                      {event.data.action_type} — {event.data.declared_goal}
                    </div>
                    {event.data.reasoning && (
                      <div className="text-xs text-tertiary mt-1">{event.data.reasoning}</div>
                    )}
                  </div>
                </div>
              );
            }
            if (event.type === 'assumption') {
              return (
                <div key={`asm-${event.data.assumption_id || idx}`} className="flex gap-3 py-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                      <Target size={14} className="text-purple-400" />
                    </div>
                    <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                      <span className="text-tertiary uppercase font-medium">Assumption</span>
                      {event.data.validated ? <CheckCircle2 size={12} className="text-success" /> : event.data.invalidated ? <XCircle size={12} className="text-error" /> : <Clock size={12} className="text-tertiary" />}
                    </div>
                    <div className="text-sm text-secondary">{event.data.assumption}</div>
                  </div>
                </div>
              );
            }
            if (event.type === 'outcome') {
              const isSuccessOutcome = event.data.status === 'completed';
              return (
                <div key={`outcome-${idx}`} className="flex gap-3 py-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full ${isSuccessOutcome ? 'bg-status-success/20' : 'bg-error-subtle'} flex items-center justify-center flex-shrink-0`}>
                      {isSuccessOutcome ? <CheckCircle2 size={14} className="text-success" /> : <XCircle size={14} className="text-error" />}
                    </div>
                    <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                      <span className="text-tertiary uppercase font-medium">Outcome</span>
                    </div>
                    <div className="text-sm text-secondary">{event.data.output_summary || event.data.error_message}</div>
                    <div className="flex gap-3 text-xs text-tertiary mt-1">
                      {event.data.duration_ms && <span>{event.data.duration_ms}ms</span>}
                      {event.data.cost_estimate > 0 && <span>${parseFloat(event.data.cost_estimate).toFixed(4)}</span>}
                      {(event.data.tokens_in > 0 || event.data.tokens_out > 0) && (
                        <span>{event.data.tokens_in} in / {event.data.tokens_out} out</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
            if (event.type === 'open_loop') {
              return (
                <div key={`loop-${event.data.loop_id || idx}`} className="flex gap-3 py-3">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-status-warning/20 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle size={14} className="text-warning" />
                    </div>
                    <div className="w-px flex-1 bg-white/[0.06] mt-2" />
                  </div>
                  <div className="min-w-0 flex-1 pb-2">
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-tertiary">{formatTime(event.timestamp)}</span>
                      <span className="text-tertiary uppercase font-medium">Open Loop</span>
                      <span className={`text-xs ${event.data.status === 'open' ? 'text-warning' : 'text-success'}`}>{event.data.status}</span>
                    </div>
                    <div className="text-sm text-secondary">{event.data.description}</div>
                    <div className="text-xs text-tertiary mt-0.5">{event.data.loop_type} / {event.data.priority}</div>
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      </CardContent>
    </Card>
  );
}
