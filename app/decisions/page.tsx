'use client';

import { Suspense, useState, useEffect, useCallback, useMemo, useRef, type ElementType } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PageLayout from '../components/PageLayout';
import ObserveModeBanner from '../components/ObserveModeBanner';
import GovernanceSignalsPanel from '../components/GovernanceSignalsPanel';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { CollapsibleSection } from '../components/ui/CollapsibleSection';
import { getAgentColor } from '../lib/colors';
import { EntityLink } from '../components/context-menu/EntityLink';
import { isDemoMode } from '../lib/isDemoMode';
import {
  getHomepageDemoActions,
  readHomepageResolution,
} from '../lib/homepageDemoActions';
import { formatCost, formatTokens } from '../lib/formatCost';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { useListControls, type ListColumn } from '../lib/useListControls';
import { ListControlsBar } from '../components/ListControlsBar';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { useRealtime } from '../hooks/useRealtime';
import { OutcomeBadge } from '../components/OutcomeBadge';
import { parseJsonArray } from '../lib/parseJson';
import {
  Zap, Hammer, Rocket, FileText, Briefcase, Shield, MessageSquare,
  Link as LinkIcon, Calendar, Search, Eye, Wrench, RefreshCw, FlaskConical,
  Settings, Radio, AlertTriangle, Trash2, Package, Inbox,
  CheckCircle2, XCircle, Clock, Loader2, Ban, HelpCircle,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCw,
  ShieldCheck, ShieldAlert, ShieldOff, ExternalLink, Info,
  Square, CheckSquare,
} from 'lucide-react';

const typeIconMap: Record<string, React.ElementType> = {
  build: Hammer, deploy: Rocket, post: FileText, apply: Briefcase, security: Shield,
  message: MessageSquare, api: LinkIcon, calendar: Calendar, research: Search, review: Eye,
  fix: Wrench, refactor: RefreshCw, test: FlaskConical, config: Settings, monitor: Radio,
  alert: AlertTriangle, cleanup: Trash2, sync: RefreshCw, migrate: Package,
};

const statusIconMap: Record<string, React.ElementType> = {
  completed: CheckCircle2, failed: XCircle, pending: Clock, running: Loader2, cancelled: Ban, blocked: Ban,
  // 'unknown' = server-reconciled zombie: was 'running', outcome never
  // reported within the timeout window (stale-outcome sweep).
  unknown: HelpCircle,
};

const statusDotMap: Record<string, string> = {
  completed: 'bg-status-success',
  running: 'bg-status-warning',
  pending: 'bg-status-info',
  failed: 'bg-status-error',
  blocked: 'bg-status-error',
  cancelled: 'bg-zinc-500',
  unknown: 'bg-zinc-500',
};

const statusTextMap: Record<string, string> = {
  completed: 'text-success',
  running: 'text-warning',
  pending: 'text-info',
  failed: 'text-error',
  blocked: 'text-error',
  cancelled: 'text-tertiary',
  unknown: 'text-tertiary',
};

// Enforcement-type → ledger status alias for /decisions?decision= deep links
// (analytics Policy Enforcement card). 'warn' has no mapping — warn
// evaluations never create ledger entries, so analytics doesn't link it.
const DECISION_TO_STATUS: Record<string, string> = {
  block: 'blocked',
  require_approval: 'pending_approval',
};

// Containment Verdicts lifecycle chip — containment_status is a separate
// column from action.status, so it renders alongside the status dot/outcome
// badge rather than replacing them. 'awaiting_promotion' is the state that
// needs an operator, hence the brand-orange cue; every other state pairs an
// icon with the label so status is never color-only.
const CONTAINMENT_CHIP: Record<string, { variant: string; label: string; icon: ElementType }> = {
  contained: { variant: 'info', label: 'Contained', icon: Info },
  awaiting_promotion: { variant: 'brand', label: 'Awaiting promotion', icon: AlertTriangle },
  promoted: { variant: 'success', label: 'Promoted', icon: CheckCircle2 },
  discarded: { variant: 'default', label: 'Discarded', icon: Ban },
};

// Sort-only over the loaded server page (rule: server-paginated lists keep
// every server-side filter dropdown untouched; this never adds a filter).
const decisionsColumns: ListColumn<any>[] = [
  { key: 'time', label: 'Time', accessor: (a) => a.timestamp_start, sortable: true },
  { key: 'risk', label: 'Risk', accessor: (a) => a.risk_score, sortable: true },
  { key: 'agent', label: 'Agent', accessor: (a) => a.agent_name || a.agent_id, sortable: true },
  { key: 'status', label: 'Status', accessor: (a) => a.status, sortable: true },
];

