import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Send, MessageSquare, AlertCircle, Copy, Paperclip, X } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { getAgentColor } from '../../lib/colors';
import { isDemoMode } from '../../lib/isDemoMode';
import { timeAgo, TYPE_VARIANTS, copyToClipboard, formatDateGroup } from './helpers';
import MarkdownBody from './MarkdownBody';
import AttachmentChips from './AttachmentChips';

interface ThreadConversationProps {
  thread: any;
  filterAgentId?: string | null;
  onNewMessage?: { current: ((msg: any) => void) | null };
  onThreadUpdated?: (thread: any) => void;
  fullWidth?: boolean;
}

export default function ThreadConversation({ thread, filterAgentId, onNewMessage, onThreadUpdated, fullWidth }: ThreadConversationProps) {
  const isDemo = isDemoMode();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyAttachments, setReplyAttachments] = useState<any[]>([]);
  // Thread status/summary are editable here (PATCH /api/messages/threads).
  // Kept in local state so the header reflects changes immediately; re-synced
  // when the selected thread changes.
  const [localStatus, setLocalStatus] = useState(thread.status);
  const [localSummary, setLocalSummary] = useState(thread.summary || '');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [patching, setPatching] = useState(false);
  const replyFileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLocalStatus(thread.status);
    setLocalSummary(thread.summary || '');
    setEditingSummary(false);
  }, [thread.id, thread.status, thread.summary]);

  const patchThread = useCallback(async (updates: Record<string, any>) => {
    if (isDemo) return;
    setPatching(true);
    if (updates.status != null) setLocalStatus(updates.status);     // optimistic
    if (updates.summary !== undefined) setLocalSummary(updates.summary || '');
    try {
      const res = await fetch('/api/messages/threads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: thread.id, ...updates }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.thread) {
        if (data.thread.status != null) setLocalStatus(data.thread.status);
        if (data.thread.summary !== undefined) setLocalSummary(data.thread.summary || '');
        onThreadUpdated?.(data.thread);
      }
    } finally {
      setPatching(false);
    }
  }, [isDemo, thread.id, onThreadUpdated]);

  const participants = (() => {
    try {
      const p = JSON.parse(thread.participants || '[]');
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  })();

  const fetchThreadMessages = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        thread_id: thread.id,
        direction: 'all',
        limit: '100',
      });
      if (filterAgentId) params.set('agent_id', filterAgentId);
      const res = await fetch(`/api/messages?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      // Show chronological (oldest first)
      const sorted = (data.messages || []).slice().sort(
        (a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || '')
      );
      setMessages(sorted);
    } catch {
      // Silently fail, will retry on poll
    } finally {
      setLoading(false);
    }
  }, [thread.id, filterAgentId]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    fetchThreadMessages();
  }, [fetchThreadMessages]);

  // Polling fallback
  useEffect(() => {
    const interval = setInterval(fetchThreadMessages, 15000);
    return () => clearInterval(interval);
  }, [fetchThreadMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle incoming SSE messages
  const addMessage = useCallback((msg: any) => {
    if (msg.thread_id !== thread.id) return;
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, [thread.id]);

  // Expose addMessage for parent to call on SSE events. Cleared on unmount so
  // a stale closure doesn't keep receiving SSE forwards after leaving the view.
  useEffect(() => {
    if (!onNewMessage) return;
    onNewMessage.current = addMessage;
    return () => { onNewMessage.current = null; };
  }, [addMessage, onNewMessage]);

  async function addReplyFiles(files: FileList) {
    const ALLOWED = ['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/json'];
    const MAX_SIZE = 5 * 1024 * 1024;
    const remaining = 3 - replyAttachments.length;
    const toAdd = Array.from(files).slice(0, remaining);
    for (const file of toAdd) {
      if (!ALLOWED.includes(file.type) || file.size > MAX_SIZE) continue;
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(',')[1] ?? '');
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      setReplyAttachments(prev => [...prev, { filename: file.name, mime_type: file.type, data, size: file.size }]);
    }
  }

  async function handleSendReply() {
    if (!replyBody.trim() || isDemo) return;
    setSending(true);
    try {
      const payload: any = {
        from_agent_id: filterAgentId || 'dashboard',
        body: replyBody,
        message_type: 'info',
        thread_id: thread.id,
      };
      if (replyAttachments.length > 0) {
        payload.attachments = replyAttachments.map(a => ({
          filename: a.filename, mime_type: a.mime_type, data: a.data,
        }));
      }

      // Optimistic update
      const optimistic: any = {
        id: `temp_${Date.now()}`,
        ...payload,
        created_at: new Date().toISOString(),
        status: 'sent',
        _optimistic: true,
      };
      delete optimistic.attachments;
      setMessages(prev => [...prev, optimistic]);
      setReplyBody('');
      setReplyAttachments([]);

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== optimistic.id));
        return;
      }

      fetchThreadMessages();
    } catch {
      setMessages(prev => prev.filter(m => !m._optimistic));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="border-b border-border pb-3 mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Hash size={14} className="text-secondary" />
          <span className="text-sm font-semibold text-white">{thread.name}</span>
          <Badge variant={localStatus === 'open' ? 'success' : 'default'} size="xs">
            {localStatus}
          </Badge>
          <span className="text-xs text-tertiary">{thread.message_count || messages.length} messages</span>
          {!isDemo && (
            <button
              onClick={() => patchThread({ status: localStatus === 'resolved' ? 'open' : 'resolved' })}
              disabled={patching}
              className="ml-auto text-xs text-secondary hover:text-white disabled:opacity-50"
            >
              {localStatus === 'resolved' ? 'Reopen' : 'Resolve thread'}
            </button>
          )}
        </div>
        {participants.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {participants.map((p: any) => (
              <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-surface-tertiary text-secondary">
                {p}
              </span>
            ))}
          </div>
        )}
        {editingSummary ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              value={summaryDraft}
              onChange={e => setSummaryDraft(e.target.value)}
              placeholder="Thread summary"
              aria-label="Thread summary"
              className="flex-1 px-2 py-1 text-xs bg-surface-primary border border-border rounded text-secondary"
            />
            <button
              onClick={() => { patchThread({ summary: summaryDraft }); setEditingSummary(false); }}
              disabled={patching}
              className="text-xs text-brand hover:text-brand/80 disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={() => setEditingSummary(false)} className="text-xs text-tertiary hover:text-white">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1">
            {localSummary
              ? <span className="text-xs text-tertiary">{localSummary}</span>
              : <span className="text-xs text-disabled italic">No summary</span>}
            {!isDemo && (
              <button
                onClick={() => { setSummaryDraft(localSummary); setEditingSummary(true); }}
                className="text-xs text-secondary hover:text-white"
              >
                {localSummary ? 'Edit' : 'Add summary'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Messages timeline */}
      <div ref={containerRef} className={`flex-1 overflow-y-auto space-y-3 min-h-0 pr-1 ${fullWidth ? 'max-h-[calc(100vh-340px)]' : 'max-h-[500px]'}`}>
        {loading ? (
          <div className="text-center text-tertiary py-8 text-sm">Loading conversation...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-tertiary py-8 text-sm">No messages in this thread yet.</div>
        ) : (
          messages.map((msg, idx) => {
            const fromAgentId = msg.from_agent_id || msg.sender_id || 'unknown';
            const messageType = msg.message_type || msg.type || 'info';
            const body = msg.body ?? msg.content ?? '';
            const agentColor = getAgentColor(fromAgentId);
            const prevDate = idx > 0 ? formatDateGroup(messages[idx - 1].created_at) : null;
            const curDate = formatDateGroup(msg.created_at);
            const showDateSep = curDate && curDate !== prevDate;
            return (
              <div key={msg.id}>
                {showDateSep && (
                  <div className="flex items-center gap-3 py-2">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-tertiary font-medium">{curDate}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                {/* Flat ledger row — every author renders identically, left-aligned */}
                <div className="group flex gap-2">
                  <div
                    className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 border ${agentColor}`}
                  >
                    <MessageSquare size={12} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-medium text-secondary">{fromAgentId}</span>
                      <Badge variant={TYPE_VARIANTS[messageType] || 'default'} size="xs">
                        {messageType}
                      </Badge>
                      {msg.urgent && <AlertCircle size={10} className="text-error" aria-label="Urgent" />}
                      <span className="text-xs text-disabled">{timeAgo(msg.created_at)}</span>
                    </div>
                    <div className={`relative rounded-lg border border-border bg-surface-tertiary p-2.5 ${msg._optimistic ? 'opacity-60' : ''}`}>
                      <MarkdownBody content={body} />
                      <AttachmentChips attachments={msg.attachments} compact />
                      {!msg._optimistic && (
                        <button
                          onClick={async () => {
                            const ok = await copyToClipboard(body);
                            if (ok) { setCopiedId(msg.id); setTimeout(() => setCopiedId(null), 2000); }
                          }}
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-surface-secondary text-secondary hover:text-white"
                          title="Copy message"
                        >
                          <Copy size={10} />
                        </button>
                      )}
                      {copiedId === msg.id && (
                        <span className="absolute top-1.5 right-8 text-xs text-success">
                          Copied!
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {localStatus === 'resolved' && (
          <div className="flex items-center gap-2 py-2 px-3 rounded-md bg-success-subtle border border-success/20 text-success text-xs">
            Thread resolved
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply bar */}
      <div className="border-t border-border pt-3 mt-3">
        {isDemo ? (
          <div className="text-xs text-tertiary text-center py-2">Reply is disabled in demo mode</div>
        ) : (
          <div>
            <div className="flex gap-2">
              <textarea
                value={replyBody}
                onChange={e => setReplyBody(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
                placeholder="Reply to thread..."
                maxLength={2000}
                rows={2}
                className="flex-1 px-3 py-2 text-sm bg-surface-primary border border-border rounded-md text-secondary placeholder:text-disabled resize-none"
              />
              <div className="flex flex-col gap-1 self-end">
                <button
                  onClick={() => replyFileRef.current?.click()}
                  disabled={replyAttachments.length >= 3}
                  className="px-2 py-2 rounded-md bg-surface-tertiary text-secondary hover:text-white disabled:opacity-40 transition-colors"
                  title="Attach file"
                >
                  <Paperclip size={14} />
                </button>
                <input
                  ref={replyFileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => { if (e.target.files!.length) addReplyFiles(e.target.files!); e.target.value = ''; }}
                />
                <button
                  onClick={handleSendReply}
                  disabled={!replyBody.trim() || sending}
                  className="px-2 py-2 rounded-md bg-brand text-white hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
            {replyAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {replyAttachments.map((att, idx) => (
                  <span key={idx} className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-tertiary border border-border text-xs text-secondary">
                    <Paperclip size={9} className="text-secondary" />
                    <span className="truncate max-w-[80px]">{att.filename}</span>
                    <button onClick={() => setReplyAttachments(prev => prev.filter((_, i) => i !== idx))} className="text-tertiary hover:text-error">
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
