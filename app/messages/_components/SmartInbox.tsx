import { useState } from 'react';
import { MessageCircleQuestion, AlertTriangle, Inbox, ChevronDown, ChevronRight, MessageSquare, AlertCircle, Users, Paperclip } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { getAgentColor } from '../../lib/colors';
import { timeAgo, TYPE_VARIANTS } from './helpers';
import MessageActionMenu from './MessageActionMenu';

interface MessageRowProps {
  msg: any;
  onSelect: (msg: any) => void;
  selectedId?: any;
  onReply?: (msg: any) => void;
  onMarkRead?: (id: any) => void;
  onArchive?: (id: any) => void;
}

function MessageRow({ msg, onSelect, selectedId, onReply, onMarkRead, onArchive }: MessageRowProps) {
  const fromAgentId = msg.from_agent_id || msg.sender_id || 'unknown';
  const toAgentId = msg.to_agent_id ?? null;
  const messageType = msg.message_type || msg.type || 'info';
  const body = msg.body ?? msg.content ?? '';
  const agentColor = getAgentColor(fromAgentId);
  const isUnread = !msg.is_read && msg.status === 'sent';
  return (
    <div
      onClick={() => onSelect(msg)}
      data-entity-type="message"
      data-entity-id={msg.id}
      data-entity-status={msg.status}
      className={`group flex items-start gap-3 py-2.5 px-1 cursor-pointer transition-colors rounded-sm ${
        isUnread ? 'border-l-2 border-brand' : 'border-l-2 border-transparent'
      } ${
        msg.id === selectedId ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
      }`}
    >
      <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border ${agentColor}`}>
        <MessageSquare size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {isUnread && <div className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />}
          {msg.urgent && <AlertCircle size={10} className="text-error flex-shrink-0" />}
          <span className={`text-sm truncate ${isUnread ? 'font-semibold text-white' : 'text-secondary'}`}>
            {fromAgentId}
          </span>
          <Badge variant={TYPE_VARIANTS[messageType] || 'default'} size="xs">
            {messageType}
          </Badge>
          {!toAgentId && (
            <Badge variant="secondary" size="xs">
              <Users size={10} className="mr-0.5" /> broadcast
            </Badge>
          )}
          {msg.attachments?.length > 0 && (
            <Paperclip size={10} className="text-tertiary flex-shrink-0" />
          )}
        </div>
        {msg.subject && <div className="text-sm text-secondary truncate mt-0.5">{msg.subject}</div>}
        <div className="text-xs text-tertiary truncate mt-0.5">{body}</div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <span className="text-xs text-disabled">{timeAgo(msg.created_at)}</span>
        <MessageActionMenu
          message={msg}
          onMarkRead={onMarkRead}
          onArchive={onArchive}
          onReply={onReply}
        />
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ElementType;
  count: number;
  color: string;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}

function Section({ title, icon: Icon, count, color, defaultOpen, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-md transition-colors ${color}`}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={12} />
        <span>{title}</span>
        <span className="ml-auto font-mono">{count}</span>
      </button>
      {open && <div className="divide-y divide-white/[0.04]">{children}</div>}
    </div>
  );
}

interface SmartInboxProps {
  messages: any[];
  onSelect: (msg: any) => void;
  selectedId?: any;
  onReply?: (msg: any) => void;
  onMarkRead?: (id: any) => void;
  onArchive?: (id: any) => void;
}

export default function SmartInbox({ messages, onSelect, selectedId, onReply, onMarkRead, onArchive }: SmartInboxProps) {
  if (messages.length === 0) {
    return (
      <Card hover={false}>
        <CardContent className="py-6">
          <EmptyState
            icon={Inbox}
            title="Inbox is empty"
            description="No messages yet. Agents can send messages via the SDK."
          />
        </CardContent>
      </Card>
    );
  }

  const needsInput = messages.filter((m) => {
    const messageType = m.message_type || m.type;
    return messageType === 'question' || messageType === 'action';
  });
  const needsInputIds = new Set(needsInput.map(m => m.id));
  const urgent = messages.filter(m => m.urgent && !needsInputIds.has(m.id));
  const urgentIds = new Set(urgent.map(m => m.id));
  const rest = messages.filter(m => !needsInputIds.has(m.id) && !urgentIds.has(m.id));

  const hasTriaged = needsInput.length > 0 || urgent.length > 0;

  return (
    <Card hover={false}>
      <CardContent className="pt-2">
        <Section
          title="Needs Your Input"
          icon={MessageCircleQuestion}
          count={needsInput.length}
          color="text-warning hover:bg-warning-subtle"
          defaultOpen
        >
          {needsInput.map(msg => (
            <MessageRow key={msg.id} msg={msg} onSelect={onSelect} selectedId={selectedId} onReply={onReply} onMarkRead={onMarkRead} onArchive={onArchive} />
          ))}
        </Section>

        <Section
          title="Urgent"
          icon={AlertTriangle}
          count={urgent.length}
          color="text-error hover:bg-error-subtle"
          defaultOpen
        >
          {urgent.map(msg => (
            <MessageRow key={msg.id} msg={msg} onSelect={onSelect} selectedId={selectedId} onReply={onReply} onMarkRead={onMarkRead} onArchive={onArchive} />
          ))}
        </Section>

        <Section
          title="Everything Else"
          icon={Inbox}
          count={rest.length}
          color="text-secondary hover:bg-white/[0.06]"
          defaultOpen={!hasTriaged}
        >
          {rest.map(msg => (
            <MessageRow key={msg.id} msg={msg} onSelect={onSelect} selectedId={selectedId} onReply={onReply} onMarkRead={onMarkRead} onArchive={onArchive} />
          ))}
        </Section>
      </CardContent>
    </Card>
  );
}
