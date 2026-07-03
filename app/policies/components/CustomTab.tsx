'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Upload, Sparkles, Trash2, Play, Copy, Check, Pencil,
  ToggleLeft, ToggleRight, X, FlaskConical, ShieldCheck,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import PolicyAuthoringPanel from './PolicyAuthoringPanel';
import PolicyAdvancedImportPanel from './PolicyAdvancedImportPanel';
import ProofExportPanel from './ProofExportPanel';
import {
  createDefaultPolicyFormState,
  compilePolicyPayload,
  decompilePolicyForm,
  buildPolicySummary,
  POLICY_TYPE_OPTIONS as POLICY_TYPES,
} from '../lib/policyFormModel';
import PolicyGeneratedDraftEditor from './PolicyGeneratedDraftEditor';
import { normalizeGeneratedPolicyDrafts } from '../lib/policyGeneratorDrafts.js';
import { PACK_PREVIEWS } from '../../lib/policyPackPreviews';

const ACTION_OPTIONS = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other',
];

function formatRules(policy: any): string {
  const type = policy.policy_type;
  let rules: any;
  try { rules = JSON.parse(policy.rules || '{}'); } catch { return type; }
  switch (type) {
    case 'risk_threshold': return `Risk >= ${rules.threshold} → ${rules.action || 'block'}`;
    case 'require_approval': return `${(rules.action_types || []).join(', ')} → require approval`;
    case 'block_action_type': return `${(rules.action_types || []).join(', ')} → block`;
    case 'rate_limit': return `Max ${rules.max_actions} / ${rules.window_minutes ?? 60}min → ${rules.action || 'warn'}`; // 60 = the guard's default window (guard.ts)
    case 'webhook_check': { try { return `Webhook → ${new URL(rules.url).hostname}`; } catch { return 'Webhook'; } }
    case 'semantic_check': return `Semantic: "${(rules.instruction || '').slice(0, 50)}..."`;
    case 'non_fabrication': return `Non-fabrication → ${rules.on_violation || 'block'}`;
    case 'behavioral_anomaly': return `Anomaly < ${Math.round((rules.similarity_threshold ?? 0.75) * 100)}% similar → ${rules.action || 'require_approval'}`;
    case 'permission_escalation': return rules.enforce ? `Permission escalation → ${rules.action || 'block'}` : 'Permission escalation (disabled)';
    case 'green_contract': return `${(rules.action_types || []).join(', ')} need ${rules.required_level || 'workspace'} green → ${rules.action || 'block'}`;
    case 'branch_freshness': return `${(rules.action_types || []).join(', ')} when ${(rules.freshness || ['stale', 'diverged']).join('/')} → ${rules.action || 'block'}`;
    case 'x402_spend_limit': {
      const parts: string[] = [];
      if (rules.max_spend_usd != null) parts.push(`purchase > $${rules.max_spend_usd} → block`);
      if (rules.approval_threshold != null) parts.push(`purchase >= $${rules.approval_threshold} → approval`);
      const win = `${rules.budget_window_days ?? 30}d ${rules.budget_scope === 'agent' ? 'per-agent' : 'org'} spend`;
      if (rules.budget_usd != null) parts.push(`${win} > $${rules.budget_usd} → block`);
      if (rules.budget_approval_threshold != null) parts.push(`${win} >= $${rules.budget_approval_threshold} → approval`);
      return parts.length ? parts.join(' · ') : 'x402 spend governance';
    }
    default: return type;
  }
}

function parseAgentIds(policy: any): string[] {
  if (!policy.agent_ids) return [];
  try { const p = JSON.parse(policy.agent_ids); return Array.isArray(p) ? p : []; } catch { return []; }
}

/**
 * Live consumption suffix for budget-bearing x402 policies (roadmap v2.6c),
 * from GET /api/x402/budget. Tone mirrors the gate's tiers: error at/over the
 * hard budget, warning at/over the approval threshold (or 80% of the hard
 * budget when no approval tier).
 */
