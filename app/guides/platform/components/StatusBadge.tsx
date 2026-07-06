import type { ItemStatus } from '../types';

const STYLES: Record<ItemStatus, string> = {
  stable: 'bg-success-subtle text-success border-border',
  beta: 'bg-info-subtle text-info border-border',
  experimental: 'bg-warning-subtle text-warning border-border',
  archived: 'bg-surface-tertiary text-text-tertiary border-border',
  deprecated: 'bg-error-subtle text-error border-border',
};

export default function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STYLES[status] || STYLES.experimental}`}
    >
      {status}
    </span>
  );
}
