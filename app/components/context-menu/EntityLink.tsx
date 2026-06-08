import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { detailPathFor } from './actionRegistry';

interface EntityLinkProps {
  /** DashClaw entity type (e.g. 'agent', 'decision', 'policy', 'capability'). */
  type: string;
  id: string;
  /** Optional status surfaced to the context menu via data-entity-status. */
  status?: string;
  /** Fallback label when no children are provided. Defaults to the id. */
  name?: string;
  className?: string;
  children?: ReactNode;
  /** Optional click handler — e.g. to stopPropagation inside a clickable row. */
  onClick?: (e: MouseEvent) => void;
}

/**
 * Deep-links a DashClaw entity to its detail destination. Renders a real Next
 * <Link> when the entity type has a known destination (see DETAIL_PATH),
 * otherwise a plain <span>. Either form carries data-entity-type /
 * data-entity-id (+ optional data-entity-status) so the global context menu
 * still resolves a right-click on it. Token-only styling — no hardcoded color.
 */
export function EntityLink({ type, id, status, name, className, children, onClick }: EntityLinkProps) {
  const href = detailPathFor(type, id);
  const label = children ?? name ?? id;

  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        data-entity-type={type}
        data-entity-id={id}
        data-entity-status={status}
        className={[
          'rounded-sm underline-offset-2 transition-colors hover:text-white hover:underline',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {label}
      </Link>
    );
  }

  return (
    <span onClick={onClick} data-entity-type={type} data-entity-id={id} data-entity-status={status} className={className}>
      {label}
    </span>
  );
}

export default EntityLink;
