'use client';

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, CheckCheck, X, Inbox, Hash } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';
import { useRealtime } from '../hooks/useRealtime';

import ConversationList, { ConversationItem, itemId } from './_components/ConversationList';
import MessageDetail from './_components/MessageDetail';
import ComposeModal from './_components/ComposeModal';
import ThreadConversation from './_components/ThreadConversation';
import CreateThreadForm from './_components/CreateThreadForm';

// Filter chips — each maps to existing GET /api/messages(/threads) server
// params; no client-side re-filtering of an over-fetched list.
const CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'needs-input', label: 'Needs input' },
  { key: 'threads', label: 'Threads' },
  { key: 'broadcasts', label: 'Broadcasts' },
] as const;

const MESSAGE_TYPES = ['info', 'action', 'question', 'lesson', 'status'];

const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  'all': { title: 'No conversations yet', description: "Agents send messages via the SDK's sendMessage() method; threads group ongoing work." },
  'needs-input': { title: 'Nothing needs your input', description: 'Questions and action requests from agents land here.' },
  'threads': { title: 'No threads yet', description: 'Threads group related messages around one task or incident.' },
  'broadcasts': { title: 'No broadcasts', description: 'Messages sent to every agent (no single recipient) appear here.' },
};

function activityOf(item: ConversationItem): string {
  return item.kind === 'thread'
    ? (item.thread.last_message_at || item.thread.created_at || '')
    : (item.message.created_at || '');
}

