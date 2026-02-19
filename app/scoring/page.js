'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '../components/PageLayout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';

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

export default function ScoringPage() {
  const [activeTab, setActiveTab] = useState('Profiles');
  const [profiles, setProfiles] = useState([]);
  const [riskTemplates, setRiskTemplates] = useState([]);
  const [scores, setScores] = useState([]);
  const [calibration, setCalibration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);

  // --- Create Profile Form State --------------------------
  const [newProfile, setNewProfile] = useState({
    name: '', description: '', action_type: '', composite_method: 'weighted_average',
    dimensions: [{ name: '', data_source: 'duration_ms', weight: 0.25, scale: [], data_config: {} }],
  });

  // --- Create Risk Template Form State --------------------
  const [newTemplate, setNewTemplate] = useState({
    name: '', description: '', action_type: '', base_risk: 20,
    rules: [{ condition: '', add: 10 }],
  });

  // --- Calibrate Form State -------------------------------
  const [calibrateForm, setCalibrateForm] = useState({
    action_type: '', lookback_days: 30,
  });

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/scoring/profiles');
      if (res.ok) {
        const data = await res.json();
        setProfiles(data.profiles || []);
      }
    } catch (err) { console.error('Failed to fetch profiles:', err); }
  }, []);

  const fetchRiskTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/scoring/risk-templates');
      if (res.ok) {
        const data = await res.json();
        setRiskTemplates(data.templates || []);
      }
    } catch (err) { console.error('Failed to fetch templates:', err); }
  }, []);

  const fetchScores = useCallback(async (profileId) => {
    try {
      const url = profileId
        ? `/api/scoring/score?profile_id=${profileId}&limit=50`
        : '/api/scoring/score?limit=50';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setScores(data.scores || []);
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
    setCalibration(null);
    const res = await fetch('/api/scoring/calibrate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_type: calibrateForm.action_type || null,
        lookback_days: calibrateForm.lookback_days,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setCalibration(data);
    }
  };

  const handleApplyCalibration = async (suggestion) => {
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

  const handleArchiveProfile = async (profileId) => {
    await fetch(`/api/scoring/profiles/${profileId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    fetchProfiles();
  };

  const handleDeleteTemplate = async (templateId) => {
    await fetch(`/api/scoring/risk-templates/${templateId}`, { method: 'DELETE' });
    fetchRiskTemplates();
  };

  // --- Score color helper ---------------------------------

  const scoreColor = (score) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-yellow-400';
    if (score >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

  const scoreBg = (score) => {
    if (score >= 80) return 'bg-emerald-500/20';
    if (score >= 60) return 'bg-yellow-500/20';
    if (score >= 40) return 'bg-orange-500/20';
    return 'bg-red-500/20';
  };

  // --- Render ---------------------------------------------

  return (
    <PageLayout
      title="Scoring Profiles"
      description="Define what 'good' means for your agents with weighted multi-dimensional scoring."
    >
      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 bg-[#111] rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-[#222] text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}>{tab}</button>
        ))}
      </div>

      {/* -- Profiles Tab ----------------------------------- */}
      {activeTab === 'Profiles' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Scoring Profiles</h2>
            <button onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90">
              {showCreate ? 'Cancel' : 'Create Profile'}
            </button>
          </div>

          {showCreate && (
            <Card className="mb-6 p-4 space-y-4">
              <input value={newProfile.name} onChange={e => setNewProfile(p => ({ ...p, name: e.target.value }))}
                placeholder="Profile name (e.g. 'Production Deploy Quality')"
                className="w-full px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
              <input value={newProfile.description} onChange={e => setNewProfile(p => ({ ...p, description: e.target.value }))}
                placeholder="Description (optional)"
                className="w-full px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
              <div className="grid grid-cols-2 gap-3">
                <input value={newProfile.action_type} onChange={e => setNewProfile(p => ({ ...p, action_type: e.target.value }))}
                  placeholder="Action type filter (optional)"
                  className="px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
                <select value={newProfile.composite_method} onChange={e => setNewProfile(p => ({ ...p, composite_method: e.target.value }))}
                  className="px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white">
                  {COMPOSITE_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}  --  {m.desc}</option>
                  ))}
                </select>
              </div>

              <h4 className="text-sm font-medium text-zinc-300 mt-2">Dimensions</h4>
              {newProfile.dimensions.map((dim, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 items-center">
                  <input value={dim.name} onChange={e => {
                    const dims = [...newProfile.dimensions];
                    dims[i] = { ...dims[i], name: e.target.value };
                    setNewProfile(p => ({ ...p, dimensions: dims }));
                  }} placeholder="Dimension name" className="px-2 py-1.5 bg-[#0a0a0a] border border-[rgba(255,255,255,0.06)] rounded text-sm text-white" />
                  <select value={dim.data_source} onChange={e => {
                    const dims = [...newProfile.dimensions];
                    dims[i] = { ...dims[i], data_source: e.target.value };
                    setNewProfile(p => ({ ...p, dimensions: dims }));
                  }} className="px-2 py-1.5 bg-[#0a0a0a] border border-[rgba(255,255,255,0.06)] rounded text-sm text-white">
                    {DATA_SOURCES.map(ds => <option key={ds.value} value={ds.value}>{ds.label}</option>)}
                  </select>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-zinc-500">Weight:</label>
                    <input type="range" min="0" max="1" step="0.05" value={dim.weight}
                      onChange={e => {
                        const dims = [...newProfile.dimensions];
                        dims[i] = { ...dims[i], weight: parseFloat(e.target.value) };
                        setNewProfile(p => ({ ...p, dimensions: dims }));
                      }} className="flex-1" />
                    <span className="text-xs text-zinc-400 w-8">{dim.weight}</span>
                    <button onClick={() => {
                      const dims = newProfile.dimensions.filter((_, j) => j !== i);
                      setNewProfile(p => ({ ...p, dimensions: dims }));
                    }} className="text-red-400 text-xs hover:text-red-300">x</button>
                  </div>
                </div>
              ))}
              <button onClick={() => setNewProfile(p => ({
                ...p, dimensions: [...p.dimensions, { name: '', data_source: 'duration_ms', weight: 0.25, scale: [], data_config: {} }],
              }))} className="text-sm text-brand hover:text-brand/80">+ Add dimension</button>

              <p className="text-xs text-zinc-500 mt-2">
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
                    {profile.description && <p className="text-sm text-zinc-500 mt-1">{profile.description}</p>}
                    <div className="flex gap-2 mt-2">
                      {profile.action_type && <Badge color="blue">{profile.action_type}</Badge>}
                      <Badge color="zinc">{profile.composite_method?.replace(/_/g, ' ')}</Badge>
                      <Badge color="zinc">{(profile.dimensions || []).length} dimensions</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setSelectedProfile(profile); fetchScores(profile.id); setActiveTab('Score Explorer'); }}
                      className="text-xs text-brand hover:text-brand/80">View Scores</button>
                    <button onClick={() => handleArchiveProfile(profile.id)}
                      className="text-xs text-zinc-500 hover:text-red-400">Archive</button>
                  </div>
                </div>

                {/* Dimension breakdown */}
                {profile.dimensions && profile.dimensions.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2">
                    {profile.dimensions.map(dim => (
                      <div key={dim.id} className="p-2 rounded bg-[#111] border border-[rgba(255,255,255,0.04)]">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-zinc-300">{dim.name}</span>
                          <span className="text-xs text-zinc-600">{Math.round(dim.weight * 100)}%</span>
                        </div>
                        <div className="w-full bg-[#222] rounded-full h-1 mt-1">
                          <div className="bg-brand h-1 rounded-full" style={{ width: `${dim.weight * 100}%` }} />
                        </div>
                      </div>
                    ))}
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
          {scores.length === 0 && <EmptyState title="No scores yet" description="Score actions against a profile to see results here." />}
          <div className="space-y-2">
            {scores.map(score => (
              <Card key={score.id} className="p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-sm text-zinc-400">{score.profile_name || score.profile_id}</span>
                    {score.action_id && <span className="text-xs text-zinc-600 ml-2">{score.action_id}</span>}
                  </div>
                  <div className={`text-2xl font-bold ${scoreColor(score.composite_score)}`}>
                    {score.composite_score}
                  </div>
                </div>
                {/* Dimension bars */}
                {score.dimension_scores && (
                  <div className="mt-2 space-y-1">
                    {score.dimension_scores.map((ds, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-zinc-500 w-24 truncate">{ds.dimension_name}</span>
                        <div className="flex-1 bg-[#111] rounded-full h-2">
                          <div className={`h-2 rounded-full ${scoreBg(ds.score || 0)}`}
                            style={{ width: `${ds.score || 0}%` }} />
                        </div>
                        <span className={`w-8 text-right ${scoreColor(ds.score || 0)}`}>{ds.score ?? '-'}</span>
                        <Badge color={ds.label === 'excellent' ? 'green' : ds.label === 'good' ? 'blue' : ds.label === 'poor' ? 'red' : 'zinc'}>
                          {ds.label}
                        </Badge>
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
          <p className="text-sm text-zinc-400 mb-4">
            Define rules for automatic risk scoring. Instead of agents hardcoding a number,
            DashClaw computes risk based on action properties matching your rules.
          </p>

          <Card className="mb-6 p-4 space-y-3">
            <h3 className="text-sm font-medium text-zinc-300">Create Risk Template</h3>
            <input value={newTemplate.name} onChange={e => setNewTemplate(t => ({ ...t, name: e.target.value }))}
              placeholder="Template name (e.g. 'Production Safety')"
              className="w-full px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
            <div className="grid grid-cols-2 gap-3">
              <input value={newTemplate.action_type} onChange={e => setNewTemplate(t => ({ ...t, action_type: e.target.value }))}
                placeholder="Action type (optional)"
                className="px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Base risk:</label>
                <input type="number" min="0" max="100" value={newTemplate.base_risk}
                  onChange={e => setNewTemplate(t => ({ ...t, base_risk: parseInt(e.target.value) || 0 }))}
                  className="w-20 px-2 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
              </div>
            </div>

            <h4 className="text-xs font-medium text-zinc-400 mt-2">Rules (condition -&gt; add risk)</h4>
            {newTemplate.rules.map((rule, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={rule.condition} onChange={e => {
                  const rules = [...newTemplate.rules];
                  rules[i] = { ...rules[i], condition: e.target.value };
                  setNewTemplate(t => ({ ...t, rules }));
                }} placeholder="e.g. metadata.environment == 'production'"
                  className="flex-1 px-2 py-1.5 bg-[#0a0a0a] border border-[rgba(255,255,255,0.06)] rounded text-sm text-white font-mono" />
                <span className="text-xs text-zinc-500">+</span>
                <input type="number" value={rule.add} onChange={e => {
                  const rules = [...newTemplate.rules];
                  rules[i] = { ...rules[i], add: parseInt(e.target.value) || 0 };
                  setNewTemplate(t => ({ ...t, rules }));
                }} className="w-16 px-2 py-1.5 bg-[#0a0a0a] border border-[rgba(255,255,255,0.06)] rounded text-sm text-white text-center" />
                <button onClick={() => setNewTemplate(t => ({ ...t, rules: t.rules.filter((_, j) => j !== i) }))}
                  className="text-red-400 text-xs hover:text-red-300">x</button>
              </div>
            ))}
            <button onClick={() => setNewTemplate(t => ({ ...t, rules: [...t.rules, { condition: '', add: 10 }] }))}
              className="text-sm text-brand hover:text-brand/80">+ Add rule</button>

            <button onClick={handleCreateTemplate} disabled={!newTemplate.name}
              className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90 disabled:opacity-40">
              Create Template
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
                      {tmpl.action_type && <Badge color="blue">{tmpl.action_type}</Badge>}
                      <Badge color="zinc">Base: {tmpl.base_risk}</Badge>
                      <Badge color="zinc">{(tmpl.rules || []).length} rules</Badge>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteTemplate(tmpl.id)}
                    className="text-xs text-zinc-500 hover:text-red-400">Delete</button>
                </div>
                {tmpl.rules && tmpl.rules.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {tmpl.rules.map((rule, i) => (
                      <div key={i} className="text-xs text-zinc-500 font-mono">
                        if <span className="text-zinc-300">{rule.condition}</span> -&gt; <span className="text-orange-400">+{rule.add}</span>
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
          <p className="text-sm text-zinc-400 mb-4">
            Analyze your historical action data to generate suggested scoring scales.
            Based on percentile analysis of your real data  --  no LLM involved.
          </p>

          <Card className="mb-6 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input value={calibrateForm.action_type}
                onChange={e => setCalibrateForm(f => ({ ...f, action_type: e.target.value }))}
                placeholder="Action type (optional, blank = all)"
                className="px-3 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Lookback:</label>
                <input type="number" value={calibrateForm.lookback_days}
                  onChange={e => setCalibrateForm(f => ({ ...f, lookback_days: parseInt(e.target.value) || 30 }))}
                  className="w-20 px-2 py-2 bg-[#111] border border-[rgba(255,255,255,0.1)] rounded-lg text-sm text-white" />
                <span className="text-xs text-zinc-500">days</span>
              </div>
            </div>
            <button onClick={handleCalibrate}
              className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90">
              Analyze Data
            </button>
          </Card>

          {calibration && calibration.status === 'insufficient_data' && (
            <Card className="p-4">
              <p className="text-sm text-yellow-400">{calibration.message}</p>
            </Card>
          )}

          {calibration && calibration.status === 'ok' && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Analyzed <span className="text-white font-medium">{calibration.count}</span> actions
                over the last {calibration.lookback_days} days
                {calibration.action_type !== '(all)' && ` for type "${calibration.action_type}"`}.
              </p>

              {calibration.suggestions.map((s, i) => (
                <Card key={i} className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-sm font-medium text-white">{s.metric.replace(/_/g, ' ')}</h3>
                      <p className="text-xs text-zinc-500 mt-1">
                        {s.sample_size} data points * {s.lower_is_better ? 'Lower is better' : 'Higher is better'}
                      </p>
                    </div>
                    <button onClick={() => handleApplyCalibration(s)}
                      className="text-xs text-brand hover:text-brand/80">Apply as Profile</button>
                  </div>

                  {/* Distribution visualization */}
                  <div className="mt-3 flex items-center gap-1 text-xs">
                    <span className="text-zinc-600 w-16">min: {s.distribution.min}</span>
                    <div className="flex-1 h-6 bg-[#111] rounded relative overflow-hidden">
                      <div className="absolute inset-y-0 bg-red-500/20" style={{
                        left: '0%', width: `${((s.distribution.p25 - s.distribution.min) / (s.distribution.max - s.distribution.min)) * 100}%`
                      }} />
                      <div className="absolute inset-y-0 bg-yellow-500/20" style={{
                        left: `${((s.distribution.p25 - s.distribution.min) / (s.distribution.max - s.distribution.min)) * 100}%`,
                        width: `${((s.distribution.p75 - s.distribution.p25) / (s.distribution.max - s.distribution.min)) * 100}%`
                      }} />
                      <div className="absolute inset-y-0 bg-emerald-500/20" style={{
                        left: `${((s.distribution.p75 - s.distribution.min) / (s.distribution.max - s.distribution.min)) * 100}%`,
                        width: `${((s.distribution.max - s.distribution.p75) / (s.distribution.max - s.distribution.min)) * 100}%`
                      }} />
                    </div>
                    <span className="text-zinc-600 w-16 text-right">max: {s.distribution.max}</span>
                  </div>

                  {/* Suggested scale */}
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {s.suggested_scale.map((rule, j) => (
                      <div key={j} className={`p-2 rounded text-center ${
                        rule.label === 'excellent' ? 'bg-emerald-500/10 text-emerald-400' :
                        rule.label === 'good' ? 'bg-blue-500/10 text-blue-400' :
                        rule.label === 'acceptable' ? 'bg-yellow-500/10 text-yellow-400' :
                        'bg-red-500/10 text-red-400'
                      }`}>
                        <div className="text-xs font-medium">{rule.label}</div>
                        <div className="text-xs mt-0.5">{rule.operator} {
                          Array.isArray(rule.value) ? rule.value.join('-') : rule.value
                        }</div>
                        <div className="text-xs text-zinc-500">score: {rule.score}</div>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-zinc-600 mt-2">
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
