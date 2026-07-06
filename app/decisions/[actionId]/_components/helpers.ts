// Pure logic for the Decision Replay page, extracted from page.tsx so the
// event ordering, risk bands, and drift math are unit-testable.

export function formatTime(ts: any) {
  if (!ts) return '--';
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  } catch { return ts; }
}

export function getStatusVariant(status: string) {
  const map: Record<string, string> = {
    completed: 'success', running: 'warning', failed: 'error',
    blocked: 'error', cancelled: 'default', pending: 'info'
  };
  return map[status] || 'default';
}

export function getRiskColor(score: any) {
  const s = parseInt(score, 10);
  if (s >= 70) return 'text-error bg-error-subtle border-error/20';
  if (s >= 40) return 'text-warning bg-warning-subtle border-warning/20';
  return 'text-success bg-status-success/10 border-green-500/20';
}

export interface TimelineInputs {
  action: any;
  guardDecision: any;
  messages: any[];
  assumptions: any[];
  loops: any[];
}

export function buildTimelineEvents({ action, guardDecision, messages, assumptions, loops }: TimelineInputs) {
  if (!action) return [];
  const events: any[] = [];

  // Guard decision
  if (guardDecision) {
    events.push({
      type: 'guard',
      timestamp: guardDecision.created_at,
      data: guardDecision,
    });
  }

  // Messages
  messages.forEach(msg => {
    events.push({
      type: 'message',
      timestamp: msg.created_at,
      data: msg,
    });
  });

  // Action started
  if (action.timestamp_start) {
    events.push({
      type: 'action_start',
      timestamp: action.timestamp_start,
      data: action,
    });
  }

  // Assumptions
  assumptions.forEach(asm => {
    events.push({
      type: 'assumption',
      timestamp: asm.created_at || action.timestamp_start,
      data: asm,
    });
  });

  // Outcome
  if (action.timestamp_end) {
    events.push({
      type: 'outcome',
      timestamp: action.timestamp_end,
      data: action,
    });
  }

  // Open loops
  loops.forEach(loop => {
    events.push({
      type: 'open_loop',
      timestamp: loop.created_at || action.timestamp_end || action.timestamp_start,
      data: loop,
    });
  });

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function computeAssumptionDrift(assumptions: any[]) {
  if (!assumptions.length) return null;
  const invalidated = assumptions.filter(a => a.invalidated).length;
  const driftPct = Math.round((invalidated / assumptions.length) * 100);
  const label = driftPct === 0 ? 'Nominal' : driftPct < 34 ? 'Low' : driftPct < 67 ? 'Elevated' : 'High';
  const tone = driftPct < 34 ? 'text-success' : driftPct < 67 ? 'text-warning' : 'text-error';
  const bar = driftPct < 34 ? 'bg-status-success' : driftPct < 67 ? 'bg-status-warning' : 'bg-status-error';
  return { invalidated, driftPct, label, tone, bar };
}