function budgetConsumption(entry: any): { text: string; tone: string } | null {
  const budget = entry.budget_usd;
  const approval = entry.budget_approval_threshold;
  const cap = budget ?? approval;
  if (cap == null) return null;
  const label = (spend: number) => `$${Number(spend).toFixed(2)} of $${Number(cap).toFixed(2)} used`;
  const toneFor = (spend: number) =>
    budget != null && spend >= budget ? 'text-error'
    : (approval != null ? spend >= approval : spend >= 0.8 * budget) ? 'text-warning'
    : 'text-tertiary';
  if (entry.budget_scope === 'agent') {
    const top = (entry.families || [])[0]; // API orders families by spend DESC
    if (!top) return { text: 'no attributed spend this window', tone: 'text-tertiary' };
    return { text: `top ${top.agent_id}: ${label(top.window_spend_usd)}`, tone: toneFor(top.window_spend_usd) };
  }
  const spend = entry.window_spend_usd ?? 0;
  return { text: label(spend), tone: toneFor(spend) };
}

export default function CustomTab() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  // Live budget consumption keyed by policy_id (only budget-bearing x402 policies appear).
  const [budgetByPolicy, setBudgetByPolicy] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterActive, setFilterActive] = useState('');

  // Authoring form state
  const [showAuthoring, setShowAuthoring] = useState(false);
  const [authoringForm, setAuthoringForm] = useState<any>(createDefaultPolicyFormState());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [authoringError, setAuthoringError] = useState<string | null>(null);

  // Import panel state
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState('pack');
  const [importPack, setImportPack] = useState('enterprise-strict');
  const [importYaml, setImportYaml] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);

  // Simulation panel state (A3: replaces the old alert()-based result)
  const [showSimulate, setShowSimulate] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [simulateResult, setSimulateResult] = useState<any>(null);
  const [simulatePolicyName, setSimulatePolicyName] = useState('');

  // Proof report + test runner state
  const [showProof, setShowProof] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);

  // AI Generator state
  const [showGenerator, setShowGenerator] = useState(false);
  const [genInput, setGenInput] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);
  const [genDrafts, setGenDrafts] = useState<any[]>([]);
  const [genDraftForm, setGenDraftForm] = useState<any>(null);
  const [genAssumptions, setGenAssumptions] = useState<string[]>([]);
  const [genClarifications, setGenClarifications] = useState<any[]>([]);
  const [genAnswers, setGenAnswers] = useState<Record<string, string | string[]>>({}); // { [id]: string|string[] }
  const [genWarnings, setGenWarnings] = useState<string[]>([]);

  // Row actions
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    try {
      const [policiesRes, agentsRes, budgetRes] = await Promise.all([
        fetch('/api/policies'),
        fetch('/api/agents'),
        fetch('/api/x402/budget'),
      ]);
      if (policiesRes.ok) {
        const data = await policiesRes.json();
        setPolicies(data.policies || []);
      }
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(data.agents || []);
      }
      if (budgetRes.ok) {
        const data = await budgetRes.json();
        const byPolicy: Record<string, any> = {};
        for (const entry of data.budgets || []) byPolicy[entry.policy_id] = entry;
        setBudgetByPolicy(byPolicy);
      }
    } catch (err) {
      console.error('Failed to fetch policies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  useEffect(() => {
    fetch('/api/policies/templates')
      .then(r => (r.ok ? r.json() : { templates: [] }))
      .then(d => setTemplates(d.templates || []))
      .catch(() => { /* fall back to static previews */ });
  }, []);

  // A6: open the authoring form prefilled from a compliance-gap deep-link
  // (/policies?prefill=<encoded { name, policy_type, rules }>).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = new URLSearchParams(window.location.search).get('prefill');
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (draft && draft.policy_type) {
        setEditingId(null);
        setAuthoringForm(decompilePolicyForm({
          name: draft.name || '',
          policy_type: draft.policy_type,
          rules: typeof draft.rules === 'string' ? draft.rules : JSON.stringify(draft.rules || {}),
          agent_ids: null,
        }));
        setShowAuthoring(true);
      }
    } catch { /* ignore malformed prefill */ }
  }, []);

  const filtered = policies.filter(p => {
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType && p.policy_type !== filterType) return false;
    if (filterActive === 'active' && p.active !== 1) return false;
    if (filterActive === 'inactive' && p.active !== 0) return false;
    return true;
  });

  // Authoring actions
  const openCreate = () => {
    setEditingId(null);
    setAuthoringForm(createDefaultPolicyFormState());
    setAuthoringError(null);
    setShowAuthoring(true);
    setShowImport(false);
  };

  const openEdit = (policy: any) => {
    setEditingId(policy.id);
    setAuthoringForm(decompilePolicyForm(policy));
    setAuthoringError(null);
    setShowAuthoring(true);
    setShowImport(false);
  };

  const closeAuthoring = () => {
    setShowAuthoring(false);
    setEditingId(null);
    setAuthoringForm(createDefaultPolicyFormState());
    setAuthoringError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setAuthoringError(null);
    try {
      const payload = compilePolicyPayload(authoringForm);
      const isEdit = Boolean(editingId);
      const res = await fetch('/api/policies', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, ...payload } : payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthoringError(json.error || 'Failed to save policy');
      } else {
        closeAuthoring();
        await fetchPolicies();
      }
    } catch {
      setAuthoringError('Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  // Import actions
  const openImport = () => {
    setImportResult(null);
    setImportPreview(null);
    setShowImport(true);
    setShowAuthoring(false);
  };

  const closeImport = () => {
    setShowImport(false);
    setImportResult(null);
    setImportPreview(null);
  };

  // Changing the pack, mode, or YAML invalidates any preview so the operator
  // always confirms against the exact policies they are about to import.
  const selectImportPack = (pack: string) => { setImportPack(pack); setImportPreview(null); setImportResult(null); };
  const selectImportMode = (mode: string) => { setImportMode(mode); setImportPreview(null); setImportResult(null); };
  const selectImportYaml = (yaml: string) => { setImportYaml(yaml); setImportPreview(null); };

  const importBody = () => (importMode === 'pack' ? { pack: importPack } : { yaml: importYaml });

  // A2: preview-before-import. Calls the existing conflict-aware dry run
  // (POST /api/policies/import?preview=true) and shows what would be created
  // and which names conflict before anything is written.
  const handlePreview = async () => {
    setPreviewing(true);
    setImportPreview(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/policies/import?preview=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importBody()),
      });
      const json = await res.json();
      setImportPreview(res.ok ? json : { error: json.error || 'Preview failed' });
    } catch {
      setImportPreview({ error: 'Preview failed' });
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/policies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importBody()),
      });
      const json = await res.json();
      if (res.ok) {
        setImportResult(json);
        setImportPreview(null);
        await fetchPolicies();
      } else {
        setImportResult({ error: json.error || 'Import failed' });
      }
    } catch {
      setImportResult({ error: 'Import failed' });
    } finally {
      setImporting(false);
    }
  };

  // Row actions
  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await fetch(`/api/policies?id=${id}`, { method: 'DELETE' });
      await fetchPolicies();
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const handleToggleActive = async (policy: any) => {
    await fetch('/api/policies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: policy.id, active: policy.active === 1 ? 0 : 1 }),
    });
    await fetchPolicies();
  };

  const handleExport = async (policy: any) => {
    const json = JSON.stringify(
      { name: policy.name, policy_type: policy.policy_type, rules: policy.rules, agent_ids: policy.agent_ids },
      null,
      2,
    );
    await navigator.clipboard.writeText(json);
    setCopiedId(policy.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSimulate = async (policy: any) => {
    let rules: any;
    try { rules = JSON.parse(policy.rules); } catch { return; }
    setShowSimulate(true);
    setShowTests(false);
    setSimulating(true);
    setSimulateResult(null);
    setSimulatePolicyName(policy.name);
    try {
      const res = await fetch('/api/policies/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_type: policy.policy_type, rules, days: 7 }),
      });
      const data = await res.json();
      setSimulateResult(res.ok ? data : { error: data.error || 'Simulation failed' });
    } catch {
      setSimulateResult({ error: 'Simulation failed' });
    } finally {
      setSimulating(false);
    }
  };

  const runGenerator = async (answers: Record<string, string | string[]>) => {
    setGenLoading(true);
    setGenError(null);
    setGenSuccess(null);
    try {
      const answerList = Object.entries(answers || {}).map(([id, value]) => ({ id, value }));
      const res = await fetch('/api/policies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_text: genInput, answers: answerList, dry_run: true }),
      });
      const data = await res.json();
      if (!res.ok) { setGenError(data.error || 'Failed to generate policy drafts'); return; }
      const drafts = normalizeGeneratedPolicyDrafts(data.drafts || []);
      const clarifications = data.clarifications || [];
      const warnings = [...(data.warnings || [])];
      // The generator is asked to return a single best draft for compound
      // requests (and clarify the rest). If it returns more anyway, surface it
      // instead of silently dropping drafts 2..N — the editor only shows the first.
      if (drafts.length > 1) {
        warnings.push(`Generated ${drafts.length} policies from one request — showing the first ("${drafts[0]?.name || 'draft'}"). Save it, then refine to author the others one at a time.`);
      }
      setGenDrafts(drafts);
      setGenAssumptions(data.assumptions || []);
      setGenClarifications(clarifications);
      setGenWarnings(warnings);
      setGenDraftForm(drafts.length ? JSON.parse(JSON.stringify(drafts[0]?.formState)) : null);
      if (!drafts.length && !clarifications.length) {
        setGenError("DashClaw couldn't draft a policy or a follow-up. Try describing the action, risk, or paths to protect.");
      }
    } catch (err: any) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleGenerate = () => runGenerator({});
  const handleRefine = () => runGenerator(genAnswers);

  const toggleAnswer = (id: string, value: string, multi: boolean) => {
    setGenAnswers((prev) => {
      if (!multi) return { ...prev, [id]: value };
      const cur = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      return { ...prev, [id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  };

  const handleCreateDraft = async () => {
    if (!genDraftForm) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const payload = compilePolicyPayload(genDraftForm);
      const res = await fetch('/api/policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setGenError(data.error || 'Failed to create policy'); return; }
      setGenSuccess(`Created policy "${payload.name}".`);
      setGenInput(''); setGenDrafts([]); setGenDraftForm(null); setGenAssumptions([]); setGenClarifications([]); setGenAnswers({}); setGenWarnings([]);
      fetchPolicies();
    } catch (err: any) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleRunTests = async () => {
    setShowTests(true);
    setTestRunning(true);
    setTestResults(null);
    setShowProof(false);
    try {
      const res = await fetch('/api/policies/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setTestResults(res.ok ? data.results : { error: data.error || 'Failed to run tests' });
    } catch {
      setTestResults({ error: 'Failed to run tests' });
    } finally {
      setTestRunning(false);
    }
  };

  const openProof = () => {
    setShowProof(true);
    setShowTests(false);
    setShowGenerator(false);
    setShowAuthoring(false);
  };

  const summary = buildPolicySummary(authoringForm);
  const isFormInvalid = !authoringForm.name?.trim();

  return (
    <div className="space-y-4">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
        >
          <Plus size={12} aria-hidden="true" /> New policy
        </button>
        <button
          onClick={openImport}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
        >
          <Upload size={12} aria-hidden="true" /> Import
        </button>
        <button
          onClick={() => { setShowGenerator(!showGenerator); setShowAuthoring(false); setShowImport(false); }}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
        >
          <Sparkles size={12} aria-hidden="true" /> AI generator
        </button>
        <button
          onClick={handleRunTests}
          disabled={testRunning}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
        >
          <FlaskConical size={12} aria-hidden="true" /> {testRunning ? 'Running…' : 'Run tests'}
        </button>
        <button
          onClick={openProof}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
        >
          <ShieldCheck size={12} aria-hidden="true" /> Export proof
        </button>
      </div>

      {/* Proof report panel */}
      <ProofExportPanel open={showProof} onClose={() => setShowProof(false)} />

      {/* Test runner results */}
      {showTests && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-brand" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">Guardrail test results</span>
            </div>
            <button
              onClick={() => setShowTests(false)}
              className="text-tertiary transition-colors hover:text-white"
              aria-label="Close test results"
            >
              <X size={16} />
            </button>
          </div>
          {testRunning && <p className="text-xs text-secondary">Running policy tests…</p>}
          {testResults?.error && (
            <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{testResults.error}</div>
          )}
          {testResults && !testResults.error && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant={testResults.success ? 'success' : 'error'} size="xs">
                  {`${testResults.passed}/${testResults.total_tests} passed`}
                </Badge>
                <span className="text-xs text-tertiary">{testResults.total_policies} policies</span>
              </div>
              {testResults.total_tests === 0 ? (
                <p className="text-xs text-tertiary">No active policies to test.</p>
              ) : (
                <div className="space-y-2">
                  {testResults.details.map((d: any) => (
                    <div key={d.policy_id} className="rounded-lg border border-border bg-surface-tertiary p-3">
                      <div className="text-xs font-medium text-white">{d.policy_name}</div>
                      <div className="mt-1.5 space-y-1">
                        {d.tests.map((t: any, i: number) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            {t.passed
                              ? <Check size={11} className="text-success" aria-hidden="true" />
                              : <X size={11} className="text-error" aria-hidden="true" />}
                            <span className="text-secondary">{t.name}</span>
                            {!t.passed && t.reason && <span className="text-tertiary">— {t.reason}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Simulation impact panel (A3: in-page result, replaces alert) */}
      {showSimulate && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-5" data-testid="simulate-panel">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Play size={14} className="text-brand" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">
                Simulation impact (7 days){simulatePolicyName ? ` — ${simulatePolicyName}` : ''}
              </span>
            </div>
            <button
              onClick={() => setShowSimulate(false)}
              className="text-tertiary transition-colors hover:text-white"
              aria-label="Close simulation results"
            >
              <X size={16} />
            </button>
          </div>
          {simulating && <p className="text-xs text-secondary">Replaying recent actions…</p>}
          {simulateResult?.error && (
            <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{simulateResult.error}</div>
          )}
          {simulateResult && !simulateResult.error && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="xs">{`${simulateResult.summary?.total ?? 0} actions`}</Badge>
                <Badge variant={(simulateResult.summary?.matches ?? 0) > 0 ? 'warning' : 'success'} size="xs">
                  {`${simulateResult.summary?.matches ?? 0} would match`}
                </Badge>
                <span className="text-xs text-tertiary">
                  {simulateResult.summary?.block ?? 0} block · {simulateResult.summary?.warn ?? 0} warn · {simulateResult.summary?.require_approval ?? 0} approval
                </span>
              </div>
              {(simulateResult.matches?.length ?? 0) === 0 ? (
                <p className="text-xs text-tertiary">{simulateResult.message || 'No recent actions would be affected by this policy.'}</p>
              ) : (
                <div className="space-y-2">
                  {simulateResult.matches.slice(0, 5).map((m: any) => (
                    <div key={m.action_id} className="rounded-lg border border-border bg-surface-tertiary p-3">
                      <div className="flex items-center gap-2 text-[11px]">
                        <Badge variant={m.simulated_action === 'block' ? 'error' : m.simulated_action === 'warn' ? 'warning' : 'info'} size="xs">
                          {m.simulated_action}
                        </Badge>
                        <span className="truncate text-secondary">{m.goal || m.action_id}</span>
                      </div>
                      {m.simulated_reason && <div className="mt-1 text-[11px] text-tertiary">{m.simulated_reason}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* AI Generator panel */}
      {showGenerator && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-secondary p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-brand" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">AI policy generator</span>
            </div>
            <button
              onClick={() => { setShowGenerator(false); setGenError(null); setGenSuccess(null); setGenDrafts([]); setGenDraftForm(null); setGenAssumptions([]); setGenClarifications([]); setGenAnswers({}); setGenWarnings([]); }}
              className="text-tertiary transition-colors hover:text-white"
              aria-label="Close AI generator"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-secondary">Describe what you want DashClaw to prevent or enforce in plain English. DashClaw drafts a policy and asks follow-ups to pin it down — it never just says no.</p>
          {genSuccess && <div className="rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-xs text-success">{genSuccess}</div>}
          {genError && <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{genError}</div>}
          <textarea
            value={genInput}
            onChange={(e) => setGenInput(e.target.value)}
            placeholder="e.g. Stop my agents from deleting things I care about"
            rows={3}
            maxLength={5000}
            className="w-full resize-none rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-xs text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] tabular-nums text-tertiary">{genInput.length}/5000</span>
            <button onClick={handleGenerate} disabled={genLoading || !genInput.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
              <Sparkles size={12} aria-hidden="true" /> {genLoading ? 'Working…' : (genDrafts.length || genClarifications.length ? 'Regenerate' : 'Generate')}
            </button>
          </div>

          {genAssumptions.length > 0 && (
            <div className="rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-[11px] text-tertiary">
              <span className="font-medium text-secondary">Assumptions:</span> {genAssumptions.join('; ')}
            </div>
          )}

          {genWarnings.length > 0 && (
            <div className="rounded-lg border border-yellow-500/20 bg-status-warning/10 px-3 py-2 text-[11px] text-warning">
              <span className="font-medium">Warnings:</span> {genWarnings.join('; ')}
            </div>
          )}

          {genClarifications.length > 0 && (
            <div className="space-y-2 rounded-lg border border-brand/20 bg-brand/5 p-3">
              <div className="text-xs font-medium text-white">Help me get this right:</div>
              {genClarifications.map((c: any) => (
                <div key={c.id} className="space-y-1">
                  <div className="text-[11px] text-secondary">{c.question}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.suggestions.map((s: string) => {
                      const active = c.multi ? ((genAnswers[c.id] as string[]) || []).includes(s) : genAnswers[c.id] === s;
                      return (
                        <button key={s} onClick={() => toggleAnswer(c.id, s, c.multi)} aria-pressed={active}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${active ? 'border-brand bg-brand/15 text-brand' : 'border-border bg-surface-tertiary text-secondary hover:border-border-hover'}`}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button onClick={handleRefine} disabled={genLoading}
                className="mt-1 flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
                <Sparkles size={12} aria-hidden="true" /> {genLoading ? 'Refining…' : 'Refine with my answers'}
              </button>
            </div>
          )}

          {genDraftForm && (
            <div className="space-y-3 rounded-lg border border-border bg-surface-tertiary p-3">
              <div className="text-xs font-medium text-white">Review &amp; save</div>
              <PolicyGeneratedDraftEditor
                draft={genDrafts[0] || null}
                form={genDraftForm}
                setForm={setGenDraftForm}
                policyTypes={POLICY_TYPES}
                actionOptions={ACTION_OPTIONS}
                agents={agents}
                summary={buildPolicySummary(genDraftForm)}
                saving={genLoading}
                onSave={handleCreateDraft}
                saveDisabled={!genDraftForm?.name?.trim()}
              />
            </div>
          )}
        </div>
      )}

      {/* Authoring panel — inline controlled form */}
      {showAuthoring && (
        <div className="space-y-4 rounded-xl border border-brand/20 bg-surface-secondary p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">
              {editingId ? 'Edit policy' : 'New policy'}
            </div>
            <button
              onClick={closeAuthoring}
              className="text-tertiary transition-colors hover:text-white"
              aria-label="Close policy editor"
            >
              <X size={16} />
            </button>
          </div>

          <PolicyAuthoringPanel
            form={authoringForm}
            policyTypes={POLICY_TYPES}
            actionOptions={ACTION_OPTIONS}
            agents={agents}
            summary={summary}
            onChange={setAuthoringForm}
          />

          {authoringError && (
            <div className="text-xs text-error">{authoringError}</div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || isFormInvalid}
              className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create policy'}
            </button>
            <button
              onClick={closeAuthoring}
              className="rounded-lg border border-border bg-surface-tertiary px-4 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Import panel */}
      <PolicyAdvancedImportPanel
        open={showImport}
        onClose={closeImport}
        importMode={importMode}
        setImportMode={selectImportMode}
        importPack={importPack}
        setImportPack={selectImportPack}
        importYaml={importYaml}
        setImportYaml={selectImportYaml}
        importing={importing}
        importResult={importResult}
        importPreview={importPreview}
        previewing={previewing}
        handlePreview={handlePreview}
        handleImport={handleImport}
        packPreviews={PACK_PREVIEWS}
        templates={templates}
      />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="policy-search" className="sr-only">Search policies</label>
        <input
          id="policy-search"
          type="text"
          placeholder="Search policies…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="min-w-[200px] flex-1 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <label htmlFor="policy-type-filter" className="sr-only">Filter by type</label>
        <select
          id="policy-type-filter"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">All types</option>
          <option value="risk_threshold">Risk threshold</option>
          <option value="require_approval">Require approval</option>
          <option value="block_action_type">Block action type</option>
          <option value="rate_limit">Rate limit</option>
          <option value="webhook_check">Webhook check</option>
          <option value="semantic_check">Semantic check</option>
          <option value="non_fabrication">Non-fabrication</option>
        </select>
        <label htmlFor="policy-status-filter" className="sr-only">Filter by status</label>
        <select
          id="policy-status-filter"
          value={filterActive}
          onChange={e => setFilterActive(e.target.value)}
          className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Policy list */}
      <div className="rounded-xl border border-border bg-surface-secondary">
        {loading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12">
            <EmptyState
              icon={Plus}
              title="No policies"
              description="Create your first policy or import a template pack."
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(p => {
              const agentCount = parseAgentIds(p).length;
              const isActive = p.active === 1;
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-white">{p.name}</span>
                      <Badge size="xs">{p.policy_type}</Badge>
                      <Badge variant={isActive ? 'success' : 'default'} size="xs">
                        {isActive ? 'active' : 'inactive'}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-tertiary">
                      {formatRules(p)} <span aria-hidden="true" className="text-zinc-700">&middot;</span> {agentCount === 0 ? 'All agents' : `${agentCount} agents`} <span aria-hidden="true" className="text-zinc-700">&middot;</span> {p.id}
                      {(() => {
                        const c = budgetByPolicy[p.id] ? budgetConsumption(budgetByPolicy[p.id]) : null;
                        return c ? (<>
                          {' '}<span aria-hidden="true" className="text-zinc-700">&middot;</span>{' '}
                          <span className={`tabular-nums ${c.tone}`}>{c.text}</span>
                        </>) : null;
                      })()}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleToggleActive(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={isActive ? `Deactivate ${p.name}` : `Activate ${p.name}`}
                    >
                      {isActive
                        ? <ToggleRight size={16} className="text-brand" />
                        : <ToggleLeft size={16} />}
                    </button>
                    <button
                      onClick={() => openEdit(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleSimulate(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={`Simulate ${p.name}`}
                    >
                      <Play size={13} />
                    </button>
                    <button
                      onClick={() => handleExport(p)}
                      className="rounded p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                      aria-label={`Export ${p.name} as JSON`}
                    >
                      {copiedId === p.id
                        ? <Check size={13} className="text-success" />
                        : <Copy size={13} />}
                    </button>
                    {confirmDeleteId === p.id ? (
                      <span className="flex items-center gap-1 pl-1 text-xs">
                        <button
                          onClick={() => handleDelete(p.id)}
                          disabled={deleting}
                          className="rounded px-1.5 py-0.5 text-error transition-colors hover:bg-error-subtle hover:text-error disabled:opacity-50"
                        >
                          {deleting ? '…' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded px-1.5 py-0.5 text-secondary transition-colors hover:bg-white/5 hover:text-white"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(p.id)}
                        className="rounded p-1 text-tertiary transition-colors hover:bg-error-subtle hover:text-error focus:outline-none focus:ring-2 focus:ring-red-500/40"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