function MessagesPageInner() {
  const { agentId: filterAgentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ?agents=a,b — the swarm page's deep link; overrides chips while active.
  const agentsParam = searchParams.get('agents');
  const swarmAgents = useMemo(
    () => (agentsParam ? agentsParam.split(',').map(s => s.trim()).filter(Boolean) : []),
    [agentsParam]
  );
  const threadParam = searchParams.get('thread');

  const [chip, setChip] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Single selection state — kind + item together, so a msg_*/mt_* id can
  // never be matched against the wrong collection.
  const [selected, setSelected] = useState<{ kind: 'message' | 'thread'; item: any } | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [composePrefill, setComposePrefill] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [showCreateThread, setShowCreateThread] = useState(false);
  const threadConvRef = useRef<((msg: any) => void) | null>(null);

  // ── One fetch path, keyed off (chip, type, ?agents=, global agent filter) ──

  const fetchData = useCallback(async () => {
    try {
      setError(null);

      const msgFetch = async (params: Record<string, string>) => {
        const qs = new URLSearchParams({ direction: 'all', limit: '100', ...params });
        const res = await fetch(`/api/messages?${qs}`);
        if (!res.ok) throw new Error('Failed to fetch messages');
        return res.json();
      };
      const threadsFetch = async () => {
        const params = new URLSearchParams({ limit: '50' });
        if (filterAgentId) params.set('agent_id', filterAgentId);
        const res = await fetch(`/api/messages/threads?${params}`);
        if (!res.ok) throw new Error('Failed to fetch threads');
        return res.json();
      };

      let nextMessages: any[] = [];
      let nextThreads: any[] = [];
      let unread: number | null = null;

      if (swarmAgents.length > 0) {
        const results = await Promise.all(
          swarmAgents.map(a => msgFetch({ agent_id: a }))
        );
        const seen = new Set<string>();
        for (const r of results) {
          for (const m of r.messages || []) {
            if (!seen.has(m.id)) { seen.add(m.id); nextMessages.push(m); }
          }
        }
      } else if (chip === 'needs-input') {
        const base: Record<string, string> = filterAgentId ? { agent_id: filterAgentId } : {};
        const [q, a] = await Promise.all([
          msgFetch({ ...base, type: 'question' }),
          msgFetch({ ...base, type: 'action' }),
        ]);
        const seen = new Set<string>();
        for (const r of [q, a]) {
          for (const m of r.messages || []) {
            if (!seen.has(m.id)) { seen.add(m.id); nextMessages.push(m); }
          }
        }
      } else if (chip === 'threads') {
        const t = await threadsFetch();
        nextThreads = t.threads || [];
      } else if (chip === 'broadcasts') {
        // direction=inbox + agent_id=all matches to_agent_id IS NULL rows
        // (broadcasts) server-side and excludes archived.
        const d = await msgFetch({ direction: 'inbox', agent_id: 'all' });
        nextMessages = d.messages || [];
        unread = d.unread_count ?? null;
      } else {
        const params: Record<string, string> = {};
        if (typeFilter) params.type = typeFilter;
        if (filterAgentId) params.agent_id = filterAgentId;
        const [d, t] = await Promise.all([msgFetch(params), threadsFetch()]);
        nextMessages = d.messages || [];
        nextThreads = t.threads || [];
        unread = d.unread_count ?? null;
      }

      setMessages(nextMessages);
      setThreads(nextThreads);
      if (unread != null) setUnreadCount(unread);

      // Sync selection with fresh server data — same kind only.
      setSelected(prev => {
        if (!prev) return prev;
        if (prev.kind === 'message') {
          const fresh = nextMessages.find((m: any) => m.id === prev.item.id);
          return fresh ? { kind: 'message', item: fresh } : prev;
        }
        const fresh = nextThreads.find((t: any) => t.id === prev.item.id);
        return fresh ? { kind: 'thread', item: fresh } : prev;
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [chip, typeFilter, swarmAgents, filterAgentId]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Agents for the compose dropdown
  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.json())
      .then(d => setAgents(d.agents || []))
      .catch(err => {
        console.warn('Failed to load agents for compose dropdown (page=messages):', err);
      });
  }, []);

  // ── URL state: ?thread=mt_x selects a thread (shareable) ────────

  const updateThreadUrl = useCallback((threadId: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (threadId) params.set('thread', threadId);
    else params.delete('thread');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `/messages?${qs}` : '/messages');
  }, []);

  const initialThreadApplied = useRef(false);
  useEffect(() => {
    if (initialThreadApplied.current || !threadParam) return;
    const t = threads.find((th: any) => th.id === threadParam);
    if (t) {
      initialThreadApplied.current = true;
      setSelected({ kind: 'thread', item: t });
    }
  }, [threads, threadParam]);

  // ── Selection ────────────────────────────────────────────────────

  const selectItem = useCallback((item: ConversationItem) => {
    if (item.kind === 'thread') {
      setSelected({ kind: 'thread', item: item.thread });
      updateThreadUrl(item.thread.id);
    } else {
      setSelected({ kind: 'message', item: item.message });
      updateThreadUrl(null);
    }
  }, [updateThreadUrl]);

  const clearSelection = useCallback(() => {
    setSelected(null);
    updateThreadUrl(null);
  }, [updateThreadUrl]);

  const handleViewThread = useCallback(async (threadId: any) => {
    const existing = threads.find((t: any) => t.id === threadId);
    if (existing) {
      setSelected({ kind: 'thread', item: existing });
      updateThreadUrl(existing.id);
      return;
    }
    // Thread isn't in the current chip's data (e.g. Needs input) — fetch it.
    try {
      const res = await fetch(`/api/messages/threads/${threadId}`);
      if (!res.ok) throw new Error('Thread not found');
      const data = await res.json();
      if (data.thread) {
        setSelected({ kind: 'thread', item: data.thread });
        updateThreadUrl(data.thread.id);
      }
    } catch {
      setError('Failed to open thread.');
    }
  }, [threads, updateThreadUrl]);

  // ── SSE real-time ────────────────────────────────────────────────

  useRealtime(useCallback((event: string, payload: any) => {
    if (event !== 'message.created' || !payload) return;
    const msg = payload.message || payload;
    if (!msg?.id) return;
    if (filterAgentId && msg.from_agent_id !== filterAgentId && msg.to_agent_id !== filterAgentId) return;
    if (swarmAgents.length > 0 && !swarmAgents.includes(msg.from_agent_id) && !swarmAgents.includes(msg.to_agent_id)) return;
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [msg, ...prev]));
    setUnreadCount(prev => prev + 1);
    // Forward to an open thread conversation
    if (typeof threadConvRef.current === 'function') {
      threadConvRef.current(msg);
    }
  }, [filterAgentId, swarmAgents]));

  // ── Actions (PATCH/POST bodies unchanged — API contract is stable) ─

  async function handleSend(payload: any) {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      setError(err.error || 'Send failed');
      throw new Error(err.error || 'Send failed');
    }
    fetchData();
  }

  async function handleMarkRead(msgId: any) {
    const now = new Date().toISOString();
    setSelected(prev => (prev && prev.kind === 'message' && prev.item.id === msgId
      ? { ...prev, item: { ...prev.item, is_read: true, status: prev.item.to_agent_id === null ? prev.item.status : 'read', read_at: now } }
      : prev));
    setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, is_read: true, status: m.to_agent_id === null ? m.status : 'read', read_at: now } : m)));
    setUnreadCount(prev => Math.max(0, prev - 1));

    await fetch('/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_ids: [msgId], action: 'read', agent_id: filterAgentId || 'dashboard' }),
    });
    fetchData();
  }

  const handleArchive = useCallback(async (msgId: any) => {
    await fetch('/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_ids: [msgId], action: 'archive', agent_id: filterAgentId || 'dashboard' }),
    });
    setSelected(prev => (prev && prev.kind === 'message' && prev.item.id === msgId ? null : prev));
    fetchData();
  }, [filterAgentId, fetchData]);

  async function handleMarkAllRead() {
    const unread = messages.filter(m => !m.is_read && m.status === 'sent');
    if (unread.length === 0) return;
    const unreadIds = new Set(unread.map(m => m.id));
    const now = new Date().toISOString();

    setMessages(prev => prev.map(m => (unreadIds.has(m.id) ? { ...m, is_read: true, status: m.to_agent_id === null ? m.status : 'read', read_at: now } : m)));
    setSelected(prev => (prev && prev.kind === 'message' && unreadIds.has(prev.item.id)
      ? { ...prev, item: { ...prev.item, is_read: true, status: prev.item.to_agent_id === null ? prev.item.status : 'read', read_at: now } }
      : prev));
    setUnreadCount(0);

    await fetch('/api/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_ids: unread.map(m => m.id), action: 'read', agent_id: filterAgentId || 'dashboard' }),
    });
    fetchData();
  }

  const handleReply = useCallback((message: any) => {
    if (message.thread_id) {
      handleViewThread(message.thread_id);
    } else {
      setComposePrefill({
        to: message.from_agent_id,
        subject: message.subject ? `Re: ${message.subject}` : '',
        type: message.message_type,
      });
      setShowCompose(true);
    }
  }, [handleViewThread]);

  // ── Unified list: threads + standalone messages, newest activity first ─

  const items: ConversationItem[] = useMemo(() => {
    const threadIds = new Set(threads.map((t: any) => t.id));
    const arr: ConversationItem[] = [
      ...threads.map((t: any) => ({ kind: 'thread' as const, thread: t })),
      // Thread-member messages are represented by their thread row when that
      // thread is in the list; otherwise (Needs input, Broadcasts, swarm
      // views) they appear individually.
      ...messages
        .filter((m: any) => !m.thread_id || !threadIds.has(m.thread_id))
        .map((m: any) => ({ kind: 'message' as const, message: m })),
    ];
    return arr.sort((a, b) => activityOf(b).localeCompare(activityOf(a)));
  }, [threads, messages]);

  // ── Keyboard navigation over the rendered order ──────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (showCompose) return; // the modal handles its own Escape

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const idx = selected
          ? items.findIndex(it => it.kind === selected.kind && itemId(it) === selected.item.id)
          : -1;
        const next = e.key === 'j' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        if (items[next]) selectItem(items[next]);
      } else if (e.key === 'r' && selected?.kind === 'message') {
        e.preventDefault();
        handleReply(selected.item);
      } else if (e.key === 'e' && selected?.kind === 'message') {
        e.preventDefault();
        handleArchive(selected.item.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearSelection();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, selected, showCompose, selectItem, clearSelection, handleArchive, handleReply]);

  // ── Render ────────────────────────────────────────────────────────

  const kbdClass = 'rounded border border-border bg-surface-tertiary px-1 py-0.5 font-mono text-secondary';
  const emptyCopy = (chip in EMPTY_COPY ? EMPTY_COPY[chip as keyof typeof EMPTY_COPY] : EMPTY_COPY['all']) as { title: string; description: string };

  return (
    <PageLayout
      title="Messages"
      subtitle="Agent communication ledger"
      breadcrumbs={['Dashboard', 'Messages']}
      actions={
        <button
          onClick={() => { setComposePrefill(null); setShowCompose(true); }}
          disabled={isDemo}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
        >
          <Plus size={14} aria-hidden="true" /> Compose
        </button>
      }
    >
      {isDemo && (
        <div role="note" className="mb-4 rounded-lg border border-border bg-surface-secondary p-3 text-sm text-secondary">
          Demo mode · messaging is read-only.
        </div>
      )}

      {/* Swarm deep-link banner — overrides the chips while active */}
      {swarmAgents.length > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-sm text-secondary">
          <span>
            Showing traffic for <span className="font-medium text-primary">{swarmAgents.join(', ')}</span>
          </span>
          <button
            onClick={() => router.replace('/messages')}
            className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <X size={12} aria-hidden="true" /> Clear
          </button>
        </div>
      )}

      {/* Filter chips + type select */}
      {swarmAgents.length === 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {CHIPS.map(c => {
            const isActive = chip === c.key;
            return (
              <button
                key={c.key}
                aria-pressed={isActive}
                onClick={() => { setChip(c.key); clearSelection(); }}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 ${
                  isActive
                    ? 'border-border-active bg-brand/10 text-brand'
                    : 'border-border text-secondary hover:border-border-hover hover:text-white'
                }`}
              >
                {c.label}
              </button>
            );
          })}
          {chip === 'all' && (
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              aria-label="Filter by message type"
              className="rounded-md border border-border bg-surface-primary px-2 py-1.5 text-xs text-secondary"
            >
              <option value="">All types</option>
              {MESSAGE_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-error/30 bg-error-subtle p-3 text-sm text-error">
          <span>{error}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData()}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
            >
              Retry
            </button>
            <button onClick={() => setError(null)} aria-label="Dismiss error" className="rounded p-0.5 text-error transition-colors hover:bg-error-subtle">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Master: unified conversation list */}
        <div className="min-w-0 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs text-tertiary">
              {items.length} conversation{items.length === 1 ? '' : 's'}
              {unreadCount > 0 && (
                <span className="text-secondary"> · {unreadCount} unread</span>
              )}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 rounded-lg border border-border bg-surface-tertiary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
                >
                  <CheckCheck size={12} aria-hidden="true" /> Mark all read
                </button>
              )}
              {!isDemo && (
                <button
                  onClick={() => setShowCreateThread(prev => !prev)}
                  className="flex items-center gap-1 rounded-lg border border-brand/20 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
                >
                  <Plus size={12} aria-hidden="true" /> New thread
                </button>
              )}
            </div>
          </div>

          {showCreateThread && (
            <CreateThreadForm
              filterAgentId={filterAgentId}
              onCreated={(thread: any) => {
                setShowCreateThread(false);
                setThreads(prev => [thread, ...prev]);
                setSelected({ kind: 'thread', item: thread });
                updateThreadUrl(thread.id);
              }}
              onCancel={() => setShowCreateThread(false)}
            />
          )}

          {loading ? (
            <div className="space-y-2 rounded-xl border border-border bg-surface-secondary p-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 motion-safe:animate-pulse rounded-lg bg-surface-tertiary" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Card hover={false}>
              <CardContent className="py-8">
                <EmptyState
                  icon={chip === 'threads' ? Hash : Inbox}
                  title={emptyCopy.title}
                  description={emptyCopy.description}
                />
              </CardContent>
            </Card>
          ) : (
            <ConversationList
              items={items}
              selected={selected ? { kind: selected.kind, id: selected.item.id } : null}
              onSelect={selectItem}
            />
          )}
        </div>

        {/* Detail: persistent pane (message or thread) */}
        <div className="min-w-0 lg:col-span-3">
          <Card hover={false}>
            <CardContent className="pt-4">
              {selected ? (
                <>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                      {selected.kind === 'thread' ? 'Thread' : 'Message'}
                    </span>
                    <button
                      onClick={clearSelection}
                      aria-label="Close detail"
                      className="rounded p-0.5 text-tertiary transition-colors hover:bg-surface-tertiary hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {selected.kind === 'thread' ? (
                    <ThreadConversation
                      thread={selected.item}
                      filterAgentId={filterAgentId}
                      onNewMessage={threadConvRef}
                      onThreadUpdated={(updated: any) => {
                        setSelected(prev => (prev && prev.kind === 'thread' ? { ...prev, item: { ...prev.item, ...updated } } : prev));
                        setThreads(prev => prev.map(t => (t.id === updated.id ? { ...t, ...updated } : t)));
                      }}
                    />
                  ) : (
                    <MessageDetail
                      message={selected.item}
                      outbound={selected.item.from_agent_id === (filterAgentId || 'dashboard')}
                      onMarkRead={handleMarkRead}
                      onArchive={handleArchive}
                      onReply={handleReply}
                      onViewThread={handleViewThread}
                    />
                  )}
                </>
              ) : (
                <div className="py-16 text-center text-sm text-tertiary">
                  Select a conversation to read it here.
                  <div className="mt-2 text-xs text-disabled">
                    <kbd className={kbdClass}>j</kbd>/<kbd className={kbdClass}>k</kbd> to navigate
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="mt-4 hidden items-center justify-center gap-3 text-xs text-tertiary md:flex">
        <span><kbd className={kbdClass}>j</kbd>/<kbd className={kbdClass}>k</kbd> navigate</span>
        <span aria-hidden="true" className="text-disabled">·</span>
        <span><kbd className={kbdClass}>r</kbd> reply</span>
        <span aria-hidden="true" className="text-disabled">·</span>
        <span><kbd className={kbdClass}>e</kbd> archive</span>
        <span aria-hidden="true" className="text-disabled">·</span>
        <span><kbd className={kbdClass}>Esc</kbd> close</span>
      </div>

      {/* Compose modal */}
      <ComposeModal
        show={showCompose}
        onClose={() => { setShowCompose(false); setComposePrefill(null); }}
        agents={agents}
        threads={threads}
        filterAgentId={filterAgentId}
        isDemo={isDemo}
        onSend={handleSend}
        prefill={composePrefill}
      />
    </PageLayout>
  );
}

// Next 16: useSearchParams must live under a Suspense boundary or the build
// fails at prerender (see app/quality/page.tsx for the same split).
export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesPageInner />
    </Suspense>
  );
}
