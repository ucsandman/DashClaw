'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ShieldAlert, Lock, RotateCw, AlertTriangle, Cpu, CheckCircle2,
  PlayCircle, Pencil, ThumbsDown, Activity, Sparkles, Database, Power,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useEffectiveRole } from '../hooks/useEffectiveRole';

const TYPE_META: Record<string, { label: string; icon: typeof ShieldAlert }> = {
  destructive_command_approval: { label: 'Destructive commands → approval', icon: ShieldAlert },
  protected_path_approval: { label: 'Protected paths → approval', icon: Lock },
  repeated_reload_warn: { label: 'Repeated file reloads', icon: RotateCw },
  failed_loop_warn: { label: 'Repeated command failures', icon: AlertTriangle },
  model_task_mismatch_warn: { label: 'Cheap model on heavy task', icon: Cpu },
  agent_allowlist: { label: 'Safe operating envelope', icon: CheckCircle2 },
};

const SEV_VARIANT: Record<string, string> = { high: 'warning', medium: 'info', low: 'default' };
const FP_VARIANT: Record<string, string> = { low: 'success', medium: 'warning', high: 'error' };

function confidenceTone(c: number): string {
  if (c >= 80) return 'text-success';
  if (c >= 60) return 'text-warning';
  return 'text-secondary';
}

