'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle, Plus, ThumbsUp, ThumbsDown, Minus,
  CheckCircle, XCircle, Star, RefreshCw, Tag, Filter,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';

const TABS = [
  { id: 'all', label: 'All Feedback' },
  { id: 'unresolved', label: 'Unresolved' },
  { id: 'analytics', label: 'Analytics' },
];

const CATEGORIES = ['general', 'quality', 'performance', 'accuracy', 'safety', 'ux'];

const SENTIMENT_CONFIG = {
  positive: { icon: ThumbsUp, variant: 'success', color: 'text-green-400' },
  negative: { icon: ThumbsDown, variant: 'error', color: 'text-red-400' },
  neutral: { icon: Minus, variant: 'default', color: 'text-zinc-400' },
};

function StarRating({ rating, size = 14 }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={size}
          className={i <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-zinc-700'}
        />
      ))}
    </div>
  );
}

function RatingBar({ rating, count, maxCount }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-400 w-4 text-right">{rating}</span>
      <Star size={10} className="text-yellow-400 fill-yellow-400 shrink-0" />
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-600 w-6 text-right tabular-nums">{count}</span>
    </div>
  );
}

export default function FeedbackPage() {
  const { agentId } = useAgentFilter();
  const isDemo = isDemoMode();
  const [activeTab, setActiveTab] = useState('all');

  const [feedback, setFeedback] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newFeedback, setNewFeedback] = useState({ rating: 0, comment: '', category: 'general', action_id: '' });

  // Filters
  const [sentimentFilter, setSentimentFilter] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (agentId) params.set('agent_id', agentId);
      if (sentimentFilter) params.set('sentiment', sentimentFilter);
      if (activeTab === 'unresolved') params.set('resolved', 'false');
      params.set('limit', '50');
      const qs = params.toString() ? `?${params.toString()}` : '';

      const [fbRes, statsRes] = await Promise.all([
        fetch(`/api/feedback${qs}`),
        fetch(`/api/feedback/stats${agentId ? `?agent_id=${agentId}` : ''}`),
      ]);

      if (fbRes.ok) { const d = await fbRes.json(); setFeedback(d.feedback || []); }
      if (statsRes.ok) { const d = await statsRes.json(); setStats(d); }
    } catch (err) {
      console.error('Failed to fetch feedback:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId, sentimentFilter, activeTab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!newFeedback.rating && !newFeedback.comment) return;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: newFeedback.rating || undefined,
          comment: newFeedback.comment,
          category: newFeedback.category,
          action_id: newFeedback.action_id || undefined,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewFeedback({ rating: 0, comment: '', category: 'general', action_id: '' });
        fetchData();
      }
    } catch (err) {
      alert('Failed to submit feedback');
    }
  };

  const handleResolve = async (id) => {
    try {
      await fetch(`/api/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved_by: 'user' }),
      });
      fetchData();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this feedback?')) return;
    try {
      await fetch(`/api/feedback/${id}`, { method: 'DELETE' });
      fetchData();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <PageLayout title="Feedback" subtitle="User feedback tied to agent decisions">
        <ListSkeleton />
      </PageLayout>
    );
  }

  const overall = stats?.overall || {};

  return (
    <PageLayout
      title="Feedback"
      subtitle="User feedback tied to agent decisions"
      breadcrumbs={['Operations', 'Feedback']}
      actions={
        <button onClick={fetchData} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw size={16} />
        </button>
      }
    >
      <div className="p-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Total" value={overall.total_feedback || 0} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Avg Rating" value={overall.avg_rating ? `${overall.avg_rating}/5` : '--'} color={parseFloat(overall.avg_rating) >= 4 ? 'text-green-400' : parseFloat(overall.avg_rating) >= 3 ? 'text-yellow-400' : 'text-red-400'} />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Positive" value={overall.positive_count || 0} color="text-green-400" />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Negative" value={overall.negative_count || 0} color="text-red-400" />
            </CardContent>
          </Card>
          <Card hover={false}>
            <CardContent className="py-4">
              <StatCompact label="Unresolved" value={overall.unresolved_count || 0} color={parseInt(overall.unresolved_count) > 0 ? 'text-yellow-400' : 'text-zinc-400'} />
            </CardContent>
          </Card>
        </div>

        {/* Tabs + filters */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 border-b border-[rgba(255,255,255,0.06)]">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.id ? 'text-white border-brand' : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={sentimentFilter} onChange={e => setSentimentFilter(e.target.value)} className="px-2 py-1 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-xs text-white focus:outline-none focus:border-brand">
              <option value="">All sentiment</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>
            <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors">
              <Plus size={14} /> Add Feedback
            </button>
          </div>
        </div>

        {showCreate && (
          <Card>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">Rating:</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(i => (
                    <button key={i} onClick={() => setNewFeedback(s => ({ ...s, rating: s.rating === i ? 0 : i }))} className="p-0.5">
                      <Star size={20} className={i <= newFeedback.rating ? 'text-yellow-400 fill-yellow-400' : 'text-zinc-700 hover:text-zinc-500'} />
                    </button>
                  ))}
                </div>
              </div>
              <textarea value={newFeedback.comment} onChange={e => setNewFeedback(s => ({ ...s, comment: e.target.value }))} placeholder="What happened? How did the agent perform?" rows={3} className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
              <div className="grid grid-cols-2 gap-3">
                <select value={newFeedback.category} onChange={e => setNewFeedback(s => ({ ...s, category: e.target.value }))} className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white focus:outline-none focus:border-brand">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={newFeedback.action_id} onChange={e => setNewFeedback(s => ({ ...s, action_id: e.target.value }))} placeholder="Action ID (optional)" className="px-3 py-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.1)] text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-brand" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleCreate} disabled={!newFeedback.rating && !newFeedback.comment} className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-50">Submit</button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab !== 'analytics' && (
          <Card>
            <CardHeader title={activeTab === 'unresolved' ? 'Unresolved Feedback' : 'All Feedback'} icon={MessageCircle} count={feedback.length} />
            <CardContent>
              {feedback.length === 0 ? (
                <EmptyState icon={MessageCircle} title="No feedback yet" description={activeTab === 'unresolved' ? 'All feedback has been resolved.' : 'Submit feedback to track agent quality.'} />
              ) : (
                <div className="space-y-2">
                  {feedback.map(fb => {
                    const sentConf = SENTIMENT_CONFIG[fb.sentiment] || SENTIMENT_CONFIG.neutral;
                    const SentIcon = sentConf.icon;
                    return (
                      <div key={fb.id} className={`py-3 px-3 rounded-lg border ${fb.resolved ? 'bg-[#0a0a0a] border-[rgba(255,255,255,0.02)]' : 'bg-[#111] border-[rgba(255,255,255,0.04)]'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <SentIcon size={14} className={sentConf.color} />
                            {fb.rating && <StarRating rating={fb.rating} size={12} />}
                            <Badge size="xs">{fb.category}</Badge>
                            {fb.agent_id && <span className="text-[10px] text-zinc-600">{fb.agent_id}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {fb.resolved ? (
                              <Badge variant="success" size="xs">resolved</Badge>
                            ) : (
                              <button onClick={() => handleResolve(fb.id)} className="p-1 rounded text-zinc-600 hover:text-green-400 transition-colors" title="Mark resolved">
                                <CheckCircle size={14} />
                              </button>
                            )}
                            <button onClick={() => handleDelete(fb.id)} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors" title="Delete">
                              <XCircle size={14} />
                            </button>
                          </div>
                        </div>
                        {fb.comment && <p className="text-xs text-zinc-300 mt-1">{fb.comment}</p>}
                        <div className="flex items-center gap-2 mt-1.5">
                          {fb.tags && JSON.parse(typeof fb.tags === 'string' ? fb.tags : JSON.stringify(fb.tags)).map(tag => (
                            <Badge key={tag} size="xs" variant="info">{tag}</Badge>
                          ))}
                          {fb.action_id && <span className="text-[10px] text-zinc-600">action: {fb.action_id}</span>}
                          <span className="text-[10px] text-zinc-700 ml-auto">{new Date(fb.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'analytics' && stats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rating distribution */}
            {stats.rating_distribution && stats.rating_distribution.length > 0 && (
              <Card>
                <CardHeader title="Rating Distribution" icon={Star} />
                <CardContent>
                  <div className="space-y-2">
                    {[5, 4, 3, 2, 1].map(r => {
                      const bucket = stats.rating_distribution.find(b => parseInt(b.rating) === r);
                      const count = bucket ? parseInt(bucket.count) : 0;
                      const maxCount = Math.max(...stats.rating_distribution.map(b => parseInt(b.count) || 0));
                      return <RatingBar key={r} rating={r} count={count} maxCount={maxCount} />;
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Top tags */}
            {stats.top_tags && stats.top_tags.length > 0 && (
              <Card>
                <CardHeader title="Top Tags" icon={Tag} />
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {stats.top_tags.map(t => (
                      <Badge key={t.tag} size="sm" variant="info">
                        {t.tag} ({t.count})
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* By category */}
            {stats.by_category && stats.by_category.length > 0 && (
              <Card>
                <CardHeader title="By Category" icon={Filter} />
                <CardContent>
                  <div className="space-y-2">
                    {stats.by_category.map(c => (
                      <div key={c.category} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-zinc-300 capitalize">{c.category}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500 tabular-nums">{c.count} entries</span>
                          <span className="text-xs text-zinc-400 tabular-nums">{c.avg_rating}/5 avg</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* By agent */}
            {stats.by_agent && stats.by_agent.length > 0 && (
              <Card>
                <CardHeader title="By Agent" />
                <CardContent>
                  <div className="space-y-2">
                    {stats.by_agent.map(a => (
                      <div key={a.agent_id} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-zinc-300">{a.agent_id}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500 tabular-nums">{a.count} entries</span>
                          <span className="text-xs text-green-400 tabular-nums">{a.positive}+</span>
                          <span className="text-xs text-red-400 tabular-nums">{a.negative}-</span>
                          <span className="text-xs text-zinc-400 tabular-nums">{a.avg_rating}/5</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
