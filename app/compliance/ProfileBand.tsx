'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { POLICY_MODE_CATALOG } from '../lib/policy-modes/catalog';

// Which Policy Mode is the runnable profile for each framework. 'soc2' has a
// purpose-built mode; every other framework maps to the conservative
// enterprise-strict posture rather than pretending a bespoke pack exists.
const FRAMEWORK_MODE_MAP: Record<string, string> = {
  soc2: 'soc2',
};
const DEFAULT_MODE_ID = 'enterprise-strict';

export function modeIdForFramework(framework: string): string {
  return FRAMEWORK_MODE_MAP[framework] || DEFAULT_MODE_ID;
}

/**
 * ProfileBand — the "runnable compliance profile" card on /compliance.
 * Shows the Policy Mode matched to the selected framework with its honest
 * posture summary, whether it is currently applied (from /api/policies/summary
 * `_mode` tags), and an admin-only Apply action through the existing
 * POST /api/policies/modes/import route. Applying activates REAL guard
 * policies org-wide, so the action is two-step (click → confirm).
 */
export default function ProfileBand({
  framework,
  frameworkLabel,
  onApplied,
}: {
  framework: string;
  frameworkLabel: string;
  onApplied?: () => void;
}) {
  const modeId = modeIdForFramework(framework);
  const mode = POLICY_MODE_CATALOG[modeId];
  if (!mode) return null;

  const [appliedModes, setAppliedModes] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'forbidden' | 'error'; text: string } | null>(null);

  const fetchApplied = useCallback(async () => {
    try {
      const res = await fetch('/api/policies/summary');
      if (!res.ok) { setAppliedModes([]); return; }
      const data = await res.json();
      setAppliedModes(
        Array.isArray(data?.modes) ? data.modes.map((m: { id: string }) => m.id) : []
      );
    } catch {
      // Fail soft: unknown applied-state just hides the "Applied" badge.
      setAppliedModes([]);
    }
  }, []);

  useEffect(() => { fetchApplied(); }, [fetchApplied]);
  useEffect(() => { setConfirming(false); setNotice(null); }, [framework]);

  const handleApply = async () => {
    if (!confirming) { setConfirming(true); return; }
    setApplying(true);
    setNotice(null);
    try {
      const res = await fetch('/api/policies/modes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode_id: modeId }),
      });
      if (res.status === 403) {
        setNotice({ kind: 'forbidden', text: 'Applying a profile needs an admin key — ask an org admin, or apply it from /policies.' });
      } else if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const n = Number(data?.imported ?? 0) + Number(data?.reactivated ?? 0);
        setNotice({ kind: 'ok', text: `${mode.name} applied — ${n} ${n === 1 ? 'policy' : 'policies'} active.` });
        await fetchApplied();
        onApplied?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setNotice({ kind: 'error', text: data?.error || 'Failed to apply profile.' });
      }
    } catch {
      setNotice({ kind: 'error', text: 'Failed to apply profile.' });
    } finally {
      setApplying(false);
      setConfirming(false);
    }
  };

  const isApplied = appliedModes?.includes(modeId) ?? false;
  const disclaimer = mode.toolVisibilityNotes[0];

  return (
    <Card className="mb-6">
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck size={15} className="shrink-0 text-brand" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">{mode.name}</span>
              <span className="text-xs text-tertiary">profile for {frameworkLabel}</span>
              {appliedModes !== null && (
                isApplied
                  ? <Badge variant="success" size="xs">Applied</Badge>
                  : <Badge variant="default" size="xs">Not applied</Badge>
              )}
            </div>
            <p className="mt-1.5 max-w-[70ch] text-xs text-secondary">{mode.description}</p>
            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Allows</div>
                <ul className="mt-1 space-y-0.5 text-secondary">
                  {mode.allows.slice(0, 3).map((a) => <li key={a}>{a}</li>)}
                </ul>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Warns</div>
                <ul className="mt-1 space-y-0.5 text-secondary">
                  {mode.warns.slice(0, 3).map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                  Requires approval <span className="tabular-nums">({mode.requiresApproval.length})</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-secondary">
                  {mode.requiresApproval.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
                  {mode.requiresApproval.length > 3 && (
                    <li className="text-tertiary">+{mode.requiresApproval.length - 3} more</li>
                  )}
                </ul>
              </div>
            </div>
            {disclaimer && (
              <p className="mt-3 max-w-[75ch] text-[11px] text-tertiary">{disclaimer}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              onClick={handleApply}
              disabled={applying}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                confirming
                  ? 'border-warning/40 bg-warning-subtle text-warning hover:border-warning/60'
                  : 'border-brand/20 bg-brand/10 text-brand hover:border-brand/40 hover:bg-brand/15'
              }`}
            >
              {applying ? 'Applying…'
                : confirming ? 'Confirm — activates org-wide'
                : isApplied ? 'Re-apply profile'
                : 'Apply profile'}
            </button>
            {confirming && !applying && (
              <button
                onClick={() => setConfirming(false)}
                className="text-[11px] text-tertiary transition-colors hover:text-white"
              >
                Cancel
              </button>
            )}
            <Link
              href="/policies"
              className="text-[11px] text-tertiary transition-colors hover:text-brand"
            >
              View in policy cockpit →
            </Link>
          </div>
        </div>
        {notice && (
          <div
            role={notice.kind === 'ok' ? 'status' : 'alert'}
            className={`mt-3 flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
              notice.kind === 'ok'
                ? 'border-success/30 bg-success-subtle text-success'
                : notice.kind === 'forbidden'
                  ? 'border-border bg-surface-tertiary text-secondary'
                  : 'border-error/30 bg-error-subtle text-error'
            }`}
          >
            {notice.kind !== 'ok' && <AlertTriangle size={13} aria-hidden="true" className="shrink-0" />}
            {notice.text}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
