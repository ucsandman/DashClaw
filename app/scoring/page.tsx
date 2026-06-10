'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '../components/PageLayout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { isDemoMode } from '../lib/isDemoMode';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { demoScoringProfiles, demoRiskTemplates, demoScoringScores, demoCalibration } from '../lib/demoScoringData';

interface ScoringDimension {
  id?: string;
  name: string;
  data_source: string;
  weight: number;
  scale?: any[];
  data_config?: Record<string, any>;
}

interface ScoringProfile {
  id: string;
  name: string;
  description?: string;
  action_type?: string | null;
  composite_method?: string;
  status?: string;
  dimensions?: ScoringDimension[];
}

interface RiskRule {
  condition: string;
  add: number;
}

interface RiskTemplate {
  id: string;
  name: string;
  description?: string;
  action_type?: string | null;
  base_risk?: number;
  rules?: RiskRule[];
}

interface DimensionScore {
  dimension_name: string;
  score?: number | null;
  label?: string;
  raw_value?: number | string | null;
  weight?: number | null;
}

interface ScoreRecord {
  id: string;
  profile_name?: string;
  profile_id?: string;
  action_id?: string;
  composite_score: number;
  dimension_scores?: DimensionScore[];
}

interface NewProfileState {
  name: string;
  description: string;
  action_type: string;
  composite_method: string;
  dimensions: ScoringDimension[];
}

interface NewTemplateState {
  name: string;
  description: string;
  action_type: string;
  base_risk: number;
  rules: RiskRule[];
}

interface CalibrateFormState {
  action_type: string;
  lookback_days: number;
  agent_id: string;
  metrics: string[];
}

interface NewDimState {
  name: string;
  data_source: string;
  weight: number;
}

interface ScoreSummaryState {
  profileId: string;
  summary?: { scored?: number; total?: number; avg_score?: number | string };
  error?: string;
}

const TABS = ['Profiles', 'Score Explorer', 'Risk Templates', 'Calibrate'];

const DATA_SOURCES = [
  { value: 'duration_ms', label: 'Duration (ms)' },
  { value: 'cost_estimate', label: 'Cost Estimate' },
  { value: 'tokens_total', label: 'Total Tokens' },
  { value: 'risk_score', label: 'Risk Score' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'eval_score', label: 'Eval Score' },
  { value: 'metadata_field', label: 'Metadata Field' },
  { value: 'custom_function', label: 'Custom Function' },
];

const COMPOSITE_METHODS = [
  { value: 'weighted_average', label: 'Weighted Average', desc: 'Sum of (score x weight) across dimensions' },
  { value: 'minimum', label: 'Minimum', desc: 'Lowest dimension score wins (strictest)' },
  { value: 'geometric_mean', label: 'Geometric Mean', desc: 'Balanced  --  penalizes zeros heavily' },
];

// Metrics auto-calibrate can analyze (matches autoCalibrate's default set).
const CALIBRATE_METRICS = ['duration_ms', 'cost_estimate', 'tokens_total', 'risk_score', 'confidence'];

