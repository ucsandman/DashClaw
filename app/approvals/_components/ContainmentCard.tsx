'use client';

import { useState, useEffect } from 'react';
import { Check, X, GitMerge, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

interface ContainmentAction {
  action_id: string;
  agent_id: string;
  agent_name?: string | null;
  action_type: string;
  declared_goal: string;
  containment_ref: string | null;
  timestamp_start: string;
  // Batched evidence state from GET /api/actions?containment_status=... —
  // present when the list was enriched (one query for all cards), absent when
  // enrichment degraded and the card must fetch evidence itself.
  containment_has_evidence?: boolean;
  containment_evidence_ref?: string | null;
}

interface PatchArtifactContent {
  diff?: string;
  stat?: string;
  ref?: string;
  truncated?: boolean;
  untracked?: string[];
}

// Diffs are session-branch state, not per-action — a diff artifact is
// CUMULATIVE for every action sharing the same containment_ref (Task 10
// review requirement). The caller groups the awaiting list by ref and
// passes down what this card needs to know about its siblings.
function ageLabel(iso: string | null | undefined): string {
  if (!iso) return 'unknown age';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function DiffLine({ line }: { line: string }) {
  const isAdd = line.startsWith('+') && !line.startsWith('+++');
  const isDel = line.startsWith('-') && !line.startsWith('---');
  const tone = isAdd ? 'text-status-success' : isDel ? 'text-status-error' : 'text-secondary';
  return <div className={tone}>{line || ' '}</div>;
}

export default function ContainmentCard({
  action, siblingCount, hasLaterSibling, canDecide, onResolvedAction,
}: {
  action: ContainmentAction;
  siblingCount: number;
  hasLaterSibling: boolean;
  canDecide: boolean;
  onResolvedAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [patchContent, setPatchContent] = useState<PatchArtifactContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // IMPORTANT 3 defense-in-depth (final fix wave, 2026-07-27): Promote must
  // be disabled when there is no patch artifact behind this card — a
  // promotable row with nothing captured is exactly the class the
  // posttool-hook fix above closes server-side; this is the belt-and-
  // suspenders UI check. The evidence state now arrives batched on the list
  // row itself (containment_has_evidence / containment_evidence_ref — one
  // query for every card instead of one artifact fetch per card on mount),
  // so the check is in place before the operator can click Promote without
  // any per-card request; the full diff loads lazily on first expand. When
  // the list was NOT enriched (degraded server path), fall back to the
  // original eager per-card fetch so the gate still precedes the button.
  const enriched = typeof action.containment_has_evidence === 'boolean';

  const loadDiff = async () => {
    setDiffLoading(true);
    try {
      const res = await fetch(`/api/actions/${action.action_id}/artifacts`);
      if (res.ok) {
        const data = await res.json();
        const patch = (data.artifacts || []).find((a: any) => a.artifact_type === 'patch');
        setPatchContent(patch?.content ?? null);
      } else {
        setPatchContent(null);
      }
    } catch {
      setPatchContent(null);
    } finally {
      setDiffLoading(false);
      setDiffLoaded(true);
    }
  };

  useEffect(() => {
    if (!enriched) loadDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action.action_id]);

  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !diffLoaded && !diffLoading) loadDiff();
  };

  const submit = async (verdict: 'promote' | 'discard') => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetch(`/api/actions/${action.action_id}/containment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Show the server's error verbatim (e.g. CONTAINMENT_REF_MISSING) —
        // it's an honest code, not friendly prose, and shouldn't be papered over.
        throw new Error(data?.error || `Containment verdict failed (${res.status})`);
      }
      onResolvedAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Containment verdict failed');
    } finally {
      setBusy(false);
    }
  };

  const diffLines = patchContent?.diff ? patchContent.diff.split('\n') : [];

  // Evidence state: prefer the freshly fetched artifact once loaded; before
  // that, the batched list enrichment answers both questions with no request.
  const evidenceKnown = diffLoaded || enriched;
  const hasEvidence = diffLoaded ? Boolean(patchContent) : Boolean(action.containment_has_evidence);
  const evidenceRef = diffLoaded ? patchContent?.ref : action.containment_evidence_ref ?? undefined;

  // SECURITY (2026-07-27): bind the promoted ref to the REVIEWED evidence —
  // belt-and-suspenders UI check mirroring the server-side
  // CONTAINMENT_REF_MISMATCH gate. containment_ref is the merge target;
  // evidenceRef is the branch the captured diff actually describes. If they
  // differ (including the artifact predating ref capture, so ref is
  // undefined), Promote is disabled before the operator can click it.
  const refMismatch = Boolean(evidenceKnown && hasEvidence && action.containment_ref && evidenceRef !== action.containment_ref);

  return (
    <Card data-entity-type="decision" data-entity-id={action.action_id} data-entity-status="awaiting_promotion" data-entity-action-type={action.action_type} hover={false}>
      <CardContent className="pt-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <GitMerge size={16} className="text-brand" />
          <Badge variant="brand">Awaiting promotion</Badge>
          <span className="text-xs text-tertiary">{action.agent_name || action.agent_id}</span>
          <span className="text-xs text-tertiary">· {action.action_type}</span>
          {action.containment_ref && (
            <span className="font-mono text-[11px] text-tertiary" title="Containment ref">
              {action.containment_ref}
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-tertiary">{ageLabel(action.timestamp_start)}</span>
        </div>
        <h3 className="mb-3 text-lg font-semibold text-white">{action.declared_goal}</h3>

        {siblingCount > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {siblingCount} other contained action{siblingCount > 1 ? 's' : ''} share{siblingCount > 1 ? '' : 's'} this ref
              {hasLaterSibling ? ', including one that postdates this action' : ''} — the diff below shows the full staged branch state, not just this action&apos;s change.
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={toggleExpand}
          aria-expanded={expanded}
          className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-tertiary transition-colors hover:text-secondary"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {expanded ? 'Hide diff' : 'View diff'}
        </button>

        {expanded && (
          <div className="mb-4">
            {diffLoading ? (
              <div className="text-xs text-tertiary">Loading diff…</div>
            ) : !patchContent ? (
              <div className="rounded-lg border border-border bg-surface-tertiary px-3 py-2.5 text-xs text-tertiary">
                No diff artifact captured — review via <code className="font-mono text-secondary">dashclaw contained diff</code>.
              </div>
            ) : (
              <div className="space-y-2">
                {patchContent.stat && (
                  <div className="font-mono text-xs text-secondary">{patchContent.stat}</div>
                )}
                <pre className="max-h-96 overflow-x-auto rounded-lg border border-border bg-black/30 p-3 font-mono text-xs leading-relaxed">
                  {diffLines.map((line, i) => <DiffLine key={i} line={line} />)}
                </pre>
                {patchContent.truncated && (
                  <p className="text-[11px] text-tertiary">Diff truncated — showing partial output.</p>
                )}
                {patchContent.untracked && patchContent.untracked.length > 0 && (
                  <p className="text-[11px] text-tertiary">
                    {patchContent.untracked.length} untracked file{patchContent.untracked.length > 1 ? 's' : ''} not included in this diff.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="mb-3 text-xs text-error">{error}</p>}

        {evidenceKnown && !hasEvidence && (
          <p className="mb-3 text-xs text-warning">
            No diff artifact captured for this action — Promote is disabled to avoid merging nothing.
          </p>
        )}

        {refMismatch && (
          <p className="mb-3 text-xs text-warning">
            Reviewed diff targets a different branch than this action&apos;s merge target — Promote is disabled.
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => submit('promote')}
            disabled={busy || !canDecide || (evidenceKnown && !hasEvidence) || refMismatch}
            title={
              evidenceKnown && !hasEvidence
                ? 'No diff artifact captured — nothing to merge'
                : refMismatch
                  ? 'Reviewed diff targets a different branch than this action\'s merge target'
                  : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-success/20 bg-success-subtle px-3 py-1.5 text-sm font-medium text-success transition-colors hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={16} /> Promote
          </button>
          <button
            onClick={() => submit('discard')}
            disabled={busy || !canDecide}
            className="inline-flex items-center gap-1.5 rounded-lg border border-error/20 bg-error-subtle px-3 py-1.5 text-sm font-medium text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} /> Discard
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