// One-shot read of the supported /decisions URL params. Lazy state seeds so
// shared links (?agent_id=&action_type=&status=&outcome_status=&swarm_id=
// &risk_min=&decision=) actually filter — they used to be silently ignored.
function readInitialFilters(searchParams: URLSearchParams | null) {
  const get = (k: string) => (searchParams?.get(k) || '').trim();
  const decision = get('decision');
  const riskMin = get('risk_min');
  return {
    agent: get('agent_id'),
    type: get('action_type'),
    status: get('status') || (decision ? DECISION_TO_STATUS[decision] || '' : ''),
    outcome: get('outcome_status'),
    swarm: get('swarm_id'),
    riskMin: /^\d+$/.test(riskMin) ? riskMin : null,
  };
}

function DecisionsLedgerInner() {
  const { agentId: globalAgentId } = useAgentFilter();
  const { isAdmin } = useEffectiveRole();
  const searchParams = useSearchParams();
  // Seed once — later filter changes write back to the URL (replaceState),
  // they don't re-read it, so there's no router churn loop.
  const [initialFilters] = useState(() => readInitialFilters(searchParams));
  // ?severity=red|amber (SystemStatusBar quick links) seeds the signals panel,
  // not the actions fetch — signals and ledger rows are different objects.
  const [initialSeverity] = useState<'red' | 'amber' | null>(() => {
    const s = (searchParams?.get('severity') || '').trim();
    return s === 'red' || s === 'amber' ? s : null;
  });

  const [actions, setActions] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [expandedId, setExpandedId] = useState<any>(null);
  const [expandedData, setExpandedData] = useState<Record<string, any>>({});
  const [clearing, setClearing] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [deletingId, setDeletingId] = useState<any>(null);
  // Sort-only client controls over the currently-loaded server page.
  const decisionsControls = useListControls(actions, decisionsColumns);
  const selection = useSelection<any>(decisionsControls.rows, (a) => a.action_id);
  const selectedActions = selection.selectedSet;
  const clearSelection = selection.clear;
  const [bulkDeleting, setBulkDeleting] = useState(false);
  useSelectAllHotkey(selection.toggleAll);

  // The selection covers the current server page; client-side sort/search
  // narrows which of those rows are visible. A selected id must never point
  // at a row the operator can no longer see (same pattern as identities.tsx).
  useEffect(() => {
    const visibleIds = new Set(decisionsControls.rows.map((a) => a.action_id));
    const pruned = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (pruned.length !== selection.selectedIds.length) {
      selection.setSelected(pruned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionsControls.rows]);

  const [filterAgent, setFilterAgent] = useState(initialFilters.agent);
  const [filterType, setFilterType] = useState(initialFilters.type);
  const [filterStatus, setFilterStatus] = useState(initialFilters.status);
  const [filterOutcome, setFilterOutcome] = useState(initialFilters.outcome);
  const [filterSwarm, setFilterSwarm] = useState(initialFilters.swarm);
  const [knownSwarms, setKnownSwarms] = useState<any[]>([]); // accumulates swarm_ids seen, so the dropdown stays stable when filtered
  const [filterRiskMin, setFilterRiskMin] = useState(initialFilters.riskMin ?? '1');
  const [hideRoutine, setHideRoutine] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  // Sync global agent filter → local filter. Skip the mount run when the URL
  // seeded ?agent_id — otherwise the (usually empty) global filter clobbers
  // the deep link before the first fetch.
  const skipFirstAgentSync = useRef(!!initialFilters.agent);
  useEffect(() => {
    if (skipFirstAgentSync.current) {
      skipFirstAgentSync.current = false;
      return;
    }
    setFilterAgent(globalAgentId || '');
    setPage(0);
  }, [globalAgentId]);

  // Keep the URL in sync with the active filters (replaceState — shareable
  // links without history spam). The ?decision= alias is consumed at load;
  // its canonical written form is status.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const setOrDel = (k: string, v: string, def = '') => {
      if (v && v !== def) params.set(k, v);
      else params.delete(k);
    };
    setOrDel('agent_id', filterAgent);
    setOrDel('action_type', filterType);
    setOrDel('status', filterStatus);
    setOrDel('outcome_status', filterOutcome);
    setOrDel('swarm_id', filterSwarm);
    setOrDel('risk_min', filterRiskMin, '1');
    params.delete('decision');
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [filterAgent, filterType, filterStatus, filterOutcome, filterSwarm, filterRiskMin]);

  const fetchActions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterAgent) params.set('agent_id', filterAgent);
      if (filterType) params.set('action_type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      if (filterOutcome) params.set('outcome_status', filterOutcome);
      if (filterSwarm) params.set('swarm_id', filterSwarm);
      if (hideRoutine && !filterStatus) params.set('exclude_status', 'running');
      if (filterRiskMin) params.set('risk_min', filterRiskMin);
      params.set('limit', pageSize.toString());
      params.set('offset', (page * pageSize).toString());

      const res = await fetch(`/api/actions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      const actionsList = data.actions || [];

      // In demo mode (dashclaw.io), prepend the three homepage demo
      // scenarios so visitors see the exact actions they evaluated on
      // the home page as the first entries. The Deploy to production
      // entry reflects the visitor's local Approve / Deny click.
      let displayed = actionsList;
      let displayedTotal = data.total || 0;
      if (isDemoMode() && page === 0) {
        const resolution = readHomepageResolution();
        const homepageActions = getHomepageDemoActions(resolution);
        const existingIds = new Set(actionsList.map((a: any) => a.action_id));
        const fresh = homepageActions.filter((a: any) => !existingIds.has(a.action_id));
        displayed = [...homepageActions, ...actionsList.filter((a: any) => !homepageActions.some((h: any) => h.action_id === a.action_id))];
        displayedTotal = displayedTotal + fresh.length;
      }

      setActions(displayed);
      setStats(data.stats || {});
      setTotal(displayedTotal);
      setLastUpdated(new Date().toLocaleTimeString());
      const seen = displayed.map((a: any) => a.swarm_id).filter(Boolean);
      if (seen.length) setKnownSwarms((prev) => Array.from(new Set([...prev, ...seen])));
    } catch (error) {
      console.error('Failed to fetch actions:', error);
    } finally {
      setLoading(false);
    }
  }, [filterAgent, filterType, filterStatus, filterOutcome, filterSwarm, filterRiskMin, hideRoutine, page]);

  useEffect(() => {
    setLoading(true);
    clearSelection();
    fetchActions();
  }, [fetchActions, clearSelection]);

  // Live updates — the SSE stream (/api/stream) already emits action.created /
  // action.updated for every governed decision (same source the Activity stream
  // uses). Debounced-refetch when one arrives so the ledger stays live without a
  // manual Refresh. We only refetch on page 0 (so paging through history isn't
  // disrupted) and honor the current agent filter. useRealtime no-ops in demo.
  const liveTimer = useRef<any>(null);
  useRealtime(useCallback((event: string, payload: any) => {
    if (event !== 'action.created' && event !== 'action.updated') return;
    const a = payload?.action || payload;
    if (filterAgent && a?.agent_id && a.agent_id !== filterAgent) return;
    if (page !== 0) return;
    if (liveTimer.current) return; // coalesce bursts into one refetch
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      fetchActions();
    }, 800);
  }, [filterAgent, page, fetchActions]));

  useEffect(() => () => { if (liveTimer.current) clearTimeout(liveTimer.current); }, []);

  // Inline toast for mutation feedback (mirrors /decisions/[actionId]) — window.alert is banned.
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string, kind: 'success' | 'error' = 'error') => {
    setToast({ msg, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Visible, individually clearable indicators for every active filter — a
  // deep-linked arrival must be able to SEE why the list is narrowed.
  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (filterAgent) chips.push({ key: 'agent', label: `agent: ${filterAgent}`, clear: () => setFilterAgent('') });
    if (filterType) chips.push({ key: 'type', label: `type: ${filterType}`, clear: () => setFilterType('') });
    if (filterStatus) chips.push({ key: 'status', label: `status: ${filterStatus.replace(/_/g, ' ')}`, clear: () => setFilterStatus('') });
    if (filterOutcome) chips.push({ key: 'outcome', label: `outcome: ${filterOutcome.replace(/_/g, ' ')}`, clear: () => setFilterOutcome('') });
    if (filterSwarm) chips.push({ key: 'swarm', label: `swarm: ${filterSwarm}`, clear: () => setFilterSwarm('') });
    if (filterRiskMin && filterRiskMin !== '1') chips.push({ key: 'risk', label: `risk ≥ ${filterRiskMin}`, clear: () => setFilterRiskMin('1') });
    return chips;
  }, [filterAgent, filterType, filterStatus, filterOutcome, filterSwarm, filterRiskMin]);

  const handleClearActions = async () => {
    const agentLabel = filterAgent || 'all agents';
    const statusLabel = filterStatus || 'all statuses';
    const msg = `Delete actions for ${agentLabel} (${statusLabel})? This cannot be undone.`;
    if (!confirm(msg)) return;

    setClearing(true);
    try {
      const params = new URLSearchParams();
      if (filterAgent) params.set('agent_id', filterAgent);
      if (filterStatus) params.set('status', filterStatus);
      // If no filters set, require at least a status to prevent accidental full wipe
      if (!filterAgent && !filterStatus) {
        params.set('status', 'completed');
      }
      const res = await fetch(`/api/actions?${params}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        showToast(`Deleted ${data.deleted} action(s).`, 'success');
        setPage(0);
        fetchActions();
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to delete actions');
      }
    } catch {
      showToast('Failed to delete actions');
    } finally {
      setClearing(false);
    }
  };

  const handleRunSweep = async () => {
    setSweeping(true);
    try {
      const res = await fetch('/api/admin/trigger-outcome-sweep', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(`Swept ${data.rows_swept} timed-out action(s).`, 'success');
        fetchActions();
      } else {
        showToast(data.error || 'Sweep failed');
      }
    } catch {
      showToast('Sweep failed');
    } finally {
      setSweeping(false);
    }
  };

  const handleDeleteAction = async (actionId: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this action? This cannot be undone.')) return;
    setDeletingId(actionId);
    try {
      const res = await fetch(`/api/actions?action_id=${actionId}`, { method: 'DELETE' });
      if (res.ok) {
        setActions(prev => prev.filter(a => a.action_id !== actionId));
        if (expandedId === actionId) setExpandedId(null);
        setTotal(prev => Math.max(0, prev - 1));
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to delete action');
      }
    } catch {
      showToast('Failed to delete action');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDeleteSelected = async () => {
    // Defensive re-scope to currently-visible rows: the pruning effect keeps
    // the selection in sync, but a destructive delete must never trust a
    // selection snapshot that could include a hidden/stale id (the
    // effect-race window between a render and this handler firing) — same
    // pattern as identities.tsx's handleBulkDeleteAgents.
    const visibleIds = new Set(decisionsControls.rows.map((a) => a.action_id));
    const ids = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (ids.length === 0) return;
    const msg = `Delete ${ids.length} selected ${ids.length === 1 ? 'decision' : 'decisions'}? This cannot be undone.`;
    if (!confirm(msg)) return;
    setBulkDeleting(true);
    try {
      const deletedSet = new Set(ids);
      const res = await fetch(`/api/actions?action_ids=${ids.join(',')}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setActions(prev => prev.filter(a => !deletedSet.has(a.action_id)));
        setTotal(prev => Math.max(0, prev - (data.deleted || 0)));
        selection.clear();
        if (expandedId && deletedSet.has(expandedId)) setExpandedId(null);
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to delete actions');
      }
    } catch {
      showToast('Failed to delete actions');
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelectAction = (actionId: any, e: React.MouseEvent) => {
    e.stopPropagation();
    selection.selectClick(actionId, e.shiftKey);
  };

  const toggleSelectAllActions = () => selection.toggleAll();

  const toggleExpand = async (actionId: any) => {
    if (expandedId === actionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(actionId);
    if (!expandedData[actionId]) {
      try {
        const res = await fetch(`/api/actions/${actionId}`);
        if (res.ok) {
          const data = await res.json();
          setExpandedData(prev => ({ ...prev, [actionId]: data }));
        }
      } catch (error) {
        console.error('Failed to fetch action detail:', error);
      }
    }
  };

  const getTypeIcon = (type: string) => {
    const Icon = typeIconMap[type] || Zap;
    return <Icon size={16} className="text-secondary" />;
  };

  const getStatusIcon = (status: string) => {
    const Icon = statusIconMap[status] || Clock;
    return <Icon size={14} className={statusTextMap[status] || 'text-secondary'} />;
  };

  const getRiskColor = (score: any) => {
    const s = parseInt(score, 10);
    if (s >= 70) return 'text-error';
    if (s >= 40) return 'text-warning';
    return 'text-success';
  };

  const formatTime = (ts: any) => {
    if (!ts) return '--';
    try {
      return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch { return ts; }
  };

  const successRate = parseInt(stats.total, 10) > 0
    ? Math.round((parseInt(stats.completed, 10) / parseInt(stats.total, 10)) * 100)
    : 0;

  const totalPages = Math.ceil(total / pageSize);

  const selectClass = 'px-3 py-2 bg-surface-tertiary border border-border rounded-lg text-white text-sm focus:outline-none focus:border-brand transition-colors duration-150';

  return (
    <PageLayout
      title="Decisions Ledger"
      subtitle={`Global stream of governed agent actions${lastUpdated ? ` · Updated ${lastUpdated}` : ''}`}
      breadcrumbs={['Governance', 'Decisions']}
      maturity="stable"
      actions={
        <div className="flex items-center gap-2">
          {isAdmin && selectedActions.size > 0 && (
            <button
              onClick={handleBulkDeleteSelected}
              disabled={bulkDeleting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-error/20 bg-error-subtle px-3 py-1.5 text-sm font-medium text-error transition-colors hover:border-error/40 hover:bg-error-subtle disabled:opacity-50"
            >
              <Trash2 size={14} />
              {bulkDeleting ? 'Deleting…' : `Delete ${selectedActions.size} selected`}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleRunSweep}
              disabled={sweeping}
              title="Finalize actions that passed their outcome timeout without an agent report"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
            >
              <Clock size={14} className={sweeping ? 'motion-safe:animate-spin' : ''} />
              {sweeping ? 'Sweeping…' : 'Run sweep now'}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={handleClearActions}
              disabled={clearing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-error transition-colors hover:border-error/30 hover:text-error disabled:opacity-50"
            >
              <Trash2 size={14} />
              {clearing ? 'Clearing…' : 'Clear actions'}
            </button>
          )}
          <button
            onClick={() => { setLoading(true); fetchActions(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
          >
            <RotateCw size={14} />
            Refresh
          </button>
        </div>
      }
    >
      {toast && (
        <div
          className={`fixed inset-x-4 bottom-4 z-30 rounded-lg border p-3 text-center text-sm ${
            toast.kind === 'success'
              ? 'border-success/30 bg-success-subtle text-success'
              : 'border-error/30 bg-error-subtle text-error'
          }`}
          role="alert"
        >
          {toast.msg}
        </div>
      )}

      {/* F0: a ledger of verdicts nobody enforces must say so before the rows. */}
      <ObserveModeBanner />

      {/* Signals breakdown — landing surface for the top-bar "N Critical" /
          "N Elevated" quick links (?severity=). */}
      <GovernanceSignalsPanel initialSeverity={initialSeverity} />

      {/* Stats rail — instrument strip, not a grid of identical cards */}
      <div className="mb-6 overflow-hidden rounded-xl border border-border bg-surface-tertiary">
        <div className="grid grid-cols-2 divide-x divide-border md:grid-cols-5">
          {[
            { label: 'Total', value: stats.total || 0, color: 'text-white' },
            { label: 'Success', value: `${successRate}%`, color: 'text-success' },
            { label: 'Running', value: stats.running || 0, color: 'text-warning' },
            {
              label: 'High Risk',
              value: stats.high_risk || 0,
              color: parseInt(stats.high_risk, 10) > 0 ? 'text-error' : 'text-success',
            },
            {
              label: 'Spend',
              value: `$${parseFloat(stats.total_cost || 0).toFixed(2)}`,
              color: 'text-white',
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className={`px-5 py-4 ${i >= 2 ? 'border-t border-border md:border-t-0' : ''}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                {stat.label}
              </div>
              <div className={`mt-1 text-3xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <Card hover={false} className="mb-6">
        <div className="p-4">
          {activeFilterChips.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="active-filters">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Filtered
              </span>
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => { chip.clear(); setPage(0); }}
                  title="Remove filter"
                  className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[11px] text-brand transition-colors hover:bg-brand/20"
                >
                  {chip.label}
                  <XCircle size={11} aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setFilterAgent(''); setFilterType(''); setFilterStatus('');
                  setFilterOutcome(''); setFilterSwarm(''); setFilterRiskMin('1'); setPage(0);
                }}
                className="ml-1 text-[11px] font-medium text-tertiary transition-colors hover:text-white"
              >
                Clear all
              </button>
            </div>
          )}
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(0); }} className={`${selectClass} md:flex-1`}>
              <option value="">All types</option>
              {['build','deploy','post','apply','security','message','api','calendar','research','review','fix','refactor','test','config','monitor','alert','cleanup','sync','migrate','other'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }} className={`${selectClass} md:flex-1`}>
              <option value="">All statuses</option>
              {['running','pending','pending_approval','blocked','completed','failed','cancelled','unknown'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterOutcome} onChange={(e) => { setFilterOutcome(e.target.value); setPage(0); }} className={`${selectClass} md:flex-1`}>
              <option value="">All outcomes</option>
              <option value="pending">Pending outcome</option>
              <option value="completed">Completed</option>
              <option value="partial">Partial</option>
              <option value="failed">Failed</option>
              <option value="lost_confirmation">Lost confirmation</option>
            </select>
            {(knownSwarms.length > 0 || filterSwarm) && (
              <select value={filterSwarm} onChange={(e) => { setFilterSwarm(e.target.value); setPage(0); }} className={`${selectClass} md:flex-1`} aria-label="Filter by swarm">
                <option value="">All swarms</option>
                {Array.from(new Set([...knownSwarms, filterSwarm].filter(Boolean))).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            <select value={filterRiskMin} onChange={(e) => { setFilterRiskMin(e.target.value); setPage(0); }} className={`${selectClass} md:flex-1`}>
              <option value="">Any risk</option>
              <option value="1">Governed (1+)</option>
              <option value="40">Medium+ (40+)</option>
              <option value="70">High (70+)</option>
              <option value="90">Critical (90+)</option>
            </select>
            <button
              onClick={() => { setHideRoutine(!hideRoutine); setPage(0); }}
              className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                hideRoutine
                  ? 'border-brand/30 bg-brand/10 text-brand hover:border-brand/40'
                  : 'border-border bg-white/5 text-secondary hover:border-border-hover hover:text-white'
              }`}
            >
              {hideRoutine ? 'Hiding routine' : 'Showing all'}
            </button>
          </div>
        </div>
      </Card>

      {/* Actions List */}
      <CollapsibleSection
        id="decisions.stream"
        title="Decisions"
        count={total}
        controls={
          <ListControlsBar columns={decisionsColumns} controls={decisionsControls} searchPlaceholder="Search this page…" />
        }
        actions={
          totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md p-1 text-secondary transition-colors hover:bg-white/5 disabled:opacity-30"
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-1 text-[11px] tabular-nums text-tertiary">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md p-1 text-secondary transition-colors hover:bg-white/5 disabled:opacity-30"
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ) : undefined
        }
      >
      <Card hover={false}>
        <CardContent className="pt-5">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : actions.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No actions found"
              description="Adjust filters or wait for agent activity"
              action={
                <Link
                  href="/connect#first-action"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:border-border-hover hover:text-white"
                >
                  Send your first governed action
                </Link>
              }
            />
          ) : (
            <div className="space-y-2">
              {/* Select all row (scoped to the currently visible/sorted rows) */}
              {isAdmin && decisionsControls.rows.length > 1 && (
                <div className="flex items-center gap-2 px-2 py-1">
                  <button onClick={toggleSelectAllActions} className="text-tertiary hover:text-white transition-colors p-0.5" aria-label={selectedActions.size === decisionsControls.rows.length ? 'Deselect all decisions' : 'Select all decisions'}>
                    {selectedActions.size === decisionsControls.rows.length
                      ? <CheckSquare size={16} className="text-brand" />
                      : <Square size={16} />}
                  </button>
                  <span className="text-xs text-tertiary">
                    {selectedActions.size === decisionsControls.rows.length ? 'Deselect all' : `Select all (${decisionsControls.rows.length})`}
                  </span>
                </div>
              )}
              {decisionsControls.rows.map((action) => {
                const isExpanded = expandedId === action.action_id;
                const detail = expandedData[action.action_id];
                const systems = parseJsonArray(action.systems_touched);
                const sideEffects = parseJsonArray(action.side_effects);
                const artifacts = parseJsonArray(action.artifacts_created);

                return (
                  <div key={action.action_id} data-entity-type="decision" data-entity-id={action.action_id} data-entity-status={action.status} data-entity-action-type={action.action_type} className="overflow-hidden rounded-lg border border-border bg-surface-tertiary transition-colors hover:border-border-hover">
                    <div
                      onClick={() => toggleExpand(action.action_id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(action.action_id); }}
                      className="w-full cursor-pointer p-4 text-left transition-colors hover:bg-white/[0.02] focus:bg-white/[0.02] focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand/60"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-center">
                        {/* Checkbox for multi-select */}
                        {isAdmin && (
                          <button
                            onClick={(e) => toggleSelectAction(action.action_id, e)}
                            className="hidden flex-shrink-0 p-0.5 text-tertiary transition-colors hover:text-white md:block"
                            aria-label="Select decision"
                          >
                            {selectedActions.has(action.action_id)
                              ? <CheckSquare size={16} className="text-brand" />
                              : <Square size={16} />}
                          </button>
                        )}

                        {/* 1. Agent & Intent */}
                        <div className="min-w-0 flex-1">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 rounded-full ${statusDotMap[action.status] || 'bg-zinc-500'}`} />
                            <EntityLink
                              type="agent"
                              id={action.agent_id}
                              name={action.agent_name || action.agent_id}
                              onClick={(e) => e.stopPropagation()}
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${getAgentColor(action.agent_id)}`}
                            />

                            {action.model && (
                              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-tertiary" title="Model">{action.model}</span>
                            )}
                            <span className="font-mono text-[11px] tabular-nums text-tertiary">{formatTime(action.timestamp_start)}</span>
                          </div>
                          <div className="truncate border-l border-white/5 pl-3.5 text-sm font-medium text-white">
                            {action.declared_goal}
                          </div>
                        </div>

                        {/* 2. Governance — risk score */}
                        <div className="flex items-center gap-3 rounded-lg border border-border bg-white/[0.02] px-3 py-2 md:min-w-[140px]">
                          <Shield size={14} className={action.risk_score >= 70 ? 'text-error' : 'text-success'} />
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Governance</div>
                            <div className={`text-xs font-semibold tabular-nums ${getRiskColor(action.risk_score)}`}>
                              Risk {action.risk_score || 0}
                            </div>
                          </div>
                        </div>

                        {/* 3. Outcome */}
                        <div className="flex items-center justify-between gap-4 md:min-w-[200px]">
                          <div className="mr-2 flex flex-col items-end gap-1">
                            {action.verified ? (
                              <div className="inline-flex items-center gap-1 rounded border border-success/20 bg-success-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-success" title="Cryptographically signed by agent">
                                <ShieldCheck size={10} /> Verified
                              </div>
                            ) : action.signature ? (
                              <div className="inline-flex items-center gap-1 rounded border border-error/20 bg-error-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-error" title="Signature invalid or tampered">
                                <ShieldAlert size={10} /> Invalid
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 rounded border border-border bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary" title="No cryptographic signature provided">
                                <Info size={10} /> Unsigned
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              {getStatusIcon(action.status)}
                              <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${statusTextMap[action.status] || 'text-secondary'}`}>
                                {action.status}
                              </span>
                            </div>
                            {action.outcome_status && action.outcome_status !== 'pending' && (
                              <OutcomeBadge status={action.outcome_status} />
                            )}
                            {action.containment_status && CONTAINMENT_CHIP[action.containment_status] && (() => {
                              const chip = CONTAINMENT_CHIP[action.containment_status];
                              if (!chip) return null;
                              const ChipIcon = chip.icon;
                              return (
                                <Badge variant={chip.variant} size="xs">
                                  <ChipIcon size={10} className="mr-1 inline" />
                                  {chip.label}
                                </Badge>
                              );
                            })()}
                            {/* Enforcement visibility (F0): a verdict that did not
                                (or could not) stop execution must never render
                                identically to an enforced one. executed_despite is
                                the PostToolUse witness that the tool ran; observe
                                mode on a gated row means the hook never intended
                                to stop it. */}
                            {action.executed_despite ? (
                              <span title="PostToolUse witnessed this gated action execute — the verdict did not stop the tool call">
                                <Badge variant="error" size="xs">
                                  <ShieldOff size={10} className="mr-1 inline" />
                                  Executed despite {action.executed_despite === 'require_approval' ? 'approval gate' : 'block'}
                                </Badge>
                              </span>
                            ) : action.enforcement_mode === 'observe' && (action.status === 'blocked' || action.status === 'pending_approval') ? (
                              <span title="The agent's hooks were in observe mode — this verdict was logged, not enforced">
                                <Badge variant="warning" size="xs">
                                  <ShieldOff size={10} className="mr-1 inline" />
                                  Logged, not enforced
                                </Badge>
                              </span>
                            ) : null}
                            {action.cost_estimate > 0 && (
                              <div className="flex flex-col items-end">
                                <span className="font-mono text-[11px] tabular-nums text-secondary">
                                  {formatCost(action.cost_estimate)}
                                </span>
                                {(action.tokens_in > 0 || action.tokens_out > 0) && (
                                  <span className="font-mono text-[10px] tabular-nums text-tertiary">
                                    {formatTokens(action.tokens_in)} in · {formatTokens(action.tokens_out)} out
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            {isAdmin && (
                              <button
                                onClick={(e) => handleDeleteAction(action.action_id, e)}
                                disabled={deletingId === action.action_id}
                                className="rounded-md p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error disabled:opacity-50"
                                aria-label="Delete decision"
                                title="Delete decision"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                            {isExpanded
                              ? <ChevronUp size={14} className="text-tertiary" />
                              : <ChevronDown size={14} className="text-tertiary" />}
                          </div>
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="space-y-5 border-t border-border bg-surface-secondary p-5">
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                          <div>
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Decision Rationale</div>
                            <div className="text-sm text-secondary">{action.reasoning || 'Not specified'}</div>
                          </div>
                          <div>
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Authorization</div>
                            <div className="text-sm text-secondary">{action.authorization_scope || 'Not specified'}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Confidence</span>
                            <span className="tabular-nums text-white">{action.confidence || 50}%</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Reversible</span>
                            <span className={action.reversible ? 'text-success' : 'text-error'}>{action.reversible ? 'Yes' : 'No'}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Duration</span>
                            <span className="tabular-nums text-white">{action.duration_ms ? `${(action.duration_ms / 1000).toFixed(1)}s` : '--'}</span>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Cost</span>
                            <span className="font-mono tabular-nums text-white">${parseFloat(action.cost_estimate || 0).toFixed(4)}</span>
                          </div>
                        </div>

                        {action.output_summary && (
                          <div>
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Output</div>
                            <div className="rounded-md border border-border bg-surface-primary p-3 font-mono text-xs text-secondary">{action.output_summary}</div>
                          </div>
                        )}

                        {action.error_message && (
                          <div>
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Error</div>
                            <div className="rounded-md border border-error/20 bg-error-subtle p-3 font-mono text-xs text-error">{action.error_message}</div>
                          </div>
                        )}

                        {sideEffects.length > 0 && (
                          <div>
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Side Effects · {sideEffects.length}</div>
                            <div className="flex flex-wrap gap-1">
                              {sideEffects.map((se: any, i: number) => <Badge key={i} variant="warning" size="xs">{se}</Badge>)}
                            </div>
                          </div>
                        )}

                        {artifacts.length > 0 && (
                          <div>
                            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Artifacts · {artifacts.length}</div>
                            <div className="flex flex-wrap gap-1">
                              {artifacts.map((a: any, i: number) => <Badge key={i} variant="info" size="xs">{a}</Badge>)}
                            </div>
                          </div>
                        )}

                        {detail && (
                          <>
                            {detail.assumptions?.length > 0 && (
                              <div>
                                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Assumptions · {detail.assumptions.length}</div>
                                <div className="space-y-1">
                                  {detail.assumptions.map((asm: any) => (
                                    <div key={asm.assumption_id} className="flex items-center gap-2 text-sm">
                                      {asm.validated
                                        ? <CheckCircle2 size={14} className="shrink-0 text-success" />
                                        : asm.invalidated
                                          ? <XCircle size={14} className="shrink-0 text-error" />
                                          : <Clock size={14} className="shrink-0 text-tertiary" />}
                                      <span className="text-secondary">{asm.assumption}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                          </>
                        )}

                        <div className="flex items-center gap-4 border-t border-border pt-4">
                          <Link
                            href={`/decisions/${action.action_id}`}
                            className="text-sm font-medium text-brand transition-colors hover:text-brand-hover"
                          >
                            View full decision record →
                          </Link>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const url = `${window.location.origin}/replay/${action.action_id}`;
                              navigator.clipboard.writeText(url);
                              showToast('Replay link copied to clipboard.', 'success');
                            }}
                            className="inline-flex items-center gap-1.5 text-xs text-tertiary transition-colors hover:text-secondary"
                          >
                            <ExternalLink size={12} />
                            Share replay
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </CollapsibleSection>
    </PageLayout>
  );
}

// Next 16: any page reading useSearchParams must render inside a Suspense
// boundary or `next build` fails (see reference_next16_usesearchparams_suspense).
export default function DecisionsLedger() {
  return (
    <Suspense fallback={null}>
      <DecisionsLedgerInner />
    </Suspense>
  );
}
