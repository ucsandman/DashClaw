'use client';

/**
 * Ledger — the spine of the redesigned /policies page. ONE filterable view of
 * every guard policy (mode / shield / custom / learned) with three lenses:
 *   • Table     — the full CRUD grid (folds in the old /policies/rules).
 *   • Sentences — the interruption contract as plain-English, spectrum-ordered.
 *   • Groups    — a read-only overview grouped by rule source.
 *
 * The parent (PolicyWorkbench) owns `summary` + `contract` (re-fetched via
 * onChanged); the Ledger owns the raw policy rows it mutates. Search + facet
 * filters are shared state: Table and Groups render the filtered rows; Sentences
 * renders the contract (a parallel projection of the same rules).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import {
  Table, AlignLeft, LayoutGrid, Search, Upload, Plus, Layers, Shield, Star,
  BrainCircuit, Play, Download, Check, Pencil, Trash2, X, FlaskConical, FileText,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import styles from '../policies.module.css';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import PolicyAuthoringPanel from './PolicyAuthoringPanel';
import ProofExportPanel from './ProofExportPanel';
// Built in parallel — the integrator reconciles these paths. Do not stub.
import ImportPanel from './ImportPanel';
import GeneratePanel from './GeneratePanel';
import TestPanel from './TestPanel';
import { patchPolicyParam, type ContractView } from '../lib/contractClient';
import { groupGrants, formatTarget, type SuppressedGroup } from '../lib/grantGrouping';
import {
  createDefaultPolicyFormState,
  compilePolicyPayload,
  decompilePolicyForm,
  buildPolicySummary,
  POLICY_TYPE_OPTIONS,
} from '../lib/policyFormModel';
import type { PolicySummary, RuleBucket } from '../lib/modesClient';

// ACTION_OPTIONS mirrors app/lib/guard action namespaces (copied from CustomTab).
const ACTION_OPTIONS = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other',
];

const KNOWN_POLICY_TYPE_SET = new Set(
  (POLICY_TYPE_OPTIONS as Array<{ value: string }>).map((t) => t.value),
);

type Lens = 'table' | 'sentences' | 'groups';
type Source = 'mode' | 'shield' | 'custom' | 'learned';

export interface LedgerActions {
  openNewRule: () => void;
  openImport: () => void;
  openGenerate: () => void;
  runTests: () => void;
  openProof: () => void;
}

interface LedgerProps {
  summary: PolicySummary | null;
  contract: ContractView | null;
  highlightPolicy: string | null;
  prefill: { name?: string; policy_type?: string; rules?: unknown } | null;
  refreshSignal: number;
  onChanged: () => void;
  registerActions?: (a: LedgerActions) => void;
}

interface ClassifiedRow {
  row: any;
  rules: Record<string, any>;
  source: Source;
  bucket: RuleBucket;
  fired30d: number;
  lastFiredAt: string | null;
  retired: boolean;
}

const SOURCE_META: Record<Source, { label: string; cls: string | undefined; Icon: FC<any>; dot: string; help: string }> = {
  mode: { label: 'Mode', cls: styles.srcMode, Icon: Layers, dot: 'var(--color-info)', help: 'written by your active mode preset' },
  shield: { label: 'Shield', cls: styles.srcShield, Icon: Shield, dot: 'var(--color-success)', help: 'canned protections you toggled on' },
  custom: { label: 'Custom', cls: styles.srcCustom, Icon: Star, dot: 'var(--color-text-secondary)', help: 'rules you authored' },
  learned: { label: 'Learned', cls: styles.srcLearned, Icon: BrainCircuit, dot: 'var(--color-text-tertiary)', help: 'auto-learned suppressions' },
};
const SOURCE_ORDER: Source[] = ['mode', 'shield', 'custom', 'learned'];

const BUCKET_META: Record<RuleBucket, { label: string; cls: string | undefined }> = {
  warn: { label: 'Warn', cls: styles.bkWarn },
  allow_contained: { label: 'Contain', cls: styles.bkContained },
  require_approval: { label: 'Approve', cls: styles.bkAppr },
  block: { label: 'Block', cls: styles.bkBlock },
  allow: { label: 'Grant', cls: styles.bkGrant },
};
// Facet order for the bucket group (allow/grant rows are surfaced via Source=Learned).
const BUCKET_FACETS: Array<{ value: RuleBucket; dot: string }> = [
  { value: 'warn', dot: 'var(--color-warning)' },
  { value: 'require_approval', dot: 'var(--color-brand)' },
  { value: 'block', dot: 'var(--color-error)' },
];

// Threshold-edit presets (Table lens).
const RISK_STEPS = [40, 60, 70, 80, 90, 95];
const RATE_STEPS = [50, 100, 250, 500, 650, 1000];
const SPEND_APPROVE_STEPS = [1, 5, 10, 25, 50, 100, 200];
const SPEND_BLOCK_STEPS = [10, 25, 50, 100, 250, 500];
// Sentences-lens spend presets (lifted from ContractPanel).
const APPROVE_STEPS = [1, 5, 10, 25, 50];
const BLOCK_STEPS = [10, 25, 50, 100];

// ---------------------------------------------------------------- helpers ---

function parseRules(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  try { return JSON.parse((raw as string) || '{}'); } catch { return {}; }
}

function bucketFallback(policyType: string): RuleBucket {
  switch (policyType) {
    case 'block_action_type':
    case 'protected_path': return 'block';
    case 'require_approval':
    case 'risk_threshold':
    case 'rate_limit': return 'require_approval';
    case 'warn_action_type': return 'warn';
    case 'allow_grant': return 'allow';
    default: return 'warn';
  }
}

function classify(row: any, summaryRules?: PolicySummary['rules']): ClassifiedRow {
  const rules = parseRules(row.rules);
  let source: Source;
  if (rules._mode != null) source = 'mode';
  else if (rules._shield != null) source = 'shield';
  else if (row.policy_type === 'allow_grant') source = 'learned';
  else source = 'custom';

  const sr = summaryRules?.find((r) => r.id === row.id);
  const bucket: RuleBucket = sr?.bucket ?? bucketFallback(row.policy_type);
  return {
    row,
    rules,
    source,
    bucket,
    fired30d: sr?.fired30d ?? 0,
    lastFiredAt: sr?.lastFiredAt ?? null,
    retired: !KNOWN_POLICY_TYPE_SET.has(row.policy_type),
  };
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Date.now() - t) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** PATCH one numeric rule param. Same wire shape as patchPolicyParam, but the
 *  Table lens edits `threshold`/`max_actions` too (outside that helper's typed
 *  spend-param set), so a small local equivalent keeps types honest. */
