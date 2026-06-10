import { useEffect, useRef } from 'react';
import { Hash, MessageSquare, AlertCircle } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { getAgentColor } from '../../lib/colors';
import { timeAgo, TYPE_VARIANTS, stripMarkdown } from './helpers';

// One row of the unified comms ledger: either a thread or a standalone
// message, interleaved by the page and sorted newest-activity first.
export type ConversationItem =
  | { kind: 'thread'; thread: any }
  | { kind: 'message'; message: any };

export function itemId(item: ConversationItem): string {
  return item.kind === 'thread' ? item.thread.id : item.message.id;
}

interface ConversationListProps {
  items: ConversationItem[];
  selected: { kind: string; id: string } | null;
  onSelect: (item: ConversationItem) => void;
}

function RowButton({ isSelected, children, ...rest }: any) {
  const ref = useRef<HTMLButtonElement | null>(null);
  // Keep keyboard-driven selection (j/k) visible — the recon flagged selection
  // jumping out of the viewport.
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isSelected]);
  return (
    <button
      ref={ref}
      type="button"
      aria-current={isSelected ? 'true' : undefined}
      className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 ${
        isSelected
          ? 'border-border-active bg-brand/5'
          : 'border-transparent hover:border-border hover:bg-surface-tertiary'
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

export default function ConversationList({ items, selected, onSelect }: ConversationListProps) {
  return (
    <div className="space-y-0.5" role="list">
      {items.map((item) => {
        const isSelected = selected != null && selected.kind === item.kind && selected.id === itemId(item);

        if (item.kind === 'thread') {
          const t = item.thread;
          return (
            <RowButton
              key={`thread-${t.id}`}
              isSelected={isSelected}
              onClick={() => onSelect(item)}
              data-entity-type="thread"
              data-entity-id={t.id}
              data-entity-status={t.status}
            >
              <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border bg-surface-tertiary text-secondary">
                <Hash size={12} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-primary">{t.name}</span>
                  <Badge variant={t.status === 'open' ? 'success' : 'default'} size="xs">{t.status}</Badge>
                  <span className="ml-auto flex-shrink-0 text-[10px] text-disabled">
                    {timeAgo(t.last_message_at || t.created_at)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-tertiary">
                  {t.message_count || 0} messages · by {t.created_by || 'unknown'}
                </div>
              </div>
            </RowButton>
          );
        }

        const m = item.message;
        const fromAgentId = m.from_agent_id || m.sender_id || 'unknown';
        const messageType = m.message_type || m.type || 'info';
        const isUnread = !m.is_read && m.status === 'sent';
        const snippet = m.subject || stripMarkdown(m.body ?? m.content ?? '');
        return (
          <RowButton
            key={`message-${m.id}`}
            isSelected={isSelected}
            onClick={() => onSelect(item)}
            data-entity-type="message"
            data-entity-id={m.id}
            data-entity-status={m.status}
          >
            <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border ${getAgentColor(fromAgentId)}`}>
              <MessageSquare size={12} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {isUnread && (
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" aria-hidden="true" />
                )}
                {isUnread && <span className="sr-only">Unread</span>}
                <span className={`truncate text-sm ${isUnread ? 'font-medium text-primary' : 'text-secondary'}`}>
                  {fromAgentId} <span className="text-tertiary">→ {m.to_agent_id || 'all'}</span>
                </span>
                <Badge variant={TYPE_VARIANTS[messageType] || 'default'} size="xs">{messageType}</Badge>
                {m.urgent && <AlertCircle size={11} className="flex-shrink-0 text-error" aria-label="Urgent" />}
                <span className="ml-auto flex-shrink-0 text-[10px] text-disabled">{timeAgo(m.created_at)}</span>
              </div>
              <div className={`mt-0.5 truncate text-xs ${isUnread ? 'text-secondary' : 'text-tertiary'}`}>
                {snippet || '(no content)'}
              </div>
            </div>
          </RowButton>
        );
      })}
    </div>
  );
}
