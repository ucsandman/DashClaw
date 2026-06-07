import { MessageSquare, Send, Inbox, AlertCircle, ChevronRight, Users, Reply } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { getAgentColor } from '../../lib/colors';
import { timeAgo, TYPE_VARIANTS } from './helpers';

interface MessageListProps {
  messages: any[];
  onSelect: (msg: any) => void;
  selectedId?: any;
  isSent?: boolean;
  onReply?: (msg: any) => void;
}

export default function MessageList({ messages, onSelect, selectedId, isSent, onReply }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <Card hover={false}>
        <CardContent className="py-6">
          <EmptyState
            icon={isSent ? Send : Inbox}
            title={isSent ? 'No sent messages' : 'Inbox is empty'}
            description={isSent ? 'Messages you send will appear here.' : 'No messages yet. Agents can send messages via the SDK.'}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card hover={false}>
      <CardContent className="pt-0 divide-y divide-white/[0.04]">
        {messages.map(msg => {
          const fromAgentId = msg.from_agent_id || msg.sender_id || 'unknown';
          const toAgentId = msg.to_agent_id ?? null;
          const messageType = msg.message_type || msg.type || 'info';
          const body = msg.body ?? msg.content ?? '';
          const agentColor = getAgentColor(isSent ? toAgentId || 'broadcast' : fromAgentId);
          const isUnread = !msg.is_read && msg.status === 'sent' && !isSent;
          return (
            <div
              key={msg.id}
              data-entity-type="message"
              data-entity-id={msg.id}
              data-entity-status={msg.status}
              onClick={() => onSelect(msg)}
              className={`group flex items-start gap-3 py-3 px-1 cursor-pointer transition-colors rounded-sm ${
                msg.id === selectedId ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border ${agentColor}`}
              >
                <MessageSquare size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {isUnread && <div className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />}
                  {msg.urgent && <AlertCircle size={12} className="text-error flex-shrink-0" />}
                  <span className={`text-sm truncate ${isUnread ? 'font-semibold text-white' : 'text-secondary'}`}>
                    {isSent ? (toAgentId || 'All Agents') : fromAgentId}
                  </span>
                  <Badge variant={TYPE_VARIANTS[messageType] || 'default'} size="xs">
                    {messageType}
                  </Badge>
                  {!toAgentId && (
                    <Badge variant="secondary" size="xs">
                      <Users size={10} className="mr-0.5" /> broadcast
                    </Badge>
                  )}
                </div>
                {msg.subject && (
                  <div className="text-sm text-secondary truncate mt-0.5">{msg.subject}</div>
                )}
                <div className="text-xs text-tertiary truncate mt-0.5">{body}</div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-xs text-disabled">{timeAgo(msg.created_at)}</span>
                {onReply && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onReply(msg); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-tertiary hover:text-brand"
                    title="Reply"
                  >
                    <Reply size={12} />
                  </button>
                )}
                <ChevronRight size={12} className="text-zinc-700" />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