export default function ScoringPage() {
  const { agentId } = useAgentFilter();
  const [activeTab, setActiveTab] = useState('Profiles');
  const [profiles, setProfiles] = useState<ScoringProfile[]>([]);
  const [riskTemplates, setRiskTemplates] = useState<RiskTemplate[]>([]);
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [calibration, setCalibration] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ScoringProfile | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);      // profile id currently being scored
  const [scoreSummary, setScoreSummary] = useState<ScoreSummaryState | null>(null); // { profileId, summary? , error? }
  const [profileStatus, setProfileStatus] = useState('active'); // active | archived
  const [scoreStats, setScoreStats] = useState<any>(null);    // ?view=stats for the selected profile
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null);
  const [dimEditId, setDimEditId] = useState<string | null>(null);      // profile id whose dimensions are being managed
  const [manageDims, setManageDims] = useState<ScoringDimension[]>([]);      // editable copy of that profile's dimensions
  const [newDim, setNewDim] = useState<NewDimState>({ name: '', data_source: 'duration_ms', weight: 0.25 });
  const [dimBusy, setDimBusy] = useState(false);

  // --- Create Profile Form State --------------------------
  const [newProfile, setNewProfile] = useState<NewProfileState>({
    name: '', description: '', action_type: '', composite_method: 'weighted_average',
    dimensions: [{ name: '', data_source: 'duration_ms', weight: 0.25, scale: [], data_config: {} }],
  });

  // --- Create Risk Template Form State --------------------
  const [newTemplate, setNewTemplate] = useState<NewTemplateState>({
    name: '', description: '', action_type: '', base_risk: 20,
    rules: [{ condition: '', add: 10 }],
  });

  // --- Calibrate Form State -------------------------------
  const [calibrateForm, setCalibrateForm] = useState<CalibrateFormState>({
    action_type: '', lookback_days: 30, agent_id: '', metrics: [...CALIBRATE_METRICS],
  });

  const fetchProfiles = useCallback(async () => {
    try {
      if (isDemoMode()) {
        setProfiles(demoScoringProfiles);
        return;
      }
      const qs = profileStatus === 'active' ? '' : `?status=${profileStatus}`;
      const res = await fetch(`/api/scoring/profiles${qs}`);
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles || []);
      }
    } catch (err) { console.error('Failed to fetch profiles:', err); }
  }, [profileStatus]);

  const fetchRiskTemplates = useCallback(async () => {
    try {
      if (isDemoMode()) {
        setRiskTemplates(demoRiskTemplates);
        return;
      }
      const res = await fetch('/api/scoring/risk-templates');
      if (res.ok) {
        const data = await res.json();
        setRiskTemplates(data.templates || []);
      }
    } catch (err) { console.error('Failed to fetch templates:', err); }
  }, []);

  const fetchScores = useCallback(async (profileId?: string) => {
    try {
      if (isDemoMode()) {
        await new Promise(r => setTimeout(r, 400));
        setScores(demoScoringScores);
        setScoreStats(null);
        return;
      }
      const url = profileId
        ? `/api/scoring/score?profile_id=${profileId}&limit=50`
        : '/api/scoring/score?limit=50';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setScores(data.scores || []);
      }
      if (profileId) {
        const statsRes = await fetch(`/api/scoring/score?view=stats&profile_id=${profileId}`);
        if (statsRes.ok) setScoreStats(await statsRes.json());
      } else {
        setScoreStats(null);
      }
    } catch (err) { console.error('Failed to fetch scores:', err); }
  }, []);

  useEffect(() => {
    Promise.all([fetchProfiles(), fetchRiskTemplates(), fetchScores()]).then(() => setLoading(false));
  }, [fetchProfiles, fetchRiskTemplates, fetchScores]);

  // --- Handlers -------------------------------------------

  const handleCreateProfile = async () => {
    const payload = {
      ...newProfile,
      action_type: newProfile.action_type || null,
      dimensions: newProfile.dimensions.filter(d => d.name && d.data_source),
    };
    const res = await fetch('/api/scoring/profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (res.ok) {
      setShowCreate(false);
      setNewProfile({ name: '', description: '', action_type: '', composite_method: 'weighted_average', dimensions: [{ name: '', data_source: 'duration_ms', weight: 0.25, scale: [], data_config: {} }] });
      fetchProfiles();
    }
  };

  const handleCreateTemplate = async () => {
    const payload = {
      ...newTemplate,
      action_type: newTemplate.action_type || null,
      rules: newTemplate.rules.filter(r => r.condition),
    };
    const res = await fetch('/api/scoring/risk-templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (res.ok) {
      setNewTemplate({ name: '', description: '', action_type: '', base_risk: 20, rules: [{ condition: '', add: 10 }] });
      fetchRiskTemplates();
    }
  };

  const handleCalibrate = async () => {
    if (isDemoMode()) {
      setCalibration(null);
      await new Promise(r => setTimeout(r, 1200));
      setCalibration(demoCalibration);
      return;
    }
    setCalibration(null);
    const res = await fetch('/api/scoring/calibrate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_type: calibrateForm.action_type || null,
        agent_id: calibrateForm.agent_id || null,
        lookback_days: calibrateForm.lookback_days,
        metrics: calibrateForm.metrics.length ? calibrateForm.metrics : undefined,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setCalibration(data);
    }
  };

  const handleApplyCalibration = async (suggestion: any) => {
    // Create a new profile from calibration suggestion
    const profileName = `Auto: ${suggestion.metric} (${calibrateForm.action_type || 'all actions'})`;
    const payload = {
      name: profileName,
      action_type: calibrateForm.action_type || null,
      composite_method: 'weighted_average',
      dimensions: [{
        name: suggestion.metric.replace(/_/g, ' '),
        data_source: suggestion.data_source,
        weight: suggestion.suggested_weight,
        scale: suggestion.suggested_scale,
      }],
    };
    const res = await fetch('/api/scoring/profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (res.ok) {
      fetchProfiles();
      setActiveTab('Profiles');
    }
  };

  // Run a profile against real ledger actions. Solves "profiles can be built
  // but never run from the UI": fetch recent actions (scoped to the profile's
  // action_type when set) and batch-score them via POST /api/scoring/score.
  const handleScoreRecent = async (profile: ScoringProfile) => {
    setScoringId(profile.id);
    setScoreSummary(null);
    try {
      const at = profile.action_type ? `&action_type=${encodeURIComponent(profile.action_type)}` : '';
      const af = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      const actionsRes = await fetch(`/api/actions?limit=25${at}${af}`);
      const actionsData = await actionsRes.json().catch(() => ({}));
      const actions = actionsData.actions || [];
      if (actions.length === 0) {
        setScoreSummary({ profileId: profile.id, error: 'No recent actions to score.' });
        return;
      }
      const res = await fetch('/api/scoring/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profile.id, actions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScoreSummary({ profileId: profile.id, error: data.error || 'Scoring failed' });
        return;
      }
      setScoreSummary({ profileId: profile.id, summary: data.summary });
      if (selectedProfile?.id === profile.id) fetchScores(profile.id);
    } catch {
      setScoreSummary({ profileId: profile.id, error: 'Scoring failed' });
    } finally {
      setScoringId(null);
    }
  };

  const handleArchiveProfile = async (profileId: string) => {
    await fetch(`/api/scoring/profiles/${profileId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    fetchProfiles();
  };

  const handleDeleteTemplate = async (templateId: string) => {
    await fetch(`/api/scoring/risk-templates/${templateId}`, { method: 'DELETE' });
    fetchRiskTemplates();
  };

  const handleUnarchiveProfile = async (profileId: string) => {
    await fetch(`/api/scoring/profiles/${profileId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    fetchProfiles();
  };

  const handleUpdateTemplate = async () => {
    if (!editTemplateId) return;
    const payload = {
      ...newTemplate,
      action_type: newTemplate.action_type || null,
      rules: newTemplate.rules.filter(r => r.condition),
    };
    const res = await fetch(`/api/scoring/risk-templates/${editTemplateId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (res.ok) {
      setEditTemplateId(null);
      setNewTemplate({ name: '', description: '', action_type: '', base_risk: 20, rules: [{ condition: '', add: 10 }] });
      fetchRiskTemplates();
    }
  };

  // --- Dimension CRUD (post-creation) ---------------------
  // Profiles were only editable at create time; these wire the
  // /profiles/[id]/dimensions[/[dimId]] routes so weights/names/sources
  // can be tuned, added, or removed without rebuilding the profile.
  const openDimEditor = (profile: ScoringProfile) => {
    if (dimEditId === profile.id) { setDimEditId(null); return; }
    setDimEditId(profile.id);
    setManageDims((profile.dimensions || []).map(d => ({ ...d })));
    setNewDim({ name: '', data_source: 'duration_ms', weight: 0.25 });
  };

  const handleSaveDimension = async (profileId: string, dim: ScoringDimension) => {
    setDimBusy(true);
    const res = await fetch(`/api/scoring/profiles/${profileId}/dimensions/${dim.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: dim.name, data_source: dim.data_source, weight: dim.weight }),
    });
    setDimBusy(false);
    if (res.ok) fetchProfiles();
  };

  const handleDeleteDimension = async (profileId: string, dimId: string | undefined) => {
    setDimBusy(true);
    const res = await fetch(`/api/scoring/profiles/${profileId}/dimensions/${dimId}`, { method: 'DELETE' });
    setDimBusy(false);
    if (res.ok) {
      setManageDims(dims => dims.filter(d => d.id !== dimId));
      fetchProfiles();
    }
  };

  const handleAddDimension = async (profileId: string) => {
    if (!newDim.name) return;
    setDimBusy(true);
    const res = await fetch(`/api/scoring/profiles/${profileId}/dimensions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newDim.name, data_source: newDim.data_source, weight: newDim.weight }),
    });
    setDimBusy(false);
    if (res.ok) {
      const created = await res.json().catch(() => null);
      if (created?.id) setManageDims(dims => [...dims, created]);
      setNewDim({ name: '', data_source: 'duration_ms', weight: 0.25 });
      fetchProfiles();
    }
  };

  // --- Score color helper ---------------------------------

  const scoreColor = (score: number): string => {
    if (score >= 80) return 'text-success';
    if (score >= 60) return 'text-warning';
    if (score >= 40) return 'text-brand';
    return 'text-error';
  };

  const scoreBg = (score: number): string => {
    if (score >= 80) return 'bg-success-subtle';
    if (score >= 60) return 'bg-status-warning/20';
    if (score >= 40) return 'bg-brand/20';
    return 'bg-error-subtle';
  };

  // --- Render ---------------------------------------------

  return (
    <PageLayout
      title="Quality"
      subtitle="Define what 'good' means for your agents, then grade real decisions against it — rule-based scoring, no LLM required."
      maturity="stable"
    >
      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 bg-secondary rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-elevated text-white' : 'text-tertiary hover:text-secondary'
            }`}>{tab}</button>
        ))}
      </div>

      {/* -- Profiles Tab ----------------------------------- */}
      {activeTab === 'Profiles' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Scoring Profiles</h2>
              <div className="flex gap-0.5 bg-secondary rounded-lg p-0.5">
                {['active', 'archived'].map(s => (
                  <button key={s} onClick={() => setProfileStatus(s)}
                    className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-colors ${profileStatus === s ? 'bg-elevated text-white' : 'text-tertiary hover:text-secondary'}`}>{s}</button>
                ))}
              </div>
            </div>
            <button onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90">
              {showCreate ? 'Cancel' : 'Create Profile'}
            </button>
          </div>

          {showCreate && (
            <Card className="mb-6 p-4 space-y-4">
              <input value={newProfile.name} onChange={e => setNewProfile(p => ({ ...p, name: e.target.value }))}
                placeholder="Profile name (e.g. 'Production Deploy Quality')"
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
              <input value={newProfile.description} onChange={e => setNewProfile(p => ({ ...p, description: e.target.value }))}
                placeholder="Description (optional)"
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
              <div className="grid grid-cols-2 gap-3">
                <input value={newProfile.action_type} onChange={e => setNewProfile(p => ({ ...p, action_type: e.target.value }))}
                  placeholder="Action type filter (optional)"
                  className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
                <select value={newProfile.composite_method} onChange={e => setNewProfile(p => ({ ...p, composite_method: e.target.value }))}
                  className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white">
                  {COMPOSITE_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}  --  {m.desc}</option>
                  ))}
                </select>
              </div>

              <h4 className="text-sm font-medium text-secondary mt-2">Dimensions</h4>
              {newProfile.dimensions.map((dim, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 items-center">
                  <input value={dim.name} onChange={e => {
                    const dims = [...newProfile.dimensions];
                    dims[i] = { ...(dims[i] as ScoringDimension), name: e.target.value };
                    setNewProfile(p => ({ ...p, dimensions: dims }));
                  }} placeholder="Dimension name" className="px-2 py-1.5 bg-primary border border-border rounded text-sm text-white" />
                  <select value={dim.data_source} onChange={e => {
                    const dims = [...newProfile.dimensions];
                    dims[i] = { ...(dims[i] as ScoringDimension), data_source: e.target.value };
                    setNewProfile(p => ({ ...p, dimensions: dims }));
                  }} className="px-2 py-1.5 bg-primary border border-border rounded text-sm text-white">
                    {DATA_SOURCES.map(ds => <option key={ds.value} value={ds.value}>{ds.label}</option>)}
                  </select>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-tertiary">Weight:</label>
                    <input type="range" min="0" max="1" step="0.05" value={dim.weight}
                      onChange={e => {
                        const dims = [...newProfile.dimensions];
                        dims[i] = { ...(dims[i] as ScoringDimension), weight: parseFloat(e.target.value) };
                        setNewProfile(p => ({ ...p, dimensions: dims }));
                      }} className="flex-1" />
                    <span className="text-xs text-secondary w-8">{dim.weight}</span>
                    <button onClick={() => {
                      const dims = newProfile.dimensions.filter((_, j) => j !== i);
                      setNewProfile(p => ({ ...p, dimensions: dims }));
                    }} className="text-error text-xs hover:text-error">x</button>
                  </div>
                </div>
              ))}
              <button onClick={() => setNewProfile(p => ({
                ...p, dimensions: [...p.dimensions, { name: '', data_source: 'duration_ms', weight: 0.25, scale: [], data_config: {} }],
              }))} className="text-sm text-brand hover:text-brand/80">+ Add dimension</button>

              <p className="text-xs text-tertiary mt-2">
                Tip: Use Auto-Calibrate tab to generate scales from your real data, then copy them here.
              </p>

              <button onClick={handleCreateProfile} disabled={!newProfile.name}
                className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90 disabled:opacity-40">
                Create Profile
              </button>
            </Card>
          )}

          {profiles.length === 0 && !loading && (
            <EmptyState title="No scoring profiles yet" description="Create a profile to define what quality means for your agents." />
          )}

          <div className="space-y-3">
            {profiles.map(profile => (
              <Card key={profile.id} className="p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-white">{profile.name}</h3>
                    {profile.description && <p className="text-sm text-tertiary mt-1">{profile.description}</p>}
                    <div className="flex gap-2 mt-2">
                      {profile.action_type && <Badge variant="info">{profile.action_type}</Badge>}
                      <Badge variant="default">{profile.composite_method?.replace(/_/g, ' ')}</Badge>
                      <Badge variant="default">{(profile.dimensions || []).length} dimensions</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!isDemoMode() && (
                      <button onClick={() => handleScoreRecent(profile)} disabled={scoringId === profile.id}
                        className="text-xs text-brand hover:text-brand/80 disabled:opacity-50">
                        {scoringId === profile.id ? 'Scoring…' : 'Score recent'}
                      </button>
                    )}
                    <button onClick={() => { setSelectedProfile(profile); fetchScores(profile.id); setActiveTab('Score Explorer'); }}
                      className="text-xs text-brand hover:text-brand/80">View Scores</button>
                    {!isDemoMode() && (
                      <button onClick={() => openDimEditor(profile)}
                        className="text-xs text-tertiary hover:text-white">
                        {dimEditId === profile.id ? 'Close' : 'Manage dims'}
                      </button>
                    )}
                    {profile.status === 'archived' ? (
                      <button onClick={() => handleUnarchiveProfile(profile.id)}
                        className="text-xs text-tertiary hover:text-success">Unarchive</button>
                    ) : (
                      <button onClick={() => handleArchiveProfile(profile.id)}
                        className="text-xs text-tertiary hover:text-error">Archive</button>
                    )}
                  </div>
                </div>

                {/* Score-run summary (POST /api/scoring/score) */}
                {scoreSummary?.profileId === profile.id && (
                  <div className="mt-2 text-xs" role="status">
                    {scoreSummary.error ? (
                      <span className="text-error">{scoreSummary.error}</span>
                    ) : (
                      <span className="text-success">
                        Scored {scoreSummary.summary?.scored ?? 0}/{scoreSummary.summary?.total ?? 0} recent actions · avg{' '}
                        {scoreSummary.summary?.avg_score ?? '—'} ·{' '}
                        <button
                          onClick={() => { setSelectedProfile(profile); fetchScores(profile.id); setActiveTab('Score Explorer'); }}
                          className="text-brand hover:text-brand/80"
                        >View →</button>
                      </span>
                    )}
                  </div>
                )}

                {/* Dimension breakdown (read-only) */}
                {dimEditId !== profile.id && profile.dimensions && profile.dimensions.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
                    {profile.dimensions.map(dim => (
                      <div key={dim.id} className="p-2 rounded bg-secondary border border-border">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-secondary">{dim.name}</span>
                          <span className="text-xs text-disabled">{Math.round(dim.weight * 100)}%</span>
                        </div>
                        <div className="w-full bg-elevated rounded-full h-1 mt-1">
                          <div className="bg-brand h-1 rounded-full" style={{ width: `${dim.weight * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Dimension editor (post-creation CRUD) */}
                {dimEditId === profile.id && (
                  <div className="mt-3 border-t border pt-3 space-y-2">
                    <h4 className="text-xs font-medium text-secondary">Manage dimensions</h4>
                    {manageDims.length === 0 && (
                      <p className="text-xs text-tertiary">No dimensions yet — add one below.</p>
                    )}
                    {manageDims.map((dim, i) => (
                      <div key={dim.id} className="grid grid-cols-12 gap-2 items-center">
                        <input value={dim.name} aria-label="Dimension name"
                          onChange={e => setManageDims(ds => ds.map((d, j) => j === i ? { ...d, name: e.target.value } : d))}
                          className="col-span-4 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white" />
                        <select value={dim.data_source} aria-label="Dimension data source"
                          onChange={e => setManageDims(ds => ds.map((d, j) => j === i ? { ...d, data_source: e.target.value } : d))}
                          className="col-span-3 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white">
                          {DATA_SOURCES.map(ds => <option key={ds.value} value={ds.value}>{ds.label}</option>)}
                        </select>
                        <input type="number" min="0" max="1" step="0.05" value={dim.weight} aria-label="Dimension weight"
                          onChange={e => setManageDims(ds => ds.map((d, j) => j === i ? { ...d, weight: parseFloat(e.target.value) || 0 } : d))}
                          className="col-span-2 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white" />
                        <button onClick={() => handleSaveDimension(profile.id, manageDims[i] as ScoringDimension)} disabled={dimBusy || !dim.name}
                          className="col-span-2 text-xs text-brand hover:text-brand/80 disabled:opacity-40">Save</button>
                        <button onClick={() => handleDeleteDimension(profile.id, dim.id)} disabled={dimBusy}
                          className="col-span-1 text-error text-xs hover:text-error disabled:opacity-40" aria-label={`Delete ${dim.name}`}>x</button>
                      </div>
                    ))}
                    <div className="grid grid-cols-12 gap-2 items-center pt-1">
                      <input value={newDim.name} aria-label="New dimension name"
                        onChange={e => setNewDim(d => ({ ...d, name: e.target.value }))}
                        placeholder="New dimension" className="col-span-4 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white" />
                      <select value={newDim.data_source} aria-label="New dimension data source"
                        onChange={e => setNewDim(d => ({ ...d, data_source: e.target.value }))}
                        className="col-span-3 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white">
                        {DATA_SOURCES.map(ds => <option key={ds.value} value={ds.value}>{ds.label}</option>)}
                      </select>
                      <input type="number" min="0" max="1" step="0.05" value={newDim.weight} aria-label="New dimension weight"
                        onChange={e => setNewDim(d => ({ ...d, weight: parseFloat(e.target.value) || 0 }))}
                        className="col-span-2 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white" />
                      <button onClick={() => handleAddDimension(profile.id)} disabled={dimBusy || !newDim.name}
                        className="col-span-3 text-xs text-brand hover:text-brand/80 disabled:opacity-40">+ Add dimension</button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* -- Score Explorer Tab ----------------------------- */}
      {activeTab === 'Score Explorer' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">
            {selectedProfile ? `Scores: ${selectedProfile.name}` : 'Recent Scores (all profiles)'}
          </h2>
          {selectedProfile && scoreStats && (scoreStats.total_scores || 0) > 0 && (
            <div className="mb-4 grid grid-cols-3 md:grid-cols-6 gap-2">
              {[
                { label: 'Scores', value: scoreStats.total_scores },
                { label: 'Avg', value: scoreStats.avg_score ?? '—' },
                { label: 'Min', value: scoreStats.min_score ?? '—' },
                { label: 'Max', value: scoreStats.max_score ?? '—' },
                { label: 'Std dev', value: scoreStats.stddev_score ?? '—' },
                { label: 'Agents', value: scoreStats.unique_agents ?? '—' },
              ].map(s => (
                <div key={s.label} className="p-2 rounded bg-secondary border border-border text-center">
                  <div className="text-sm font-semibold text-white tabular-nums">{s.value}</div>
                  <div className="text-[10px] text-tertiary">{s.label}</div>
                </div>
              ))}
            </div>
          )}
          {scores.length === 0 && <EmptyState title="No scores yet" description="Score actions against a profile to see results here." />}
          <div className="space-y-2">
            {scores.map(score => (
              <Card key={score.id} className="p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-sm text-secondary">{score.profile_name || score.profile_id}</span>
                    {score.action_id && <span className="text-xs text-disabled ml-2">{score.action_id}</span>}
                  </div>
                  <div className={`text-2xl font-bold ${scoreColor(score.composite_score)}`}>
                    {score.composite_score}
                  </div>
                </div>
                {/* Dimension bars */}
                {score.dimension_scores && (
                  <div className="mt-2 space-y-1">
                    {score.dimension_scores.map((ds, i) => (
                      <div key={i}>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-tertiary w-24 truncate">{ds.dimension_name}</span>
                          <div className="flex-1 bg-secondary rounded-full h-2">
                            <div className={`h-2 rounded-full ${scoreBg(ds.score || 0)}`}
                              style={{ width: `${ds.score || 0}%` }} />
                          </div>
                          <span className={`w-8 text-right ${scoreColor(ds.score || 0)}`}>{ds.score ?? '-'}</span>
                          <Badge variant={ds.label === 'excellent' ? 'success' : ds.label === 'good' ? 'info' : ds.label === 'poor' ? 'error' : 'default'}>
                            {ds.label}
                          </Badge>
                        </div>
                        {(ds.raw_value != null || ds.weight != null) && (
                          <div className="ml-[6.5rem] mt-0.5 text-[10px] text-disabled tabular-nums">
                            {ds.raw_value != null && <>raw {typeof ds.raw_value === 'number' ? Math.round(ds.raw_value * 100) / 100 : ds.raw_value}</>}
                            {ds.weight != null && <> · weight {Math.round(ds.weight * 100)}%</>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* -- Risk Templates Tab ----------------------------- */}
      {activeTab === 'Risk Templates' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Risk Templates</h2>
          <p className="text-sm text-secondary mb-4">
            Define rules for automatic risk scoring. Instead of agents hardcoding a number,
            DashClaw computes risk based on action properties matching your rules.
          </p>
          <p className="text-sm text-secondary mb-4 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2">
            Active templates apply to live guard evaluations: a matching template&apos;s score is
            folded into each decision&apos;s effective risk (it can raise, never lower it) and shows
            up in the decision&apos;s risk derivation as <span className="font-mono text-xs">template:&lt;name&gt;</span>.
            Changes take effect within seconds.
          </p>

          <Card className="mb-6 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-secondary">{editTemplateId ? 'Edit Risk Template' : 'Create Risk Template'}</h3>
              {editTemplateId && (
                <button onClick={() => { setEditTemplateId(null); setNewTemplate({ name: '', description: '', action_type: '', base_risk: 20, rules: [{ condition: '', add: 10 }] }); }}
                  className="text-xs text-tertiary hover:text-white">Cancel edit</button>
              )}
            </div>
            <input value={newTemplate.name} onChange={e => setNewTemplate(t => ({ ...t, name: e.target.value }))}
              placeholder="Template name (e.g. 'Production Safety')"
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
            <div className="grid grid-cols-2 gap-3">
              <input value={newTemplate.action_type} onChange={e => setNewTemplate(t => ({ ...t, action_type: e.target.value }))}
                placeholder="Action type (optional)"
                className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
              <div className="flex items-center gap-2">
                <label className="text-xs text-tertiary">Base risk:</label>
                <input type="number" min="0" max="100" value={newTemplate.base_risk}
                  onChange={e => setNewTemplate(t => ({ ...t, base_risk: parseInt(e.target.value) || 0 }))}
                  className="w-20 px-2 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
              </div>
            </div>

            <h4 className="text-xs font-medium text-secondary mt-2">Rules (condition -&gt; add risk)</h4>
            {newTemplate.rules.map((rule, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={rule.condition} onChange={e => {
                  const rules = [...newTemplate.rules];
                  rules[i] = { ...(rules[i] as RiskRule), condition: e.target.value };
                  setNewTemplate(t => ({ ...t, rules }));
                }} placeholder="e.g. metadata.environment == 'production'"
                  className="flex-1 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white font-mono" />
                <span className="text-xs text-tertiary">+</span>
                <input type="number" value={rule.add} onChange={e => {
                  const rules = [...newTemplate.rules];
                  rules[i] = { ...(rules[i] as RiskRule), add: parseInt(e.target.value) || 0 };
                  setNewTemplate(t => ({ ...t, rules }));
                }} className="w-16 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white text-center" />
                <button onClick={() => setNewTemplate(t => ({ ...t, rules: t.rules.filter((_, j) => j !== i) }))}
                  className="text-error text-xs hover:text-error">x</button>
              </div>
            ))}
            <button onClick={() => setNewTemplate(t => ({ ...t, rules: [...t.rules, { condition: '', add: 10 }] }))}
              className="text-sm text-brand hover:text-brand/80">+ Add rule</button>

            <button onClick={editTemplateId ? handleUpdateTemplate : handleCreateTemplate} disabled={!newTemplate.name}
              className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90 disabled:opacity-40">
              {editTemplateId ? 'Save changes' : 'Create Template'}
            </button>
          </Card>

          {riskTemplates.length === 0 && <EmptyState title="No risk templates" description="Create templates to replace hardcoded agent risk scores." />}

          <div className="space-y-2">
            {riskTemplates.map(tmpl => (
              <Card key={tmpl.id} className="p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-sm font-medium text-white">{tmpl.name}</h3>
                    <div className="flex gap-2 mt-1">
                      {tmpl.action_type && <Badge variant="info">{tmpl.action_type}</Badge>}
                      <Badge variant="default">Base: {tmpl.base_risk}</Badge>
                      <Badge variant="default">{(tmpl.rules || []).length} rules</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditTemplateId(tmpl.id); setNewTemplate({ name: tmpl.name, description: tmpl.description || '', action_type: tmpl.action_type || '', base_risk: tmpl.base_risk ?? 20, rules: (tmpl.rules && tmpl.rules.length) ? tmpl.rules.map(r => ({ condition: r.condition, add: r.add })) : [{ condition: '', add: 10 }] }); }}
                      className="text-xs text-tertiary hover:text-white">Edit</button>
                    <button onClick={() => handleDeleteTemplate(tmpl.id)}
                      className="text-xs text-tertiary hover:text-error">Delete</button>
                  </div>
                </div>
                {tmpl.rules && tmpl.rules.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {tmpl.rules.map((rule, i) => (
                      <div key={i} className="text-xs text-tertiary font-mono">
                        if <span className="text-secondary">{rule.condition}</span> -&gt; <span className="text-brand">+{rule.add}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* -- Calibrate Tab ---------------------------------- */}
      {activeTab === 'Calibrate' && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Auto-Calibration</h2>
          <p className="text-sm text-secondary mb-4">
            Analyze your historical action data to generate suggested scoring scales.
            Based on percentile analysis of your real data  --  no LLM involved.
          </p>

          <Card className="mb-6 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input value={calibrateForm.action_type}
                onChange={e => setCalibrateForm(f => ({ ...f, action_type: e.target.value }))}
                placeholder="Action type (optional, blank = all)"
                className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
              <div className="flex items-center gap-2">
                <label className="text-xs text-tertiary">Lookback:</label>
                <input type="number" value={calibrateForm.lookback_days}
                  onChange={e => setCalibrateForm(f => ({ ...f, lookback_days: parseInt(e.target.value) || 30 }))}
                  className="w-20 px-2 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
                <span className="text-xs text-tertiary">days</span>
              </div>
            </div>
            <input value={calibrateForm.agent_id}
              onChange={e => setCalibrateForm(f => ({ ...f, agent_id: e.target.value }))}
              placeholder="Agent ID (optional, blank = all agents)"
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
            <div>
              <label className="text-xs text-tertiary">Metrics to analyze:</label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {CALIBRATE_METRICS.map(m => {
                  const on = calibrateForm.metrics.includes(m);
                  return (
                    <button key={m} type="button"
                      onClick={() => setCalibrateForm(f => ({
                        ...f, metrics: on ? f.metrics.filter(x => x !== m) : [...f.metrics, m],
                      }))}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        on ? 'bg-brand text-black' : 'bg-secondary text-tertiary hover:text-secondary'
                      }`}>{m.replace(/_/g, ' ')}</button>
                  );
                })}
              </div>
            </div>
            <button onClick={handleCalibrate}
              className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90">
              Analyze Data
            </button>
          </Card>

          {calibration && calibration.status === 'insufficient_data' && (
            <Card className="p-4">
              <p className="text-sm text-warning">{calibration.message}</p>
            </Card>
          )}

          {calibration && calibration.status === 'ok' && (
            <div className="space-y-4">
              <p className="text-sm text-secondary">
                Analyzed <span className="text-white font-medium">{calibration.count}</span> actions
                over the last {calibration.lookback_days} days
                {calibration.action_type !== '(all)' && ` for type "${calibration.action_type}"`}.
              </p>

              {calibration.suggestions.map((s: any, i: number) => (
                <Card key={i} className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-sm font-medium text-white">{s.metric.replace(/_/g, ' ')}</h3>
                      <p className="text-xs text-tertiary mt-1">
                        {s.sample_size} data points * {s.lower_is_better ? 'Lower is better' : 'Higher is better'}
                      </p>
                    </div>
                    <button onClick={() => handleApplyCalibration(s)}
                      className="text-xs text-brand hover:text-brand/80">Apply as Profile</button>
                  </div>

                  {/* Distribution visualization */}
                  <div className="mt-3 flex items-center gap-1 text-xs">
                    <span className="text-disabled w-16">min: {s.distribution.min}</span>
                    <div className="flex-1 h-6 bg-secondary rounded relative overflow-hidden">
                      <div className="absolute inset-y-0 bg-error-subtle" style={{
                        left: '0%', width: `${((s.distribution.p25 - s.distribution.min) / (s.distribution.max - s.distribution.min)) * 100}%`
                      }} />
                      <div className="absolute inset-y-0 bg-status-warning/20" style={{
                        left: `${((s.distribution.p25 - s.distribution.min) / (s.distribution.max - s.distribution.min)) * 100}%`,
                        width: `${((s.distribution.p75 - s.distribution.p25) / (s.distribution.max - s.distribution.min)) * 100}%`
                      }} />
                      <div className="absolute inset-y-0 bg-success-subtle" style={{
                        left: `${((s.distribution.p75 - s.distribution.min) / (s.distribution.max - s.distribution.min)) * 100}%`,
                        width: `${((s.distribution.max - s.distribution.p75) / (s.distribution.max - s.distribution.min)) * 100}%`
                      }} />
                    </div>
                    <span className="text-disabled w-16 text-right">max: {s.distribution.max}</span>
                  </div>

                  {/* Suggested scale */}
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {s.suggested_scale.map((rule: any, j: number) => (
                      <div key={j} className={`p-2 rounded text-center ${
                        rule.label === 'excellent' ? 'bg-success-subtle text-success' :
                        rule.label === 'good' ? 'bg-info-subtle text-info' :
                        rule.label === 'acceptable' ? 'bg-status-warning/10 text-warning' :
                        'bg-error-subtle text-error'
                      }`}>
                        <div className="text-xs font-medium">{rule.label}</div>
                        <div className="text-xs mt-0.5">{rule.operator} {
                          Array.isArray(rule.value) ? rule.value.join('-') : rule.value
                        }</div>
                        <div className="text-xs text-tertiary">score: {rule.score}</div>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-disabled mt-2">
                    Suggested weight: {s.suggested_weight}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
