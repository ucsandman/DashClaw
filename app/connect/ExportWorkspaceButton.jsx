'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

/*
 * v7.2 graduation path: the trial's record is yours to take. One click
 * downloads the workspace bundle (policies, decisions, action history,
 * agents, assumptions — never API keys or secret values); import it into
 * an owned instance with `dashclaw import <file>`. Rides the trial
 * session cookie, same as FirstGovernedActionCard.
 */
export default function ExportWorkspaceButton() {
  const [state, setState] = useState('idle'); // idle | busy | done | error

  async function handleExport() {
    setState('busy');
    try {
      const res = await fetch('/api/workspace/export');
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : 'dashclaw-workspace.json';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState('done');
    } catch {
      setState('error');
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={handleExport}
        disabled={state === 'busy'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary disabled:opacity-60"
      >
        <Download size={14} aria-hidden="true" />
        {state === 'busy' ? 'Exporting…' : state === 'done' ? 'Exported' : 'Export workspace'}
      </button>
      {state === 'error' ? (
        <span className="mt-1 text-xs text-status-error">
          Export failed. Retry, or check the session is still active.
        </span>
      ) : null}
    </span>
  );
}
