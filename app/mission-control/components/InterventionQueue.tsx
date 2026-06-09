'use client';

import Link from 'next/link';
import { CheckCircle2, ArrowRight, Check, Ban } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { useSelection } from '../../lib/useSelection';
import { bulkAction } from '../../lib/bulkAction';
import { SelectCheckbox } from '../../components/selection/SelectCheckbox';
import { BulkActionBar } from '../../components/selection/BulkActionBar';
import { truncateText, type InterventionItem } from '../lib/missionHelpers';

const QUEUE_CAP = 6;

interface InterventionQueueProps {
  items: InterventionItem[];
  onDecision: (actionId: string, decision: 'allow' | 'deny') => void | Promise<void>;
  refresh: () => void;
}

/**
 * The pinned, actionable top of the live ledger: pending approvals + critical/high
 * loops. Approvals get inline Approve/Deny AND queue-local multi-select for bulk
 * approve/deny (reusing the shipped useSelection + bulkAction).
 */
export function InterventionQueue({ items, onDecision, refresh }: InterventionQueueProps) {
  const shown = items.slice(0, QUEUE_CAP);
  const approvalIds = shown.filter((i) => i.kind === 'approval').map((i) => i.sourceId);
  const selection = useSelection(
    shown.filter((i) => i.kind === 'approval'),
    (i) => i.sourceId,
  );

  async function bulkDecide(decision: 'allow' | 'deny') {
    if (selection.count === 0) return;
    await bulkAction(selection.selectedIds, (id) =>
      fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      }),
    );
    selection.clear();
    refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface-secondary">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {approvalIds.length > 0 && (
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all approvals"
              size={15}
            />
          )}
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Needs you</span>
          {items.length > 0 && <span className="text-xs font-medium tabular-nums text-secondary">· {items.length}</span>}
        </div>
        {selection.count > 0 ? (
          <BulkActionBar
            count={selection.count}
            actions={[
              { id: 'approve', label: 'Approve', icon: Check, onClick: () => bulkDecide('allow') },
              { id: 'deny', label: 'Deny', icon: Ban, onClick: () => bulkDecide('deny'), danger: true },
            ]}
            onClear={selection.clear}
          />
        ) : (
          items.length > 0 && (
            <Link href="/approvals" className="inline-flex items-center gap-1 text-[11px] font-medium text-brand transition-colors hover:text-brand-hover">
              Queue <ArrowRight size={10} aria-hidden="true" />
            </Link>
          )
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-5">
          <CheckCircle2 size={16} className="text-success/60" aria-hidden="true" />
          <span className="text-sm text-secondary">No intervention required</span>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((item) => (
            <li
              key={item.id}
              data-entity-type={item.source}
              data-entity-id={item.sourceId}
              data-entity-status={item.status}
              className="flex items-center gap-2 px-4 py-2.5"
            >
              {item.kind === 'approval' && (
                <SelectCheckbox
                  checked={selection.isSelected(item.sourceId)}
                  onToggle={(e) => {
                    e.stopPropagation();
                    selection.selectClick(item.sourceId, e.shiftKey);
                  }}
                  label={`Select ${item.agentName}`}
                  size={14}
                />
              )}
              {item.kind === 'approval' ? (
                <span className="inline-flex items-center rounded border border-error/20 bg-error-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Approval
                </span>
              ) : (
                <Badge variant="warning" size="xs">
                  Loop
                </Badge>
              )}
              <span className="shrink-0 max-w-[7.5rem] truncate rounded border border-border bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-medium text-secondary">
                {(item.agentName || '').substring(0, 14) || item.agentId?.substring(0, 8) || 'system'}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-secondary">{truncateText(item.description, 80)}</span>
              {item.kind === 'approval' ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => onDecision(item.sourceId, 'allow')}
                    className="rounded-md border border-success/20 bg-success-subtle px-2 py-1 text-[11px] font-medium text-success transition-colors hover:border-success/40"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onDecision(item.sourceId, 'deny')}
                    className="rounded-md border border-error/20 bg-error-subtle px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:border-error/40"
                  >
                    Deny
                  </button>
                </span>
              ) : (
                <Link href={item.href} className="shrink-0 text-tertiary transition-colors hover:text-white" aria-label="Open loop">
                  <ArrowRight size={12} aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
