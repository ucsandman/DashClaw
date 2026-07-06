'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card } from '../components/ui/Card';
import { isDemoMode } from '../lib/isDemoMode';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { demoScoringProfiles, demoRiskTemplates, demoScoringScores, demoCalibration } from '../lib/demoScoringData';
import {
  CALIBRATE_METRICS,
  type ScoringDimension, type ScoringProfile, type RiskTemplate, type ScoreRecord,
  type NewProfileState, type NewTemplateState, type CalibrateFormState,
  type NewDimState, type ScoreSummaryState,
} from './_components/types';
import ProfilesTab from './_components/ProfilesTab';
import ScoreExplorerTab from './_components/ScoreExplorerTab';
import RiskTemplatesTab from './_components/RiskTemplatesTab';
import CalibrateTab from './_components/CalibrateTab';

const TABS = ['Profiles', 'Score Explorer', 'Risk Templates', 'Calibrate'];

export default function ScoringPage() {
  const { agentId } = useAgentFilter();
  const [activeTab, setActiveTab] = useState('Profiles');
  const [profiles, setProfiles] = useState<ScoringProfile[]>([]);
  const [riskTemplates, setRiskTemplates] = useState<RiskTemplate[]>([]);
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [calibration, setCalibration] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Mutation failures used to be SILENT (no res.ok checks) — the form just sat
  // there. Every mutation now reports here.
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
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

  // Shared mutation wrapper: read res.ok, surface the failure.
  const reportFailure = async (res: Response | null, fallback: string) => {
    if (res?.ok) return false;
    const data = res ? await res.json().catch(() => ({})) : {};
    setMutationError((data as { error?: string }).error || fallback);
    return true;
  };

  const handleCreateProfile = async () => {
    setMutationError(null);
    const payload = {
      ...newProfile,
      action_type: newProfile.action_type || null,
      dimensions: newProfile.dimensions.filter(d => d.name && d.data_source),
    };
    try {
      const res = await fetch('/api/scoring/profiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (await reportFailure(res, 'Failed to create profile.')) return;
      setShowCreate(false);
      setNewProfile({ name: '', description: '', action_type: '', composite_method: 'weighted_average', dimensions: [{ name: '', data_source: 'duration_ms', weight: 0.25, scale: [], data_config: {} }] });
      fetchProfiles();
    } catch { setMutationError('Failed to create profile.'); }
  };

  const handleSeedDefaults = async () => {
    setMutationError(null);
    setSeeding(true);
    try {
      const res = await fetch('/api/scoring/profiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed_defaults: true }),
      });
      if (await reportFailure(res, 'Failed to load starter profiles.')) return;
      fetchProfiles();
      fetchRiskTemplates();
      fetchScores();
    } catch { setMutationError('Failed to load starter profiles.'); }
    finally { setSeeding(false); }
  };

  const handleCreateTemplate = async () => {
    setMutationError(null);
    const payload = {
      ...newTemplate,
      action_type: newTemplate.action_type || null,
      rules: newTemplate.rules.filter(r => r.condition),
    };
    try {
      const res = await fetch('/api/scoring/risk-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (await reportFailure(res, 'Failed to create template.')) return;
      setNewTemplate({ name: '', description: '', action_type: '', base_risk: 20, rules: [{ condition: '', add: 10 }] });
      fetchRiskTemplates();
    } catch { setMutationError('Failed to create template.'); }
  };

  const handleCalibrate = async () => {
    if (isDemoMode()) {
      setCalibration(null);
      await new Promise(r => setTimeout(r, 1200));
      setCalibration(demoCalibration);
      return;
    }
    setCalibration(null);
    setMutationError(null);
    try {
      const res = await fetch('/api/scoring/calibrate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: calibrateForm.action_type || null,
          agent_id: calibrateForm.agent_id || null,
          lookback_days: calibrateForm.lookback_days,
          metrics: calibrateForm.metrics.length ? calibrateForm.metrics : undefined,
        }),
      });
      if (await reportFailure(res, 'Calibration failed.')) return;
      const data = await res.json();
      setCalibration(data);
    } catch { setMutationError('Calibration failed.'); }
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
    setMutationError(null);
    try {
      const res = await fetch('/api/scoring/profiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (await reportFailure(res, 'Failed to apply calibration as a profile.')) return;
      fetchProfiles();
      setActiveTab('Profiles');
    } catch { setMutationError('Failed to apply calibration as a profile.'); }
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
    setMutationError(null);
    try {
      const res = await fetch(`/api/scoring/profiles/${profileId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (await reportFailure(res, 'Failed to archive profile.')) return;
      fetchProfiles();
    } catch { setMutationError('Failed to archive profile.'); }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    setMutationError(null);
    try {
      const res = await fetch(`/api/scoring/risk-templates/${templateId}`, { method: 'DELETE' });
      if (await reportFailure(res, 'Failed to delete template.')) return;
      fetchRiskTemplates();
    } catch { setMutationError('Failed to delete template.'); }
  };

  const handleUnarchiveProfile = async (profileId: string) => {
    setMutationError(null);
    try {
      const res = await fetch(`/api/scoring/profiles/${profileId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (await reportFailure(res, 'Failed to restore profile.')) return;
      fetchProfiles();
    } catch { setMutationError('Failed to restore profile.'); }
  };

  const handleUpdateTemplate = async () => {
    if (!editTemplateId) return;
    setMutationError(null);
    const payload = {
      ...newTemplate,
      action_type: newTemplate.action_type || null,
      rules: newTemplate.rules.filter(r => r.condition),
    };
    try {
      const res = await fetch(`/api/scoring/risk-templates/${editTemplateId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (await reportFailure(res, 'Failed to update template.')) return;
      setEditTemplateId(null);
      setNewTemplate({ name: '', description: '', action_type: '', base_risk: 20, rules: [{ condition: '', add: 10 }] });
      fetchRiskTemplates();
    } catch { setMutationError('Failed to update template.'); }
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
    setMutationError(null);
    try {
      const res = await fetch(`/api/scoring/profiles/${profileId}/dimensions/${dim.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: dim.name, data_source: dim.data_source, weight: dim.weight }),
      });
      if (!(await reportFailure(res, 'Failed to save dimension.'))) fetchProfiles();
    } catch { setMutationError('Failed to save dimension.'); }
    finally { setDimBusy(false); }
  };

  const handleDeleteDimension = async (profileId: string, dimId: string | undefined) => {
    setDimBusy(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/scoring/profiles/${profileId}/dimensions/${dimId}`, { method: 'DELETE' });
      if (!(await reportFailure(res, 'Failed to delete dimension.'))) {
        setManageDims(dims => dims.filter(d => d.id !== dimId));
        fetchProfiles();
      }
    } catch { setMutationError('Failed to delete dimension.'); }
    finally { setDimBusy(false); }
  };

  const handleAddDimension = async (profileId: string) => {
    if (!newDim.name) return;
    setDimBusy(true);
    setMutationError(null);
    try {
      const res = await fetch(`/api/scoring/profiles/${profileId}/dimensions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDim.name, data_source: newDim.data_source, weight: newDim.weight }),
      });
      if (await reportFailure(res, 'Failed to add dimension.')) return;
      const created = await res.json().catch(() => null);
      if (created?.id) setManageDims(dims => [...dims, created]);
      setNewDim({ name: '', data_source: 'duration_ms', weight: 0.25 });
      fetchProfiles();
    } catch { setMutationError('Failed to add dimension.'); }
    finally { setDimBusy(false); }
  };

  const handleViewScores = (profile: ScoringProfile) => {
    setSelectedProfile(profile);
    fetchScores(profile.id);
    setActiveTab('Score Explorer');
  };

  // --- Render ---------------------------------------------

  return (
    <PageLayout
      title="Scoring"
      subtitle="Define what 'good' means for your agents, then grade real decisions against it — rule-based scoring, no LLM required."
      breadcrumbs={['Labs', 'Scoring']}
      maturity="beta"
    >
      {/* How this surface works + how it differs from Evaluations */}
      <Card hover={false} className="mb-6">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ol className="space-y-1 text-xs text-secondary">
              <li><span className="tabular-nums font-semibold text-tertiary">1.</span> Define a profile — weighted dimensions over fields your agents already report (duration, cost, tokens, risk, confidence).</li>
              <li><span className="tabular-nums font-semibold text-tertiary">2.</span> &ldquo;Score recent&rdquo; grades your last 25 governed actions. Pure math, instant.</li>
              <li><span className="tabular-nums font-semibold text-tertiary">3.</span> Read the per-dimension breakdown in Score Explorer, or let Calibrate suggest scales from your real data.</li>
            </ol>
            <p className="max-w-[36ch] text-[11px] text-tertiary">
              Different from <Link href="/evaluations" className="text-brand transition-colors hover:text-brand-hover">Evaluations</Link>,
              which runs scorers (regex/keyword/LLM-judge) over actions and feeds agent Reputation.
            </p>
          </div>
        </div>
      </Card>

      {mutationError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-subtle px-4 py-2.5 text-xs text-error">
          <span>{mutationError}</span>
          <button onClick={() => setMutationError(null)} aria-label="Dismiss" className="shrink-0 opacity-60 transition-opacity hover:opacity-100">&times;</button>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 bg-secondary rounded-lg p-1 w-fit">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-elevated text-white' : 'text-tertiary hover:text-secondary'
            }`}>{tab}</button>
        ))}
      </div>

      {activeTab === 'Profiles' && (
        <ProfilesTab
          profiles={profiles}
          loading={loading}
          profileStatus={profileStatus}
          setProfileStatus={setProfileStatus}
          showCreate={showCreate}
          setShowCreate={setShowCreate}
          newProfile={newProfile}
          setNewProfile={setNewProfile}
          seeding={seeding}
          scoringId={scoringId}
          scoreSummary={scoreSummary}
          dimEditId={dimEditId}
          manageDims={manageDims}
          setManageDims={setManageDims}
          newDim={newDim}
          setNewDim={setNewDim}
          dimBusy={dimBusy}
          onCreateProfile={handleCreateProfile}
          onSeedDefaults={handleSeedDefaults}
          onScoreRecent={handleScoreRecent}
          onArchiveProfile={handleArchiveProfile}
          onUnarchiveProfile={handleUnarchiveProfile}
          onOpenDimEditor={openDimEditor}
          onSaveDimension={handleSaveDimension}
          onDeleteDimension={handleDeleteDimension}
          onAddDimension={handleAddDimension}
          onViewScores={handleViewScores}
        />
      )}

      {activeTab === 'Score Explorer' && (
        <ScoreExplorerTab
          selectedProfile={selectedProfile}
          scores={scores}
          scoreStats={scoreStats}
        />
      )}

      {activeTab === 'Risk Templates' && (
        <RiskTemplatesTab
          riskTemplates={riskTemplates}
          newTemplate={newTemplate}
          setNewTemplate={setNewTemplate}
          editTemplateId={editTemplateId}
          setEditTemplateId={setEditTemplateId}
          onCreateTemplate={handleCreateTemplate}
          onUpdateTemplate={handleUpdateTemplate}
          onDeleteTemplate={handleDeleteTemplate}
        />
      )}

      {activeTab === 'Calibrate' && (
        <CalibrateTab
          calibrateForm={calibrateForm}
          setCalibrateForm={setCalibrateForm}
          calibration={calibration}
          onCalibrate={handleCalibrate}
          onApplyCalibration={handleApplyCalibration}
        />
      )}
    </PageLayout>
  );
}
