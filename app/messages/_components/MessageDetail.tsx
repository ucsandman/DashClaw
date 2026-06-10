import { useState } from 'react';
import { MessageSquare, AlertCircle, Eye, Archive, Reply, Hash, Copy, FileType, Check, CheckCheck } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { getAgentColor } from '../../lib/colors';
import { isDemoMode } from '../../lib/isDemoMode';
import { timeAgo, TYPE_VARIANTS, stripMarkdown, copyToClipboard } from './helpers';
import MarkdownBody from './MarkdownBody';
import AttachmentChips from './AttachmentChips';
import { EntityLink } from '../../components/context-menu/EntityLink';

interface MessageDetailProps {
  message: any;
  // When true (the Sent tab), show a delivery/read receipt — this is an
  // outbound message, so "read" means the recipient read it, not the viewer.
  outbound?: boolean;
  onMarkRead?: (id: any) => void;
  onArchive?: (id: any) => void;
  onReply?: (message: any) => void;
  onViewThread?: (threadId: any) => void;
}

export default function MessageDetail({ message, outbound, onMarkRead, onArchive, onReply, onViewThread }: MessageDetailProps) {
  const isDemo = isDemoMode();
  const fromAgentId = message.from_agent_id || message.sender_id || 'unknown';
  const toAgentId = message.to_agent_id ?? null;
  const messageType = message.message_type || message.type || 'info';
  const body = message.body ?? message.content ?? '';
  const agentColor = getAgentColor(fromAgentId);
  const [copyState, setCopyState] = useState<string | null>(null);

  async function handleCopy(mode: string) {
    const text = mode === 'markdown' ? body : stripMarkdown(body);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopyState(mode);
      setTimeout(() => setCopyState(null), 2000);
    }
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-6 h-6 rounded-md flex items-center justify-center border ${agentColor}`}
        >
          <MessageSquare size={12} />
        </div>
        <span className="text-sm font-medium text-white">{fromAgentId}</span>
        {message.urgent && <AlertCircle size={12} className="text-error" />}
        <Badge variant={TYPE_VARIANTS[messageType] || 'default'} size="xs">
          {messageType}
        </Badge>
      </div>
      <div className="text-xs text-tertiary mb-1">
        To: {toAgentId || 'All Agents (Broadcast)'}
      </div>
      {message.subject && (
        <div className="text-sm font-medium text-secondary mb-2">{message.subject}</div>
      )}
      <div className="mb-3 bg-surface-tertiary rounded-md p-3">
        <MarkdownBody content={body} />
      </div>
      <AttachmentChips attachments={message.attachments} />
      <div className="flex gap-1.5 mb-3 mt-2">
        <button
          onClick={() => handleCopy('markdown')}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-surface-tertiary text-secondary hover:text-white hover:bg-surface-elevated transition-colors"
        >
          <Copy size={10} /> {copyState === 'markdown' ? 'Copied!' : 'Copy Markdown'}
        </button>
        <button
          onClick={() => handleCopy('plain')}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-surface-tertiary text-secondary hover:text-white hover:bg-surface-elevated transition-colors"
        >
          <FileType size={10} /> {copyState === 'plain' ? 'Copied!' : 'Copy Plain Text'}
        </button>
      </div>
      {outbound && (
        <div className="mb-2 flex items-center gap-1.5 text-xs">
          {message.read_at || message.is_read ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCheck size={12} /> Read{message.read_at ? ` ${timeAgo(message.read_at)}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-tertiary">
              <Check size={12} /> Delivered · awaiting read
            </span>
          )}
          {toAgentId === null && Array.isArray(message.read_by) && message.read_by.length > 0 && (
            <span className="text-tertiary">· read by {message.read_by.length}</span>
          )}
        </div>
      )}
      <div className="text-xs text-disabled mb-3">
        {new Date(message.created_at).toLocaleString()}
        {message.read_at && ` · Read ${timeAgo(message.read_at)}`}
        {message.thread_id && (
          <span className="ml-2">
            · Thread: <span className="font-mono">{message.thread_id.slice(0, 12)}...</span>
          </span>
        )}
      </div>
      {message.action_id && (
        <div className="mb-3 text-xs text-tertiary">
          Linked action:{' '}
          <EntityLink type="action" id={message.action_id} className="font-mono text-secondary">
            {String(message.action_id).slice(0, 16)}
          </EntityLink>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {!message.is_read && message.status === 'sent' && (
          <button
            onClick={() => onMarkRead?.(message.id)}
            disabled={isDemo}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-surface-tertiary text-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            <Eye size={12} /> Mark Read
          </button>
        )}
        {/* Archive is valid for any non-archived message — the API never
            required unread, and the right-click context menu already allows it. */}
        {message.status !== 'archived' && (
          <button
            onClick={() => onArchive?.(message.id)}
            disabled={isDemo}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-surface-tertiary text-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            <Archive size={12} /> Archive
          </button>
        )}
        {onReply && (
          <button
            onClick={() => onReply(message)}
            disabled={isDemo}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-brand/10 text-brand hover:bg-brand/20 transition-colors disabled:opacity-50"
          >
            <Reply size={12} /> Reply
          </button>
        )}
        {message.thread_id && onViewThread && (
          <button
            onClick={() => onViewThread(message.thread_id)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-surface-tertiary text-secondary hover:bg-surface-elevated transition-colors"
          >
            <Hash size={12} /> View Thread
          </button>
        )}
      </div>
    </div>
  );
}
