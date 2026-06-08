'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MessageSquare, Inbox, ArrowRight, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useRealtime } from '../hooks/useRealtime';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { getAgentColor } from '../lib/colors';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips.js';

const TYPE_VARIANTS: Record<string, string> = {
  action: 'warning',
  info: 'info',
  lesson: 'success',
  question: 'secondary',
  status: 'default',
};

function timeAgo(dateStr: any) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function RecentMessagesCard() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  useRealtime(useCallback((event: any, payload: any) => {
    if (event !== 'message.created' || !payload) return;
    const msg = payload.message || payload;
    if (!msg.id) return;
    if (agentId && msg.from_agent_id !== agentId && msg.to_agent_id !== agentId) return;

    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      return [msg, ...prev].slice(0, 10);
    });
  }, [agentId]));

  useEffect(() => {
    async function fetchMessages() {
      try {
        const params = new URLSearchParams({ direction: 'inbox', limit: '10' });
        if (agentId) params.set('agent_id', agentId);
        const res = await fetch(`/api/messages?${params}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setMessages(data.messages || []);
      } catch (error) {
        console.error('Failed to fetch messages:', error);
        setMessages([]);
      } finally {
        setLoading(false);
      }
    }
    fetchMessages();
  }, [agentId]);

  if (loading) {
    return <CardSkeleton />;
  }

  const ITEM_H = 56;
  const OVERFLOW_LINK_H = 28;
  const maxVisible = tileHeight > 0 ? fitItems(tileHeight, ITEM_H, OVERFLOW_LINK_H) : 3;
  const visibleMessages = messages.slice(0, maxVisible);
  const overflow = messages.length - visibleMessages.length;
  const unreadCount = messages.filter(m => !m.is_read && m.status === 'sent').length;

  const viewAllLink = (
    <Link href="/messages" className="text-xs text-brand hover:text-brand-hover transition-colors inline-flex items-center gap-1">
      View all <ArrowRight size={12} />
    </Link>
  );

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Recent Messages<HelpIcon sectionKey="messages" tip={HELP_TIPS['messages']} /></span>} icon={MessageSquare} count={unreadCount > 0 ? unreadCount : undefined} action={viewAllLink} />

      <CardContent>
        <div ref={sizeRef as React.RefObject<HTMLDivElement>} className="flex flex-col h-full min-h-0">
          <div className="flex-1 min-h-0 space-y-1.5">
            {messages.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="No messages yet"
                description="Agents can send messages via the SDK's sendMessage() method"
              />
            ) : (
              visibleMessages.map((msg) => {
                const agentColor = getAgentColor(msg.from_agent_id);
                const isUnread = !msg.is_read && msg.status === 'sent';

                return (
                  <div
                    key={msg.id}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-surface-tertiary border border-border transition-colors duration-150 hover:border-zinc-700"
                  >
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border ${agentColor}`}>
                      <MessageSquare size={12} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isUnread && <div className="w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />}
                        {msg.urgent && <AlertCircle size={11} className="text-error flex-shrink-0" />}
                        <span className={`text-sm truncate ${isUnread ? 'font-semibold text-white' : 'text-secondary'}`}>
                          {msg.from_agent_id || 'Unknown'}
                        </span>
                        <Badge variant={TYPE_VARIANTS[msg.message_type] || 'default'} size="xs">
                          {msg.message_type}
                        </Badge>
                      </div>
                      <div className="text-xs text-tertiary truncate mt-0.5">
                        {msg.subject || msg.body || '(no content)'}
                      </div>
                    </div>

                    <span className="text-[10px] text-disabled flex-shrink-0 mt-1">
                      {timeAgo(msg.created_at)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
