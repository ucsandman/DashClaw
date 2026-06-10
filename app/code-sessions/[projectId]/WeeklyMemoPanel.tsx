'use client';

import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import MarkdownBody from '../../messages/_components/MarkdownBody';

// Weekly spend memo. The server seeds the latest stored memo via `initialMemo`
// (a code_session_memos row: { id, iso_week_tag, body_md, created_at }); the
// memo body is Markdown, rendered with the shared MarkdownBody. The Regenerate
// button POSTs to /memos/regenerate, which rebuilds from the last 7 days and
// returns the freshly saved row.

interface Memo {
  id?: string;
  iso_week_tag?: string;
  body_md?: string;
  created_at?: string;
}

interface WeeklyMemoPanelProps {
  projectId: string;
  initialMemo?: Memo | null;
}

export default function WeeklyMemoPanel({ projectId, initialMemo = null }: WeeklyMemoPanelProps) {
  const [memo, setMemo] = useState<Memo | null>(initialMemo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function regenerate() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `/api/code-sessions/memos/regenerate?project=${encodeURIComponent(projectId)}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Regenerate failed (HTTP ${res.status}). ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      if (!data.memo) throw new Error('Regenerate returned no memo.');
      setMemo(data.memo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <div className="rounded-lg border border-border bg-surface-secondary/30 p-5">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-primary">Weekly memo</h2>
            <p className="mt-0.5 text-sm text-tertiary">
              Spend, cache, and optimizer findings for the last 7 days vs the prior 7.
              {memo?.iso_week_tag ? ` Latest: ${memo.iso_week_tag}.` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Regenerate weekly memo"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden />
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        </header>

        {error && (
          <div className="mb-3 rounded-md border border-status-error/30 bg-status-error/5 p-3 text-sm text-status-error" role="alert">
            {error}
          </div>
        )}

        {memo?.body_md ? (
          <>
            <MarkdownBody content={memo.body_md} />
            {memo.created_at && (
              <p className="mt-4 text-[11px] text-tertiary">
                Generated {new Date(memo.created_at).toLocaleString()}
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-tertiary">
              No memo yet for this project. Generate one from the last 7 days of sessions.
            </p>
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Generating…' : 'Generate memo'}
              {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
