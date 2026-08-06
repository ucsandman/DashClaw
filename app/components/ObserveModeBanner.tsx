'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShieldOff } from 'lucide-react';

interface Signal {
  type: string;
  agent_id?: string | null;
}

/**
 * Observe-mode banner (F0, governance gap audit 2026-08-05): a hook in
 * DASHCLAW_HOOK_MODE=observe logs block / require_approval verdicts and lets
 * the tool call proceed. That standing posture must be impossible to miss on
 * the surfaces where operators read verdicts — otherwise a ledger full of
 * "blocked" rows manufactures false confidence while nothing is enforced.
 * Renders nothing when every reporting agent is enforcing.
 */
export default function ObserveModeBanner() {
  const [observeAgents, setObserveAgents] = useState<string[]>([]);
  const [executedCount, setExecutedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/signals', { cache: 'no-store' });
        if (!res.ok) return; // best-effort surface — stay hidden on failure
        const json = await res.json();
        const signals: Signal[] = json.signals ?? [];
        if (cancelled) return;
        setObserveAgents(
          Array.from(new Set(
            signals.filter((s) => s.type === 'observe_mode').map((s) => s.agent_id).filter(Boolean) as string[]
          ))
        );
        setExecutedCount(signals.filter((s) => s.type === 'executed_despite_block').length);
      } catch { /* best-effort surface — stay hidden on fetch failure */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (observeAgents.length === 0 && executedCount === 0) return null;

  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-error bg-status-error-subtle px-4 py-3">
      <ShieldOff size={16} className="shrink-0 text-status-error" aria-hidden="true" />
      <span className="text-sm font-medium text-primary">
        Observe mode — verdicts are logged, not enforced
      </span>
      <span className="text-xs text-secondary">
        {observeAgents.length > 0 && (
          <>
            {observeAgents.slice(0, 3).join(', ')}{observeAgents.length > 3 ? ` +${observeAgents.length - 3} more` : ''} report{observeAgents.length === 1 ? 's' : ''} blocks and approval gates without stopping tool calls.
          </>
        )}
        {executedCount > 0 && (
          <>
            {' '}<Link href="/decisions?status=blocked" className="font-medium text-status-error underline decoration-dotted underline-offset-2 hover:decoration-solid">
              {executedCount} gated action{executedCount === 1 ? '' : 's'} executed anyway
            </Link>{' '}in the last 24h.
          </>
        )}
        {' '}Set <code className="font-mono">DASHCLAW_HOOK_MODE=enforce</code> and restart the agent session to arm enforcement.
      </span>
    </div>
  );
}