function fmtTs(ts?: string): string {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

/** Compact relative age for the live "last sample" / recent-sample rows. */
function ageLabel(ts?: string | null): string {
  if (!ts) return '—';
  const ms = Date.now() - Date.parse(ts);
  if (Number.isNaN(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const primaryBtn = 'px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
const secondaryBtn = 'px-3 py-1.5 text-xs font-medium text-secondary hover:text-white bg-surface-tertiary border border-border rounded-lg hover:border-border-hover transition-colors inline-flex items-center gap-1.5 disabled:opacity-40';

interface EditForm {
  action: string;
  risk_threshold: number | string;
  paths: string;
}

export default function PolicyCoachPage() {
  const { agentId } = useAgentFilter();
  const { isAdmin } = useEffectiveRole();
  const [status, setStatus] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [recent, setRecent] = useState<any[]>([]); // recent redacted sample records
  const [insights, setInsights] = useState<any>(null); // safe aggregate snapshot (hosted view)
  const initialCountRef = useRef<number | null>(null); // baseline for "captured this session"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recorderCfg, setRecorderCfg] = useState<any>(null); // { enabled, until, effective }
  const [recorderDuration, setRecorderDuration] = useState('7'); // days; '' = until turned off
  const [recorderBusy, setRecorderBusy] = useState(false);

  const [sims, setSims] = useState<Record<string, any>>({}); // suggestion id -> simulation result
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [dismissing, setDismissing] = useState<any>(null); // suggestion being dismissed
  const [dismissReason, setDismissReason] = useState('');
  const [suppressSimilar, setSuppressSimilar] = useState(false);
  const [editing, setEditing] = useState<any>(null); // suggestion being edited
  // Where the suggestion evidence came from: local JSONL or opt-in anonymized upload.
  const [sampleSource, setSampleSource] = useState<'local' | 'uploaded'>('local');
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (agentId) params.set('agent_id', agentId);
      const [statusRes, sugRes, recRes, listRes, insRes] = await Promise.all([
        fetch('/api/behavior/samples'),
        fetch(`/api/behavior/suggestions?${params.toString()}`),
        fetch('/api/behavior/recorder'),
        fetch('/api/behavior/samples?list=25'),
        fetch('/api/behavior/insights'),
      ]);
      const statusData = await statusRes.json();
      const sugData = await sugRes.json();
      const recData = await recRes.json().catch(() => null);
      const listData = await listRes.json().catch(() => null);
      const insData = await insRes.json().catch(() => null);
      if (recData && !recData.error) setRecorderCfg(recData);
      if (listData && Array.isArray(listData.samples)) setRecent(listData.samples);
      if (insData && !insData.error) setInsights(insData.snapshot ?? null);
      if (statusData && !statusData.error) {
        setStatus(statusData);
        // Baseline the session count on first successful load so the live strip
        // can show "captured this session".
        if (initialCountRef.current === null) initialCountRef.current = statusData.sample_count || 0;
      }
      if (sugData && !sugData.error) {
        setAgents(Array.isArray(sugData.agents) ? sugData.agents : []);
        setSuggestions(Array.isArray(sugData.suggestions) ? sugData.suggestions : []);
        setSampleCount(sugData.sample_count || 0);
        setSampleSource(sugData.sample_source === 'uploaded' ? 'uploaded' : 'local');
      } else if (sugData && sugData.error) {
        setError(sugData.error);
      }
    } catch (err) {
      setError('Failed to load Policy Coach data.');
      console.error('[policy-coach] fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Live refresh while the recorder is effective: refresh status + recent
  // samples (lightweight — no loading flicker) so the panel reflects captures as
  // they land.
  const pollTickRef = useRef(0);
  const pollLive = useCallback(async () => {
    try {
      // Every list read re-parses the entire JSONL store server-side (up to
      // 20k samples) — poll the cheap status each tick, the heavy list +
      // insights only every 4th tick (once a minute at the 15s cadence).
      const heavy = pollTickRef.current % 4 === 0;
      pollTickRef.current += 1;
      const [statusRes, listRes, insRes] = await Promise.all([
        fetch('/api/behavior/samples'),
        heavy ? fetch('/api/behavior/samples?list=25') : Promise.resolve(null),
        heavy ? fetch('/api/behavior/insights') : Promise.resolve(null),
      ]);
      const s = await statusRes.json().catch(() => null);
      if (s && !s.error) setStatus(s);
      if (listRes) {
        const l = await listRes.json().catch(() => null);
        if (l && Array.isArray(l.samples)) setRecent(l.samples);
      }
      if (insRes) {
        const ins = await insRes.json().catch(() => null);
        if (ins && !ins.error) setInsights(ins.snapshot ?? null);
      }
    } catch {
      // ignore — the next tick retries
    }
  }, []);

  useEffect(() => {
    if (!recorderCfg?.effective) return;
    const t = setInterval(pollLive, 15000);
    return () => clearInterval(t);
  }, [recorderCfg?.effective, pollLive]);

  const runSimulation = useCallback(async (suggestion: any, editedRule?: any) => {
    setBusy(suggestion.id);
    setNotice('');
    try {
      const body = editedRule ? { rule: editedRule } : { suggestion_id: suggestion.id };
      const res = await fetch('/api/behavior/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data && data.simulation) {
        setSims((prev) => ({ ...prev, [suggestion.id]: data.simulation }));
      } else {
        setError(data.error || 'Simulation failed.');
      }
      return data.simulation;
    } catch (err) {
      setError('Simulation request failed.');
      console.error('[policy-coach] simulate error', err);
    } finally {
      setBusy('');
    }
  }, []);

  const adopt = useCallback(async (suggestion: any, edited?: any) => {
    if (!sims[suggestion.id]) {
      setError('Run a simulation and review the impact before adopting.');
      return;
    }
    setBusy(suggestion.id);
    setNotice('');
    try {
      const res = await fetch('/api/behavior/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adopt', suggestion_id: suggestion.id, acknowledged_simulation: true, edited: edited || undefined }),
      });
      const data = await res.json();
      if (data && data.adopted) {
        setNotice(data.note || (data.advisory ? 'Observation accepted.' : 'Draft policy created (inactive).'));
        setEditing(null);
        await fetchData();
      } else {
        setError(data.error || 'Adoption failed.');
      }
    } catch (err) {
      setError('Adoption request failed.');
      console.error('[policy-coach] adopt error', err);
    } finally {
      setBusy('');
    }
  }, [sims, fetchData]);

  const submitDismiss = useCallback(async () => {
    if (!dismissing) return;
    setBusy(dismissing.id);
    try {
      const res = await fetch('/api/behavior/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', suggestion_id: dismissing.id, reason: dismissReason || null, suppress_similar: suppressSimilar }),
      });
      const data = await res.json();
      if (data && data.dismissed) {
        setDismissing(null);
        setDismissReason('');
        setSuppressSimilar(false);
        await fetchData();
      } else {
        setError(data.error || 'Dismiss failed.');
      }
    } catch (err) {
      setError('Dismiss request failed.');
    } finally {
      setBusy('');
    }
  }, [dismissing, dismissReason, suppressSimilar, fetchData]);

  const openEdit = (s: any) => {
    const rules = s.draft_policy ? JSON.parse(s.draft_policy.rules) : {};
    setEditForm({
      action: rules.action || s.rule.action || 'require_approval',
      risk_threshold: rules.threshold ?? s.rule.risk_threshold ?? 70,
      paths: Array.isArray(rules.paths) ? rules.paths.join('\n') : '',
    });
    setEditing(s);
  };

  const editedRuleFromForm = (s: any) => {
    if (s.type === 'protected_path_approval') {
      return { ...s.rule, action: editForm!.action, paths: editForm!.paths.split('\n').map((p) => p.trim()).filter(Boolean) };
    }
    return { ...s.rule, action: editForm!.action, risk_threshold: Number(editForm!.risk_threshold) };
  };

  const saveRecorder = useCallback(async (enabled: boolean) => {
    setRecorderBusy(true);
    setError('');
    setNotice('');
    try {
      const duration_days = enabled && recorderDuration ? Number(recorderDuration) : null;
      const res = await fetch('/api/behavior/recorder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, duration_days }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || (res.status === 403 ? 'Admin access required to change the recorder.' : 'Failed to update recorder.'));
        return;
      }
      setRecorderCfg(data);
      setNotice(enabled
        ? `Recorder enabled${data.until ? ` until ${fmtTs(data.until)}` : ' until you turn it off'}. Cooperating agent hooks pick this up on their next run.`
        : 'Recorder disabled. Agents stop capturing new samples on their next run.');
    } catch {
      setError('Failed to update recorder.');
    } finally {
      setRecorderBusy(false);
    }
  }, [recorderDuration]);

  // Server-enforced opt-in for anonymized sample upload (org setting; the
  // ingest route 403s without it, the agent-side env var gates the client).
  const saveUpload = useCallback(async (upload_enabled: boolean) => {
    setRecorderBusy(true);
    setError('');
    try {
      const res = await fetch('/api/behavior/recorder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to update upload opt-in.');
        return;
      }
      setRecorderCfg(data);
      setNotice(upload_enabled
        ? 'Anonymized upload enabled for this org. Agents also need DASHCLAW_BEHAVIOR_UPLOAD=1 set on their machine.'
        : 'Anonymized upload disabled. The ingest endpoint now rejects pushes for this org.');
    } catch {
      setError('Failed to update upload opt-in.');
    } finally {
      setRecorderBusy(false);
    }
  }, []);

  const ready = status?.ready;
  const recorderOn = recorderCfg?.effective;
  const totalSamples = status?.sample_count ?? sampleCount ?? 0;
  const capturedThisSession = Math.max(0, (status?.sample_count ?? 0) - (initialCountRef.current ?? 0));

  return (
    <PageLayout
      title="Policy Coach"
      subtitle="Evidence-backed policy suggestions learned from real, locally-recorded agent behavior. Observe-only — nothing is enforced until you activate it."
      breadcrumbs={['Governance', 'Policy Coach']}
      maturity="beta"
    >
      {/* Status / privacy strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Samples captured" value={status?.sample_count ?? sampleCount ?? 0} icon={Database} />
        <StatTile label="Observed agents" value={status?.agent_count ?? agents.length} icon={Activity} />
        <StatTile label="Suggestions" value={suggestions.length} icon={Sparkles} />
        <StatTile label="Recorder" value={recorderOn ? 'On' : 'Off'} tone={recorderOn ? 'text-success' : 'text-tertiary'} icon={Power} />
      </div>

      {/* Recorder control — turn capture on/off and set an auto-stop window. The
          local agent hook honors this on its next run (an explicit
          DASHCLAW_BEHAVIOR_SAMPLES_ENABLED env var still overrides it). */}
      <RecorderCard
        recorderOn={recorderOn}
        recorderCfg={recorderCfg}
        recorderDuration={recorderDuration}
        onDurationChange={setRecorderDuration}
        recorderBusy={recorderBusy}
        isAdmin={isAdmin}
        onSaveRecorder={saveRecorder}
        onSaveUpload={saveUpload}
      />

      {/* Live observability strip — visible while the recorder is effective. */}
      {recorderOn && (
        <LiveStrip status={status} recorderCfg={recorderCfg} capturedThisSession={capturedThisSession} />
      )}

      {notice && (
        <div className="mb-4 rounded-lg border border-success/20 bg-success-subtle px-4 py-2.5 text-xs text-success">{notice}</div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-error/20 bg-error-subtle px-4 py-2.5 text-xs text-error">{error}</div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-tertiary">Analyzing samples…</div>
      ) : status?.remote && sampleCount === 0 && insights ? (
        /* Hosted with no usable samples (no opt-in upload yet): counts-only
           snapshot. Hosted WITH uploaded samples falls through to the full
           coach below — same simulate-before-adopt flow, fleet provenance. */
        <InsightsPanel insights={insights} />
      ) : totalSamples === 0 && sampleCount === 0 ? (
        <Card hover={false}>
          <CardContent className="pt-5">
            {status?.remote ? (
              <EmptyState
                icon={Database}
                title="Samples stay on the machine your agents run on (unless you opt in to upload)"
                description="You're viewing a hosted DashClaw, which can't read the local-only samples your agents write to .dashclaw/behavior-samples/ — by default they never leave that machine. Once your agents finish a session with the recorder on, a privacy-safe summary (counts only, no raw behavior) appears here. To review policy drafts on this hosted view, either opt in to anonymized sample upload (DASHCLAW_BEHAVIOR_UPLOAD=1 on the agent machine — goals, project paths, and command operands are stripped or hashed before transit) or open Policy Coach from a DashClaw running locally on that machine."
              />
            ) : recorderOn ? (
              <EmptyState
                icon={Activity}
                title="Recorder on — nothing captured yet"
                description="The recorder is active, but no samples have landed yet. Run your agents normally — redacted samples appear here within a few tool calls, and this view refreshes live. Samples are written to .dashclaw/behavior-samples/ and stay local unless anonymized upload is opted in (default off)."
              />
            ) : (
              <EmptyState
                icon={Power}
                title="Recorder is off"
                description="Turn on the behavior recorder above, then run your agents normally — they capture redacted samples that DashClaw analyzes for evidence-backed suggestions. (Cooperating hooks honor the toggle on their next run; an explicit DASHCLAW_BEHAVIOR_SAMPLES_ENABLED env var also works.) Samples stay on the capture machine unless you opt in to anonymized upload (DASHCLAW_BEHAVIOR_UPLOAD=1, default off)."
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Suggestions (main column) */}
          <div className="lg:col-span-2">
            <Card hover={false}>
              <CardHeader title="Policy suggestions" icon={Sparkles} count={suggestions.length} />
              <div className="px-5 pb-1" data-testid="evidence-provenance">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  sampleSource === 'uploaded'
                    ? 'border-info/30 bg-info-subtle text-info'
                    : 'border-border bg-surface-tertiary text-tertiary'
                }`}>
                  {sampleSource === 'uploaded' ? 'Evidence: anonymized fleet upload' : 'Evidence: local samples'}
                </span>
              </div>
              <CardContent className="pt-0">
                {suggestions.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title={ready ? 'No suggestions right now' : 'Not enough samples yet'}
                    description={ready
                      ? 'DashClaw found no evidence-backed policy suggestions for the observed agents. Keep working — new patterns surface as behavior accumulates.'
                      : `Capture at least ${status?.min_samples ?? 8} samples for an agent before suggestions appear.`}
                  />
                ) : (
                  <div className="space-y-3">
                    {suggestions.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        s={s}
                        sim={sims[s.id]}
                        busy={busy === s.id}
                        onSimulate={() => runSimulation(s)}
                        onAdopt={() => adopt(s)}
                        onEdit={() => openEdit(s)}
                        onDismiss={() => { setDismissing(s); setDismissReason(''); setSuppressSimilar(false); }}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Observed agents (side column) */}
          <div>
            <Card hover={false}>
              <CardHeader title="Observed agents" icon={Activity} count={agents.length} />
              <CardContent className="pt-0">
                {agents.length === 0 ? (
                  <div className="py-6 text-center text-xs text-tertiary">No agents observed.</div>
                ) : (
                  <div className="space-y-3">
                    {agents.map((a) => <AgentEnvelope key={a.agent_id} a={a} />)}
                  </div>
                )}
              </CardContent>
            </Card>
            <p className="mt-3 px-1 text-[11px] leading-relaxed text-tertiary">
              Samples are stored locally at <span className="font-mono text-secondary">{status?.dir || '.dashclaw/behavior-samples'}</span> and analyzed on this machine. Adopted suggestions become inactive drafts on{' '}
              <Link href="/policies" className="text-secondary hover:text-brand">Policies</Link> — never enforced automatically.
            </p>
          </div>
        </div>

        <RecentSamplesPanel samples={recent} />
        </>
      )}

      {dismissing && (
        <DismissModal
          dismissing={dismissing}
          dismissReason={dismissReason}
          onReasonChange={setDismissReason}
          suppressSimilar={suppressSimilar}
          onSuppressChange={setSuppressSimilar}
          busy={busy === dismissing.id}
          onCancel={() => setDismissing(null)}
          onSubmit={submitDismiss}
        />
      )}

      {editing && editForm && (
        <EditPolicyModal
          editing={editing}
          editForm={editForm}
          setEditForm={setEditForm}
          sim={sims[editing.id]}
          busy={busy === editing.id}
          onClose={() => setEditing(null)}
          onSimulate={() => runSimulation(editing, editedRuleFromForm(editing))}
          onAdopt={() => adopt(editing, editedRuleFromForm(editing))}
        />
      )}
    </PageLayout>
  );
}

interface RecorderCardProps {
  recorderOn: boolean;
  recorderCfg: any;
  recorderDuration: string;
  onDurationChange: (value: string) => void;
  recorderBusy: boolean;
  isAdmin: boolean;
  onSaveRecorder: (enabled: boolean) => void;
  onSaveUpload: (upload_enabled: boolean) => void;
}

function RecorderCard({ recorderOn, recorderCfg, recorderDuration, onDurationChange, recorderBusy, isAdmin, onSaveRecorder, onSaveUpload }: RecorderCardProps) {
  return (
    <Card hover={false} className="mb-5">
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Power size={15} className={recorderOn ? 'text-success' : 'text-tertiary'} />
              Behavior recorder is {recorderOn ? 'on' : 'off'}
            </div>
            <p className="mt-1 text-xs text-tertiary">
              {recorderOn && recorderCfg?.until
                ? `Capturing redacted samples (local-only unless anonymized upload is opted in) — auto-stops ${fmtTs(recorderCfg.until)}.`
                : recorderOn
                  ? 'Capturing redacted samples until you turn it off — they stay local unless you opt in to anonymized upload below.'
                  : 'Turn this on to let your agents capture redacted behavior samples for evidence-backed suggestions. Samples stay on the capture machine unless you separately opt in to anonymized upload (default off).'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!recorderOn && (
              <select
                value={recorderDuration}
                onChange={(e) => onDurationChange(e.target.value)}
                disabled={!isAdmin || recorderBusy}
                aria-label="Auto-stop window"
                className="rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 text-xs text-white focus:border-brand focus:outline-none disabled:opacity-40"
              >
                <option value="1">for 1 day</option>
                <option value="7">for 7 days</option>
                <option value="30">for 30 days</option>
                <option value="">until I turn it off</option>
              </select>
            )}
            <button
              className={recorderOn ? secondaryBtn : primaryBtn}
              disabled={!isAdmin || recorderBusy}
              title={!isAdmin ? 'Admin access required' : undefined}
              onClick={() => onSaveRecorder(!recorderOn)}
            >
              <Power size={13} /> {recorderBusy ? 'Saving…' : recorderOn ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        </div>
        {!isAdmin && (
          <p className="mt-2 text-[11px] text-tertiary">Only workspace admins can change the recorder.</p>
        )}
        {/* Opt-in anonymized upload — default OFF, server-enforced. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3" data-testid="upload-optin">
          <div className="min-w-0">
            <div className="text-xs font-medium text-secondary">
              Anonymized upload is {recorderCfg?.upload_enabled ? 'on' : 'off'}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">
              Default off. When on (and agents set <code className="font-mono">DASHCLAW_BEHAVIOR_UPLOAD=1</code>),
              samples upload with goals, project names, and agent names dropped; sessions and paths replaced by
              salted hashes; command operands masked. Enables the full coach on hosted dashboards.
            </p>
          </div>
          <button
            className={recorderCfg?.upload_enabled ? secondaryBtn : primaryBtn}
            disabled={!isAdmin || recorderBusy}
            title={!isAdmin ? 'Admin access required' : undefined}
            onClick={() => onSaveUpload(!recorderCfg?.upload_enabled)}
          >
            {recorderBusy ? 'Saving…' : recorderCfg?.upload_enabled ? 'Disable upload' : 'Enable upload'}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveStrip({ status, recorderCfg, capturedThisSession }: { status: any; recorderCfg: any; capturedThisSession: number }) {
  return (
    <div
      aria-live="polite"
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-tertiary"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-success" aria-hidden="true" /> Live
      </span>
      <span>Last sample: <span className="text-secondary">{ageLabel(status?.newest_ts)}</span></span>
      <span>Captured this session: <span className="tabular-nums text-secondary">{capturedThisSession}</span></span>
      {recorderCfg?.until && <span>Auto-stops: <span className="text-secondary">{fmtTs(recorderCfg.until)}</span></span>}
    </div>
  );
}

interface DismissModalProps {
  dismissing: any;
  dismissReason: string;
  onReasonChange: (value: string) => void;
  suppressSimilar: boolean;
  onSuppressChange: (value: boolean) => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

function DismissModal({ dismissing, dismissReason, onReasonChange, suppressSimilar, onSuppressChange, busy, onCancel, onSubmit }: DismissModalProps) {
  return (
    <Modal onClose={onCancel} title="Dismiss suggestion">
      <p className="mb-3 text-xs text-tertiary">{TYPE_META[dismissing.type]?.label} for <span className="text-secondary">{dismissing.agent_id}</span></p>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Reason (optional)</label>
      <textarea
        value={dismissReason}
        onChange={(e) => onReasonChange(e.target.value)}
        rows={2}
        className="mb-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
        placeholder="e.g. false positive — this agent is allowed to do this"
      />
      <label className="mb-4 flex items-center gap-2 text-xs text-secondary">
        <input type="checkbox" checked={suppressSimilar} onChange={(e) => onSuppressChange(e.target.checked)} className="accent-brand" />
        Suppress similar suggestions of this type for this agent
      </label>
      <div className="flex justify-end gap-2">
        <button className={secondaryBtn} onClick={onCancel}>Cancel</button>
        <button className={primaryBtn} disabled={busy} onClick={onSubmit}>Dismiss</button>
      </div>
    </Modal>
  );
}

interface EditPolicyModalProps {
  editing: any;
  editForm: EditForm;
  setEditForm: (form: EditForm) => void;
  sim?: any;
  busy: boolean;
  onClose: () => void;
  onSimulate: () => void;
  onAdopt: () => void;
}

function EditPolicyModal({ editing, editForm, setEditForm, sim, busy, onClose, onSimulate, onAdopt }: EditPolicyModalProps) {
  return (
    <Modal onClose={onClose} title="Edit draft policy">
      <p className="mb-3 text-xs text-tertiary">{TYPE_META[editing.type]?.label} for <span className="text-secondary">{editing.agent_id}</span></p>
      {editing.type === 'protected_path_approval' ? (
        <>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Protected path globs (one per line)</label>
          <textarea
            value={editForm.paths}
            onChange={(e) => setEditForm({ ...editForm, paths: e.target.value })}
            rows={5}
            className="mb-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-xs text-white focus:border-brand focus:outline-none"
          />
        </>
      ) : (
        <>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Risk threshold (0–100)</label>
          <input
            type="number" min={0} max={100}
            value={editForm.risk_threshold}
            onChange={(e) => setEditForm({ ...editForm, risk_threshold: e.target.value })}
            className="mb-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
          />
        </>
      )}
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-tertiary">Decision</label>
      <select
        value={editForm.action}
        onChange={(e) => setEditForm({ ...editForm, action: e.target.value })}
        className="mb-4 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
      >
        <option value="warn">Warn</option>
        <option value="require_approval">Require approval</option>
        <option value="block">Block</option>
      </select>
      {sim && <SimGrid sim={sim} />}
      <div className="mt-4 flex justify-end gap-2">
        <button className={secondaryBtn} disabled={busy} onClick={onSimulate}>
          <PlayCircle size={13} /> Simulate edit
        </button>
        <button className={primaryBtn} disabled={busy || !sim} onClick={onAdopt}>
          Adopt edited draft
        </button>
      </div>
    </Modal>
  );
}

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  icon?: typeof Database;
  tone?: string;
}

function StatTile({ label, value, icon: Icon, tone }: StatTileProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone || 'text-white'}`}>{value}</div>
    </div>
  );
}