async function patchRuleParam(
  policyId: string,
  currentRules: Record<string, unknown>,
  param: string,
  value: number,
): Promise<void> {
  const res = await fetch('/api/policies', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: policyId, rules: { ...currentRules, [param]: value } }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to update (${res.status})`);
  }
}

const Code: FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className={styles.mono}>{children}</code>
);

function joinCodes(list: unknown): React.ReactNode {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return <em>selected actions</em>;
  return arr.map((a, i) => (
    <span key={String(a)}>{i > 0 ? ', ' : ''}<Code>{String(a)}</Code></span>
  ));
}

function ruleVerb(action: unknown): string {
  return action === 'block' ? 'Block' : action === 'warn' ? 'Warn on' : 'Require approval for';
}

/** Plain-English one-liner with action types as <code>. Falls back to the
 *  canonical buildPolicySummary for less common / retired types. */
function describeRule(row: any, rules: Record<string, any>): React.ReactNode {
  switch (row.policy_type) {
    case 'risk_threshold':
      return <>{ruleVerb(rules.action)} any action scoring risk &ge; {rules.threshold ?? '?'}</>;
    case 'require_approval':
      return <>Require approval for {joinCodes(rules.action_types)}</>;
    case 'block_action_type':
      return <>Block {joinCodes(rules.action_types)} entirely</>;
    case 'warn_action_type':
      return <>Warn on {joinCodes(rules.action_types)}</>;
    case 'rate_limit':
      return <>{ruleVerb(rules.action)} past <Code>{`${rules.max_actions ?? '?'}/${rules.window_minutes ?? 60}min`}</Code> per agent</>;
    case 'allow_grant':
      return <>Never bother me about <Code>{rules.action_type || 'action'}</Code>{rules.target_prefix ? <> under <Code>{rules.target_prefix}</Code></> : null}</>;
    case 'protected_path':
      return <>{ruleVerb(rules.action)} actions touching protected paths</>;
    case 'webhook_check':
      return <>Call an external webhook before allowing the action</>;
    case 'delegation_constraint': {
      const parent = rules.parent || '*';
      const childTypes = Array.isArray(rules.child_types) && rules.child_types.length > 0 ? rules.child_types : ['*'];
      const riskPart = typeof rules.max_risk_score === 'number' ? <> &mdash; risk &le; {rules.max_risk_score}</> : null;
      const blockedPart = Array.isArray(rules.blocked_action_types) && rules.blocked_action_types.length > 0
        ? <>, no {joinCodes(rules.blocked_action_types)}</>
        : null;
      return <>Constrain <Code>{`${parent}:${childTypes.join('|')}`}</Code>{riskPart}{blockedPart}</>;
    }
    case 'role_constraint': {
      const allowed = Array.isArray(rules.allowed_action_types) && rules.allowed_action_types.length > 0
        ? <> to {joinCodes(rules.allowed_action_types)}</>
        : null;
      const riskPart = typeof rules.max_risk_score === 'number' ? <> &mdash; risk &le; {rules.max_risk_score}</> : null;
      const blockedPart = Array.isArray(rules.blocked_action_types) && rules.blocked_action_types.length > 0
        ? <>, no {joinCodes(rules.blocked_action_types)}</>
        : null;
      return <>Limit the <Code>{row.name}</Code> role{allowed}{riskPart}{blockedPart}</>;
    }
    default:
      return <>{buildPolicySummary(decompilePolicyForm(row))}</>;
  }
}

// ------------------------------------------------------------ sub-components ---

const FiredCell: FC<{ fired: number; maxFired: number; lastFiredAt: string | null }> = ({ fired, maxFired, lastFiredAt }) => {
  const ratio = maxFired > 0 ? fired / maxFired : 0;
  const height = fired === 0 ? 0 : Math.max(3, Math.round(3 + 17 * ratio));
  const hot = fired > 0 && ratio >= 0.6;
  return (
    <div className={styles.firedCell}>
      <span className={`${styles.spark} ${hot ? styles.hot : ''}`} aria-hidden="true">
        <span className={styles.b} style={{ height: `${height}px` }} />
      </span>
      <span>
        <span className={styles.firedN}>{fired}</span>
        <br />
        <span className={styles.firedWhen}>{relTime(lastFiredAt)}</span>
      </span>
    </div>
  );
};

interface ThresholdSpec {
  kind: 'auto' | 'none' | 'edit';
  param?: string;
  value?: number;
  steps?: number[];
  fmt?: (v: number) => string;
}

function thresholdSpec(row: any, rules: Record<string, any>, source: Source): ThresholdSpec {
  if (source === 'learned' || row.policy_type === 'allow_grant') return { kind: 'auto' };
  if (row.policy_type === 'risk_threshold' && typeof rules.threshold === 'number')
    return { kind: 'edit', param: 'threshold', value: rules.threshold, steps: RISK_STEPS, fmt: (v) => `≥ ${v}` };
  if (row.policy_type === 'rate_limit' && typeof rules.max_actions === 'number')
    return { kind: 'edit', param: 'max_actions', value: rules.max_actions, steps: RATE_STEPS, fmt: (v) => `${v}/${rules.window_minutes ?? 60}min` };
  if (typeof rules.max_spend_usd === 'number')
    return { kind: 'edit', param: 'max_spend_usd', value: rules.max_spend_usd, steps: SPEND_BLOCK_STEPS, fmt: (v) => `$${v}` };
  if (typeof rules.approval_threshold === 'number')
    return { kind: 'edit', param: 'approval_threshold', value: rules.approval_threshold, steps: SPEND_APPROVE_STEPS, fmt: (v) => `$${v}` };
  return { kind: 'none' };
}

const ThresholdCell: FC<{ item: ClassifiedRow; onChanged: () => void }> = ({ item, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const spec = thresholdSpec(item.row, item.rules, item.source);

  if (spec.kind === 'auto') return <span className={styles.thNone}>auto</span>;
  if (spec.kind === 'none') return <span className={styles.thNone}>&mdash;</span>;

  const opts = [...new Set([...(spec.steps || []), spec.value as number])].sort((a, b) => a - b);
  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = Number(e.target.value);
    setBusy(true);
    setErr(null);
    try {
      await patchRuleParam(item.row.id, item.rules, spec.param!, v);
      onChanged();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <select
        className={styles.thSelect}
        value={spec.value}
        disabled={busy}
        onChange={onChange}
        aria-label={`Edit threshold for ${item.row.name}`}
      >
        {opts.map((v) => (
          <option key={v} value={v}>{spec.fmt!(v)}</option>
        ))}
      </select>
      {err && <span className={styles.rowError} style={{ color: 'var(--color-error)' }}>{err}</span>}
    </>
  );
};

const Bucket: FC<{ bucket: RuleBucket }> = ({ bucket }) => {
  const meta = BUCKET_META[bucket] ?? BUCKET_META.allow;
  return (
    <span className={`${styles.bucket} ${meta.cls}`}>
      <span className={styles.dot} style={{ background: 'currentColor' }} />
      {meta.label}
    </span>
  );
};

const SourceBadge: FC<{ source: Source }> = ({ source }) => {
  const meta = SOURCE_META[source];
  const Icon = meta.Icon;
  return (
    <span className={`${styles.srcBadge} ${meta.cls}`}>
      <Icon size={11} aria-hidden="true" />
      {meta.label}
    </span>
  );
};

/** Sentences-lens row with an inline threshold select (lifted from ContractPanel). */
const SentenceRow: FC<{ sentence: ContractView['interrupts'][number]; onRefetch: () => void; tone?: 'secondary' | 'tertiary' }> = ({ sentence, onRefetch, tone = 'secondary' }) => {
  const [err, setErr] = useState<string | null>(null);
  const editable = sentence.editable;
  const steps = editable?.param === 'max_spend_usd' || editable?.param === 'budget_usd' ? BLOCK_STEPS : APPROVE_STEPS;

  const onChange = async (value: number) => {
    if (!editable || !sentence.rules) return;
    setErr(null);
    try {
      await patchPolicyParam(sentence.policy_id, sentence.rules, editable.param, value);
      onRefetch();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  };

  return (
    <div className={styles.sentence} style={tone === 'tertiary' ? { color: 'var(--color-text-tertiary)' } : undefined}>
      <span className={styles.bull} aria-hidden="true">&mdash;</span>
      <span>
        {sentence.text}
        {editable && (
          <select
            aria-label="Change threshold"
            className={styles.thSelect}
            style={{ marginLeft: 8 }}
            value={editable.value}
            onChange={(e) => onChange(Number(e.target.value))}
          >
            {[...new Set([...steps, editable.value])].sort((a, b) => a - b).map((v) => (
              <option key={v} value={v}>${v}.00</option>
            ))}
          </select>
        )}
        {err && <span style={{ color: 'var(--color-error)', marginLeft: 8, fontSize: 11 }}>{err}</span>}
      </span>
      <span className={styles.fired}>fired {sentence.fired_7d}&times; this wk</span>
    </div>
  );
};

// ------------------------------------------------------------------- main ---

export default function Ledger({
  summary,
  contract,
  highlightPolicy,
  prefill,
  refreshSignal,
  onChanged,
  registerActions,
}: LedgerProps) {
  const [policies, setPolicies] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [lens, setLens] = useState<Lens>('table');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<Set<Source>>(new Set());
  const [bucketFilter, setBucketFilter] = useState<Set<RuleBucket>>(new Set());
  const [status, setStatus] = useState<'' | 'active' | 'paused'>('');

  // Editor modal
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(createDefaultPolicyFormState());
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Sibling panels
  const [showImport, setShowImport] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [showProof, setShowProof] = useState(false);

  // Row actions
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Simulate modal
  const [simulate, setSimulate] = useState<{ open: boolean; name: string; loading: boolean; result: any } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  const refetch = useCallback(async () => {
    try {
      const [pRes, aRes] = await Promise.all([fetch('/api/policies'), fetch('/api/agents')]);
      if (!pRes.ok) throw new Error('policies');
      const pData = await pRes.json();
      setPolicies(pData.policies || []);
      if (aRes.ok) {
        const aData = await aRes.json();
        setAgents(aData.agents || []);
      }
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch, refreshSignal]);

  // After a local CRUD, refresh both the raw rows and the parent's summary/contract.
  const afterChange = useCallback(async () => {
    await refetch();
    onChanged();
  }, [refetch, onChanged]);

  // ---- openers (stable for registerActions) ----
  const openNewRule = useCallback(() => {
    setEditingId(null);
    setForm(createDefaultPolicyFormState());
    setEditorError(null);
    setShowEditor(true);
  }, []);
  const openImport = useCallback(() => setShowImport(true), []);
  const openGenerate = useCallback(() => setShowGenerate(true), []);
  const runTests = useCallback(() => setShowTests(true), []);
  const openProof = useCallback(() => setShowProof(true), []);

  useEffect(() => {
    registerActions?.({ openNewRule, openImport, openGenerate, runTests, openProof });
  }, [registerActions, openNewRule, openImport, openGenerate, runTests, openProof]);

  // Prefill deep-link (?prefill=) — open the editor pre-populated, once.
  useEffect(() => {
    if (!prefill || !prefill.policy_type) return;
    setEditingId(null);
    setForm(decompilePolicyForm({
      name: prefill.name || '',
      policy_type: prefill.policy_type,
      rules: typeof prefill.rules === 'string' ? prefill.rules : JSON.stringify(prefill.rules || {}),
      agent_ids: null,
    }));
    setEditorError(null);
    setShowEditor(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // '/' focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeOwnModals = useCallback(() => {
    setShowEditor(false);
    setSimulate(null);
  }, []);

  // Escape closes the Ledger's own modals (siblings manage their own).
  useEffect(() => {
    if (!showEditor && !simulate?.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOwnModals(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showEditor, simulate, closeOwnModals]);

  // ---- classification + filtering (shared across lenses) ----
  const classified = useMemo(
    () => policies.map((row) => classify(row, summary?.rules)),
    [policies, summary],
  );

  const counts = useMemo(() => {
    const src: Record<Source, number> = { mode: 0, shield: 0, custom: 0, learned: 0 };
    const bkt: Record<RuleBucket, number> = { warn: 0, allow_contained: 0, require_approval: 0, block: 0, allow: 0 };
    let active = 0;
    let paused = 0;
    for (const c of classified) {
      src[c.source]++;
      bkt[c.bucket]++;
      if (c.row.active === 1) active++; else paused++;
    }
    return { src, bkt, active, paused };
  }, [classified]);

  const isHighlighted = useCallback(
    (row: any) => {
      if (!highlightPolicy) return false;
      const h = highlightPolicy.toLowerCase();
      return row.id?.toLowerCase() === h || row.name?.toLowerCase() === h;
    },
    [highlightPolicy],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return classified.filter((c) => {
      if (q) {
        const hay = `${c.row.name ?? ''} ${c.row.policy_type ?? ''} ${typeof c.row.rules === 'string' ? c.row.rules : ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (sourceFilter.size && !sourceFilter.has(c.source)) return false;
      if (bucketFilter.size && !bucketFilter.has(c.bucket)) return false;
      if (status === 'active' && c.row.active !== 1) return false;
      if (status === 'paused' && c.row.active === 1) return false;
      return true;
    });
  }, [classified, search, sourceFilter, bucketFilter, status]);

  const maxFired = useMemo(
    () => filtered.reduce((m, c) => Math.max(m, c.fired30d), 0),
    [filtered],
  );

  // ---- pagination (Table lens): bound the scroll on large rule sets ----
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [search, sourceFilter, bucketFilter, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = useMemo(() => filtered.slice(pageStart, pageStart + PAGE_SIZE), [filtered, pageStart]);

  // Jump to (and scroll to) the page holding a deep-linked row.
  useEffect(() => {
    if (!highlightPolicy || lens !== 'table') return;
    const idx = filtered.findIndex((c) => isHighlighted(c.row));
    if (idx < 0) return;
    const target = Math.floor(idx / PAGE_SIZE);
    if (target !== safePage) {
      setPage(target);
      return;
    }
    const raf = requestAnimationFrame(() =>
      highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
    return () => cancelAnimationFrame(raf);
  }, [highlightPolicy, lens, filtered, isHighlighted, safePage]);

  const filterText = useMemo(() => {
    const parts: string[] = [];
    if (sourceFilter.size) parts.push([...sourceFilter].map((s) => SOURCE_META[s].label).join('/'));
    if (bucketFilter.size) parts.push([...bucketFilter].map((b) => BUCKET_META[b].label).join('/'));
    if (status) parts.push(status === 'active' ? 'Active' : 'Paused');
    if (search.trim()) parts.push(`“${search.trim()}”`);
    return parts.length ? parts.join(' · ') : 'all rules';
  }, [sourceFilter, bucketFilter, status, search]);

  // ---- facet toggles ----
  const toggleSource = (s: Source | 'all') => {
    if (s === 'all') { setSourceFilter(new Set()); return; }
    setSourceFilter((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };
  const toggleBucket = (b: RuleBucket) => {
    setBucketFilter((prev) => {
      const next = new Set(prev);
      next.has(b) ? next.delete(b) : next.add(b);
      return next;
    });
  };
  const toggleStatus = (s: 'active' | 'paused') => setStatus((prev) => (prev === s ? '' : s));

  // ---- row actions ----
  const openEdit = (row: any) => {
    setEditingId(row.id);
    setForm(decompilePolicyForm(row));
    setEditorError(null);
    setShowEditor(true);
  };

  const handleSave = async () => {
    // IMPORTANT 4 (final fix wave, 2026-07-27): client-side check for the
    // containment band's own invariant (Locked Decision 10) — the server
    // validator (app/lib/validate.js) is the backstop of record if this is
    // ever bypassed, but a same-page message beats a round-trip 400.
    if (
      form.type === 'risk_threshold'
      && form.containAbove !== '' && form.containAbove != null
      && !(Number(form.containAbove) >= 0 && Number(form.containAbove) < Number(form.threshold))
    ) {
      setEditorError('Contain-above must be 0 or higher and strictly below the risk threshold.');
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      const payload = compilePolicyPayload(form);
      const isEdit = Boolean(editingId);
      const res = await fetch('/api/policies', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, ...payload } : payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditorError(body.error || 'Failed to save rule');
      } else {
        setShowEditor(false);
        await afterChange();
      }
    } catch {
      setEditorError('Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (row: any) => {
    setTogglingId(row.id);
    try {
      await fetch('/api/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, active: row.active === 1 ? 0 : 1 }),
      });
      await afterChange();
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await fetch(`/api/policies?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await afterChange();
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const handleExport = async (row: any) => {
    const json = JSON.stringify(
      { name: row.name, policy_type: row.policy_type, rules: row.rules, agent_ids: row.agent_ids },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(json);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const handleSimulate = async (row: any) => {
    let rules: any;
    try { rules = JSON.parse(row.rules); } catch { return; }
    setSimulate({ open: true, name: row.name, loading: true, result: null });
    try {
      const res = await fetch('/api/policies/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_type: row.policy_type, rules, days: 7 }),
      });
      const data = await res.json().catch(() => ({}));
      setSimulate((s) => (s ? { ...s, loading: false, result: res.ok ? data : { error: data.error || 'Simulation failed' } } : s));
    } catch {
      setSimulate((s) => (s ? { ...s, loading: false, result: { error: 'Simulation failed' } } : s));
    }
  };

  // Grant remove (Sentences lens): single → id=, several → ids=.
  const handleRemoveGrants = useCallback(
    async (policyIds: string[]) => {
      const query = policyIds.length === 1
        ? `id=${encodeURIComponent(policyIds[0]!)}`
        : `ids=${policyIds.map(encodeURIComponent).join(',')}`;
      const res = await fetch(`/api/policies?${query}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to remove rule${policyIds.length !== 1 ? 's' : ''} (${res.status})`);
      await afterChange();
    },
    [afterChange],
  );

  // ---- renderers ----
  const Facets = (
    <div className={styles.facetRow}>
      <div className={styles.facetGroup}>
        <span className={styles.metaLabel}>Source</span>
        <button className={`${styles.chip} ${sourceFilter.size === 0 ? styles.active : ''}`} onClick={() => toggleSource('all')}>All</button>
        {SOURCE_ORDER.map((s) => (
          <button key={s} className={`${styles.chip} ${sourceFilter.has(s) ? styles.active : ''}`} onClick={() => toggleSource(s)}>
            <span className={styles.cDot} style={{ background: SOURCE_META[s].dot }} />
            {SOURCE_META[s].label} <span className={styles.cCt}>{counts.src[s]}</span>
          </button>
        ))}
      </div>
      <div className={styles.facetSep} />
      <div className={styles.facetGroup}>
        <span className={styles.metaLabel}>Bucket</span>
        {BUCKET_FACETS.map(({ value, dot }) => (
          <button key={value} className={`${styles.chip} ${bucketFilter.has(value) ? styles.active : ''}`} onClick={() => toggleBucket(value)}>
            <span className={styles.cDot} style={{ background: dot }} />
            {BUCKET_META[value].label} <span className={styles.cCt}>{counts.bkt[value]}</span>
          </button>
        ))}
      </div>
      <div className={styles.facetSep} />
      <div className={styles.facetGroup}>
        <span className={styles.metaLabel}>Status</span>
        <button className={`${styles.chip} ${status === 'active' ? styles.active : ''}`} onClick={() => toggleStatus('active')}>Active <span className={styles.cCt}>{counts.active}</span></button>
        <button className={`${styles.chip} ${status === 'paused' ? styles.active : ''}`} onClick={() => toggleStatus('paused')}>Paused <span className={styles.cCt}>{counts.paused}</span></button>
      </div>
    </div>
  );

  const TableLens = (
    <div className={styles.tblScroll}>
      <table>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Source</th>
            <th scope="col">Bucket</th>
            <th scope="col">Threshold</th>
            <th scope="col" className="num">Fired &middot; 30d</th>
            <th scope="col" className="num">Status</th>
            <th scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((c) => {
            const row = c.row;
            const hi = isHighlighted(row);
            const isLearned = c.source === 'learned';
            const isActive = row.active === 1;
            return (
              <tr
                key={row.id}
                ref={hi ? highlightRef : undefined}
                className={hi ? styles.highlight : undefined}
                data-entity-type="policy"
                data-entity-id={row.id}
                data-entity-status={isActive ? 'active' : 'inactive'}
              >
                <td>
                  <div className={styles.ruleCell}>
                    <span className={styles.ruleName}>
                      {row.name}
                      {hi && <span className={styles.deepTag}>?policy={row.id}</span>}
                      {c.retired && <span className={styles.retiredTag}>retired</span>}
                    </span>
                    <span className={styles.ruleEn}>{describeRule(row, c.rules)}</span>
                  </div>
                </td>
                <td><SourceBadge source={c.source} /></td>
                <td>
                  <Bucket bucket={c.bucket} />
                  {/* IMPORTANT 4 (final fix wave, 2026-07-27): a risk_threshold
                      policy carrying a containment band still bucket
                      as its real primary action (require_approval) — this
                      never lies about that — but the operator can't see the
                      band exists anywhere else in this ledger, so surface it
                      as a second, smaller chip alongside. */}
                  {typeof c.rules.contain_above === 'number' && (
                    <span
                      className={`${styles.bucket} ${styles.bkContained}`}
                      title={`Contains below risk ${c.rules.contain_above}`}
                    >
                      <span className={styles.dot} style={{ background: 'currentColor' }} />
                      Contain
                    </span>
                  )}
                </td>
                <td><ThresholdCell item={c} onChanged={afterChange} /></td>
                <td className="num"><FiredCell fired={c.fired30d} maxFired={maxFired} lastFiredAt={c.lastFiredAt} /></td>
                <td className="num">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    aria-label={isActive ? `Pause ${row.name}` : `Activate ${row.name}`}
                    disabled={togglingId === row.id}
                    onClick={() => handleToggleActive(row)}
                    className={`${styles.miniToggle} ${isActive ? '' : styles.off}`}
                  />
                </td>
                <td>
                  <div className={styles.rowActions}>
                    {!isLearned && (
                      <>
                        <button className={`${styles.btn} ${styles.btnIcon}`} title="Simulate" aria-label={`Simulate ${row.name}`} onClick={() => handleSimulate(row)}>
                          <Play size={13} aria-hidden="true" />
                        </button>
                        <button className={`${styles.btn} ${styles.btnIcon}`} title="Edit" aria-label={`Edit ${row.name}`} onClick={() => openEdit(row)}>
                          <Pencil size={13} aria-hidden="true" />
                        </button>
                      </>
                    )}
                    <button className={`${styles.btn} ${styles.btnIcon}`} title="Export JSON" aria-label={`Export ${row.name} as JSON`} onClick={() => handleExport(row)}>
                      {copiedId === row.id ? <Check size={13} aria-hidden="true" style={{ color: 'var(--color-success)' }} /> : <Download size={13} aria-hidden="true" />}
                    </button>
                    {confirmDeleteId === row.id ? (
                      <span className={styles.tnum} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <button className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`} disabled={deleting} onClick={() => handleDelete(row.id)}>{deleting ? '…' : 'Yes'}</button>
                        <button className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => setConfirmDeleteId(null)}>No</button>
                      </span>
                    ) : (
                      <button className={`${styles.btn} ${styles.btnIcon} ${styles.btnDanger}`} title={isLearned ? 'Remove suppression' : 'Delete'} aria-label={`Delete ${row.name}`} onClick={() => setConfirmDeleteId(row.id)}>
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const grantGroups: SuppressedGroup[] = useMemo(
    () => (contract ? groupGrants(contract.grants) : []),
    [contract],
  );

  const SentencesLens = contract && (
    <div className={styles.contract}>
      {contract.interrupts.length > 0 && (
        <div className={styles.cgroup}>
          <div className={styles.cgroupHead}>
            <span className={`${styles.gi} ${styles.giInt}`}><AlignLeft size={14} aria-hidden="true" /></span>
            <h3>Interrupt me only when&hellip;</h3>
            <span className={styles.tagline}>Stop and wait for your one-click approval.</span>
          </div>
          {contract.interrupts.map((s) => (
            <SentenceRow key={`int-${s.policy_id}-${s.editable?.param ?? ''}`} sentence={s} onRefetch={afterChange} />
          ))}
        </div>
      )}
      {contract.blocks.length > 0 && (
        <div className={styles.cgroup}>
          <div className={styles.cgroupHead}>
            <span className={`${styles.gi} ${styles.giBlock}`}><X size={14} aria-hidden="true" /></span>
            <h3>Hard stops: never allowed</h3>
            <span className={styles.tagline}>Blocked outright, no matter who asks.</span>
          </div>
          {contract.blocks.map((s) => (
            <SentenceRow key={`blk-${s.policy_id}-${s.editable?.param ?? ''}`} sentence={s} onRefetch={afterChange} />
          ))}
        </div>
      )}
      {contract.silent.length > 0 && (
        <div className={styles.cgroup}>
          <div className={styles.cgroupHead}>
            <span className={`${styles.gi} ${styles.giSilent}`}><FileText size={14} aria-hidden="true" /></span>
            <h3>Recorded silently: logged, not gated</h3>
            <span className={styles.tagline}>Written to the ledger, never interrupts you.</span>
          </div>
          {contract.silent.map((s) => (
            <SentenceRow key={`sil-${s.policy_id}`} sentence={s} onRefetch={afterChange} tone="tertiary" />
          ))}
        </div>
      )}
      {contract.grants.length > 0 && (
        <div className={styles.cgroup}>
          <div className={styles.cgroupHead}>
            <span className={`${styles.gi} ${styles.giGrant}`}><Check size={14} aria-hidden="true" /></span>
            <h3>Never bother me about&hellip;</h3>
            <span className={styles.tagline}>Learned suppressions, removable, never edited.</span>
          </div>
          {grantGroups.map((group) => (
            <div key={group.type}>
              {group.rows.map((r) => {
                const t = formatTarget(r.target);
                return (
                  <div key={r.shape_key} className={styles.sentence}>
                    <span className={styles.bull} aria-hidden="true">&mdash;</span>
                    <span>
                      <Code>{r.actionType}</Code>{r.target ? <> &middot; <b>{t.display}</b></> : null}
                      {r.policy_ids.length > 1 && <span className={styles.fired}>&times;{r.policy_ids.length}</span>}
                    </span>
                    <button
                      className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost} ${styles.btnDanger} rm`}
                      style={{ marginLeft: 'auto' }}
                      onClick={() => handleRemoveGrants(r.policy_ids)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {group.rows.length > 1 && (
                <div className={styles.sentence}>
                  <span className={styles.bull} aria-hidden="true">&nbsp;</span>
                  <button
                    className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost} ${styles.btnDanger}`}
                    style={{ marginLeft: 'auto' }}
                    onClick={() => handleRemoveGrants(group.policy_ids)}
                  >
                    Clear {group.type} group
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {contract.custom.length > 0 && (
        <div className={styles.cgroup}>
          <div className={styles.cgroupHead}>
            <span className={`${styles.gi} ${styles.giCustom}`}><Star size={14} aria-hidden="true" /></span>
            <h3>Your custom rules</h3>
          </div>
          {contract.custom.map((c) => {
            const hi = highlightPolicy && (c.policy_id === highlightPolicy || c.name.toLowerCase() === highlightPolicy.toLowerCase());
            return (
              <div key={c.policy_id} className={styles.sentence} style={hi ? { boxShadow: 'inset 3px 0 0 var(--color-brand)' } : undefined}>
                <span className={styles.bull} aria-hidden="true">&mdash;</span>
                <span><b>{c.name}</b></span>
                <span className={styles.fired}>{c.policy_type}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const GroupsLens = (
    <div className={styles.grp}>
      {SOURCE_ORDER.map((s) => {
        const rows = filtered.filter((c) => c.source === s);
        if (rows.length === 0) return null;
        return (
          <div key={s} className={styles.grpBlock}>
            <div className={styles.gh}>
              <SourceBadge source={s} />
              <span className={styles.secHelp}>{rows.length} rule{rows.length === 1 ? '' : 's'} {SOURCE_META[s].help}</span>
            </div>
            <div className={styles.grpRows}>
              {rows.map((c) => (
                <button
                  key={c.row.id}
                  type="button"
                  className={styles.grpRule}
                  onClick={() => { setLens('table'); setSourceFilter(new Set([s])); }}
                >
                  <span className={`${styles.bucket} ${BUCKET_META[c.bucket]?.cls ?? ''}`}>
                    <span className={styles.dot} style={{ background: 'currentColor' }} />
                  </span>
                  <span className={styles.gn}>{c.row.name}</span>
                  <span className={styles.gm}>{c.fired30d}&times;</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ---- shell ----
  return (
    <div className={styles.ledgerWrap}>
      {/* Toolbar */}
      <div className={styles.ledgerToolbar}>
        <div className={styles.lensSwitch} role="tablist" aria-label="Ledger lens">
          <button role="tab" aria-selected={lens === 'table'} className={lens === 'table' ? styles.active : ''} onClick={() => setLens('table')}>
            <Table size={13} aria-hidden="true" />Table
          </button>
          <button role="tab" aria-selected={lens === 'sentences'} className={lens === 'sentences' ? styles.active : ''} onClick={() => setLens('sentences')}>
            <AlignLeft size={13} aria-hidden="true" />Sentences
          </button>
          <button role="tab" aria-selected={lens === 'groups'} className={lens === 'groups' ? styles.active : ''} onClick={() => setLens('groups')}>
            <LayoutGrid size={13} aria-hidden="true" />Groups
          </button>
        </div>
        <div className={styles.search}>
          <Search size={14} className={styles.sico} aria-hidden="true" />
          <label htmlFor="ledger-search" className="sr-only">Search rules</label>
          <input
            id="ledger-search"
            ref={searchRef}
            type="text"
            placeholder="Search rules, action types, paths&hellip;"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>/</kbd>
        </div>
        <button className={`${styles.btn} ${styles.btnSm}`} onClick={openImport}>
          <Upload size={13} aria-hidden="true" />Import
        </button>
        <button className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} onClick={openNewRule}>
          <Plus size={13} aria-hidden="true" />New rule
        </button>
      </div>

      {Facets}

      {/* Lens views */}
      {loading ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}
        </div>
      ) : error ? (
        <div className={styles.emptyNote}>
          Couldn&apos;t load rules.{' '}
          <button className={styles.btn} style={{ marginLeft: 8 }} onClick={refetch}>Retry</button>
        </div>
      ) : policies.length === 0 ? (
        <div className={styles.emptyState}>
          <EmptyState
            icon={FileText}
            title="No rules yet"
            description="Apply a mode or create your first rule to start governing."
            action={<button className={`${styles.btn} ${styles.btnPrimary}`} onClick={openNewRule}><Plus size={13} aria-hidden="true" />New rule</button>}
          />
        </div>
      ) : lens === 'table' ? (
        filtered.length === 0
          ? <div className={styles.emptyNote}>No rules match the current filters.</div>
          : TableLens
      ) : lens === 'sentences' ? (
        (contract && contract.governed) ? SentencesLens : <div className={styles.emptyNote}>No contract to show yet.</div>
      ) : (
        filtered.length === 0
          ? <div className={styles.emptyNote}>No rules match the current filters.</div>
          : GroupsLens
      )}

      {/* Footer */}
      <div className={styles.footerActions}>
        <span className="left">
          {lens === 'sentences' ? (
            'Plain-English view of the same rules.'
          ) : lens === 'groups' ? (
            <><b>{filtered.length}</b> of <b>{policies.length}</b> rules, grouped by source</>
          ) : filtered.length === 0 ? (
            <>No rules match &middot; <b>{filterText}</b></>
          ) : (
            <>Showing <b>{pageStart + 1}&ndash;{Math.min(pageStart + PAGE_SIZE, filtered.length)}</b> of <b>{filtered.length}</b> rules &middot; <b>{filterText}</b></>
          )}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lens === 'table' && pageCount > 1 && (
            <div className={styles.pager}>
              <button
                className={`${styles.btn} ${styles.btnSm} ${styles.btnIcon}`}
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              <span className={styles.pagerLabel}>Page {safePage + 1} / {pageCount}</span>
              <button
                className={`${styles.btn} ${styles.btnSm} ${styles.btnIcon}`}
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(safePage + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          <button className={`${styles.btn} ${styles.btnSm}`} onClick={runTests}>
            <FlaskConical size={13} aria-hidden="true" />Run guardrail tests
          </button>
          <button className={`${styles.btn} ${styles.btnSm}`} onClick={openProof}>
            <FileText size={13} aria-hidden="true" />Export proof
          </button>
        </div>
      </div>

      {/* ---- Rule editor modal ---- */}
      {showEditor && (
        <div className={styles.modalBackdrop} onClick={() => setShowEditor(false)} role="presentation">
          <div className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-label={editingId ? 'Edit rule' : 'New rule'} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3>{editingId ? 'Edit rule' : 'New rule'}</h3>
              <button className={`${styles.btn} ${styles.btnIcon} ${styles.btnGhost}`} aria-label="Close" onClick={() => setShowEditor(false)}><X size={16} aria-hidden="true" /></button>
            </div>
            <div className={styles.modalBody}>
              <PolicyAuthoringPanel
                form={form}
                policyTypes={POLICY_TYPE_OPTIONS as any}
                actionOptions={ACTION_OPTIONS}
                agents={agents}
                summary={buildPolicySummary(form)}
                onChange={setForm}
                typeLocked={Boolean(editingId)}
              />
              {editorError && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10 }}>{editorError}</div>}
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setShowEditor(false)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving || !form.name?.trim()} onClick={handleSave}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Simulate result modal ---- */}
      {simulate?.open && (
        <div className={styles.modalBackdrop} onClick={() => setSimulate(null)} role="presentation">
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Simulation impact" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h3>Simulation impact (7 days){simulate.name ? `: ${simulate.name}` : ''}</h3>
              <button className={`${styles.btn} ${styles.btnIcon} ${styles.btnGhost}`} aria-label="Close" onClick={() => setSimulate(null)}><X size={16} aria-hidden="true" /></button>
            </div>
            <div className={styles.modalBody}>
              {simulate.loading && <p className={styles.secHelp}>Replaying recent actions&hellip;</p>}
              {simulate.result?.error && <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{simulate.result.error}</div>}
              {simulate.result && !simulate.result.error && (
                <>
                  <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {simulate.result.summary?.total ?? 0} actions &middot;{' '}
                    <b>{simulate.result.summary?.matches ?? 0}</b> would match &middot;{' '}
                    {simulate.result.summary?.block ?? 0} block / {simulate.result.summary?.warn ?? 0} warn / {simulate.result.summary?.require_approval ?? 0} approval
                  </p>
                  {(simulate.result.matches?.length ?? 0) === 0 ? (
                    <p className={styles.secHelp} style={{ marginTop: 10 }}>{simulate.result.message || 'No recent actions would be affected.'}</p>
                  ) : (
                    <ul style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {simulate.result.matches.slice(0, 6).map((m: any) => (
                        <li key={m.action_id} style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          <b>{m.simulated_action}</b> &middot; {m.goal || m.action_id}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Sibling panels (own their rendering) ---- */}
      <ImportPanel open={showImport} onClose={() => setShowImport(false)} onImported={afterChange} />
      <GeneratePanel open={showGenerate} onClose={() => setShowGenerate(false)} onCreated={afterChange} agents={agents} />
      <TestPanel open={showTests} onClose={() => setShowTests(false)} />
      <ProofExportPanel open={showProof} onClose={() => setShowProof(false)} />
    </div>
  );
}
