import React from 'react';

interface CardProps {
  children?: React.ReactNode;
  className?: string;
  hover?: boolean;
  ref?: React.Ref<HTMLElement>;
  // Forwarded to the root element so list rows can tag themselves for the
  // site-wide right-click context menu (resolved by `[data-entity-type]`).
  'data-entity-type'?: string;
  'data-entity-id'?: string;
  'data-entity-status'?: string;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}

export function Card({ children, className = '', hover = true, ref, ...rest }: CardProps) {
  // `ref` is intentionally not applied — Card has never forwarded it, and
  // several callers pass a (currently inert) sizing ref; preserve that.
  void ref;
  return (
    <div
      className={`group/card flex flex-col overflow-hidden bg-surface-secondary border border-border rounded-xl outline-none ${hover ? 'transition-colors duration-150 hover:border-border-hover' : ''} ${className}`}
      tabIndex={0}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title?: React.ReactNode;
  icon?: React.ElementType;
  action?: React.ReactNode;
  count?: number;
  children?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, icon: Icon, action, count, children }: CardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon size={14} className="shrink-0 text-tertiary" />}
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {count !== undefined && (
          <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-brand">
            {count}
          </span>
        )}
        {action}
        {children}
      </div>
    </div>
  );
}

interface CardContentProps {
  children?: React.ReactNode;
  className?: string;
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto px-5 pb-5 ${className}`}>
      {children}
    </div>
  );
}