function SimGrid({ sim }: { sim: any }) {
  const cells = [
    { label: 'Allow', value: sim.allow, tone: 'text-success' },
    { label: 'Warn', value: sim.warn, tone: 'text-warning' },
    { label: 'Approval', value: sim.require_approval, tone: 'text-warning' },
    { label: 'Block', value: sim.block, tone: 'text-error' },
  ];
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-tertiary p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-tertiary">
        <span>Replay over {sim.total} sample{sim.total === 1 ? '' : 's'}</span>
        {sim.likely_false_positives > 0 && (
          <Badge variant="warning" size="xs">{sim.likely_false_positives} likely false positive{sim.likely_false_positives === 1 ? '' : 's'}</Badge>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="text-center">
            <div className={`text-lg font-semibold tabular-nums ${c.tone}`}>{c.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-tertiary">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SuggestionCardProps {
  s: any;
  sim?: any;
  busy: boolean;
  onSimulate: () => void;
  onAdopt: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}

function SuggestionCard({ s, sim, busy, onSimulate, onAdopt, onEdit, onDismiss }: SuggestionCardProps) {
  const meta = TYPE_META[s.type] || { label: s.type, icon: Sparkles };
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border border-border bg-surface-tertiary p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={15} className="shrink-0 text-secondary" />
            <span className="text-sm font-medium text-white">{meta.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-tertiary">{s.agent_id}</span>
            <Badge variant={SEV_VARIANT[s.severity]} size="xs">{s.severity}</Badge>
            <Badge variant={s.enforceable ? 'brand' : 'default'} size="xs">{s.enforceable ? 'enforceable draft' : 'advisory'}</Badge>
            <Badge variant={FP_VARIANT[s.false_positive_risk]} size="xs">FP risk: {s.false_positive_risk}</Badge>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-sm font-semibold tabular-nums ${confidenceTone(s.confidence)}`}>{s.confidence}%</div>
          <div className="text-[10px] uppercase tracking-wide text-tertiary">confidence</div>
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-secondary">{s.expected_effect}</p>

      <div className="mt-2 text-[11px] text-tertiary">
        Evidence: <span className="tabular-nums text-secondary">{s.matching_sample_size}</span> of{' '}
        <span className="tabular-nums text-secondary">{s.sample_size}</span> samples · target{' '}
        <span className="text-secondary">{s.target}</span>
      </div>

      {s.evidence_examples?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {s.evidence_examples.slice(0, 3).map((e: any) => (
            <li key={e.event_id} className="flex items-center gap-2 font-mono text-[11px] text-tertiary">
              <span className="truncate text-secondary">{e.command_shape || e.write_path || e.tool}</span>
              {e.outcome_status && <span className="shrink-0 text-tertiary">· {e.outcome_status}</span>}
              {e.risk_score != null && <span className="shrink-0 text-tertiary">· risk {e.risk_score}</span>}
            </li>
          ))}
        </ul>
      )}

      {sim && <SimGrid sim={sim} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={secondaryBtn} disabled={busy} onClick={onSimulate}>
          <PlayCircle size={13} /> {sim ? 'Re-simulate' : 'Simulate'}
        </button>
        {s.enforceable && (
          <button className={secondaryBtn} disabled={busy} onClick={onEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
        <button className={primaryBtn} disabled={busy || !sim} title={!sim ? 'Simulate first' : undefined} onClick={onAdopt}>
          {s.advisory ? 'Accept observation' : 'Adopt as draft'}
        </button>
        <button className={secondaryBtn} disabled={busy} onClick={onDismiss}>
          <ThumbsDown size={13} /> Dismiss
        </button>
      </div>
    </div>
  );
}

function RecentSamplesPanel({ samples }: { samples: any[] }) {
  return (
    <Card hover={false} className="mt-5">
      <CardHeader title="Recent samples" icon={Database} count={samples.length} />
      <CardContent className="pt-0">
        {samples.length === 0 ? (
          <div className="py-6 text-center text-xs text-tertiary">No samples captured yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {samples.map((s) => (
              <div
                key={s.event_id}
                data-entity-type="behaviorSample"
                data-entity-id={s.event_id}
                data-entity-status={s.outcome_status}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="default" size="xs">{s.tool || s.action_type || 'tool'}</Badge>
                  <span className="truncate font-mono text-[11px] text-secondary">
                    {s.command_shape || s.write_paths?.[0] || s.read_paths?.[0] || s.action_type || '—'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-tertiary">
                  {s.risk_score != null && <span className="tabular-nums">risk {s.risk_score}</span>}
                  {s.guard_decision && (
                    <Badge
                      variant={s.guard_decision === 'block' ? 'error' : s.guard_decision === 'warn' || s.guard_decision === 'require_approval' ? 'warning' : 'default'}
                      size="xs"
                    >
                      {s.guard_decision}
                    </Badge>
                  )}
                  {s.outcome_status && <span>· {s.outcome_status}</span>}
                  <span className="tabular-nums">{ageLabel(s.ts)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Hosted "learning in the background" panel. Renders the SAFE aggregate snapshot
 * the local machine pushed (counts only — no raw behavior). Shown when this is a
 * remote/hosted instance that can't read the local samples directly.
 */
function InsightsPanel({ insights }: { insights: any }) {
  const sig = insights.signals || {};
  const agents: any[] = Array.isArray(insights.agents) ? insights.agents : [];
  const tiles = [
    { label: 'Actions observed', value: insights.sample_count ?? 0, icon: Database },
    { label: 'Agents learning', value: insights.agent_count ?? agents.length, icon: Activity },
    { label: 'High-risk flagged', value: sig.high_risk_actions ?? 0, icon: ShieldAlert },
    { label: 'Protected writes', value: sig.protected_path_writes ?? 0, icon: Lock },
  ];
  return (
    <div className="space-y-5">
      <Card hover={false}>
        <CardContent className="py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-success" aria-hidden="true" />
                DashClaw is learning in the background
              </div>
              <p className="mt-1 text-xs text-tertiary">
                Watching your agents{insights.host_label ? <> on <span className="text-secondary">{insights.host_label}</span></> : null} and learning which protections to suggest. Last activity{' '}
                <span className="text-secondary">{ageLabel(insights.newest_ts)}</span>
                {insights.pushed_at ? <> · synced <span className="text-secondary">{ageLabel(insights.pushed_at)}</span></> : null}.
              </p>
            </div>
            <Badge variant="brand" size="xs">aggregate · privacy-safe</Badge>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((t) => <StatTile key={t.label} label={t.label} value={t.value} icon={t.icon} />)}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card hover={false}>
            <CardHeader title="What DashClaw is watching" icon={Sparkles} />
            <CardContent className="pt-0">
              <SignalRow label="Destructive commands" value={sig.destructive_commands ?? 0} tone="text-warning" />
              <SignalRow label="Protected-path writes" value={sig.protected_path_writes ?? 0} tone="text-warning" />
              <SignalRow label="High-risk actions" value={sig.high_risk_actions ?? 0} tone="text-warning" />
              <SignalRow label="Failed actions" value={sig.failed_actions ?? 0} tone="text-error" />
              <SignalRow label="Blocked by policy" value={sig.blocked ?? 0} tone="text-error" />
              <SignalRow label="Sent for approval" value={sig.approvals ?? 0} tone="text-secondary" />
            </CardContent>
          </Card>
        </div>
        <div>
          <Card hover={false}>
            <CardHeader title="Agents observed" icon={Activity} count={agents.length} />
            <CardContent className="pt-0">
              {agents.length === 0 ? (
                <div className="py-6 text-center text-xs text-tertiary">No agents observed yet.</div>
              ) : (
                <div className="space-y-3">
                  {agents.map((a) => (
                    <div key={a.agent_id} className="rounded-lg border border-border bg-surface-tertiary p-3">
                      <div className="flex items-center justify-between">
                        <span className="truncate font-mono text-xs text-white">{a.agent_id}</span>
                        <span className="tabular-nums text-[11px] text-tertiary">{a.count} actions</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {a.destructive > 0 && <Badge variant="warning" size="xs">{a.destructive} destructive</Badge>}
                        {a.protected_writes > 0 && <Badge variant="warning" size="xs">{a.protected_writes} protected</Badge>}
                        {a.failed > 0 && <Badge variant="error" size="xs">{a.failed} failed</Badge>}
                        {a.tools > 0 && <Badge variant="default" size="xs">{a.tools} tool{a.tools === 1 ? '' : 's'}</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-tertiary">
        These are aggregate counts computed on the machine your agents run on — <span className="text-secondary">raw behavior stays there unless you opt in to anonymized upload (default off)</span>. To review the evidence-backed policy drafts here, set <span className="font-mono text-secondary">DASHCLAW_BEHAVIOR_UPLOAD=1</span> on the agent machine (goals, paths, and operands are stripped or hashed before transit), or open Policy Coach from a DashClaw running locally on that machine.
      </p>
    </div>
  );
}

function SignalRow({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="text-xs text-secondary">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function AgentEnvelope({ a }: { a: any }) {
  return (
    <div className="rounded-lg border border-border bg-surface-tertiary p-3">
      <div className="flex items-center justify-between">
        <span className="truncate font-mono text-xs text-white">{a.agent_id}</span>
        <span className="tabular-nums text-[11px] text-tertiary">{a.sample_size} samples</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {a.destructive_commands > 0 && <Badge variant="warning" size="xs">{a.destructive_commands} destructive</Badge>}
        {a.protected_touches > 0 && <Badge variant="warning" size="xs">{a.protected_touches} protected writes</Badge>}
        {a.failed > 0 && <Badge variant="error" size="xs">{a.failed} failed</Badge>}
        {a.models?.length > 0 && <Badge variant="default" size="xs">{a.models.length} model{a.models.length === 1 ? '' : 's'}</Badge>}
      </div>
      {a.safe_envelope?.tools?.length > 0 && (
        <div className="mt-2 text-[11px] text-tertiary">
          Safe ops: <span className="text-secondary">{a.safe_envelope.tools.slice(0, 5).join(', ')}</span>
        </div>
      )}
      <div className="mt-1 text-[11px] text-tertiary">Last seen {fmtTs(a.last_ts)}</div>
    </div>
  );
}

interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

function Modal({ title, children, onClose }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border-hover bg-surface-secondary p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>
        {children}
      </div>
    </div>
  );
}
