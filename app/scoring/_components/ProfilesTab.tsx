'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { isDemoMode } from '../../lib/isDemoMode';
import {
  DATA_SOURCES, COMPOSITE_METHODS,
  type ScoringProfile, type ScoringDimension, type NewProfileState,
  type NewDimState, type ScoreSummaryState,
} from './types';

interface ProfilesTabProps {
  profiles: ScoringProfile[];
  loading: boolean;
  profileStatus: string;
  setProfileStatus: (status: string) => void;
  showCreate: boolean;
  setShowCreate: (show: boolean) => void;
  newProfile: NewProfileState;
  setNewProfile: Dispatch<SetStateAction<NewProfileState>>;
  seeding: boolean;
  scoringId: string | null;
  scoreSummary: ScoreSummaryState | null;
  dimEditId: string | null;
  manageDims: ScoringDimension[];
  setManageDims: Dispatch<SetStateAction<ScoringDimension[]>>;
  newDim: NewDimState;
  setNewDim: Dispatch<SetStateAction<NewDimState>>;
  dimBusy: boolean;
  onCreateProfile: () => void;
  onSeedDefaults: () => void;
  onScoreRecent: (profile: ScoringProfile) => void;
  onArchiveProfile: (profileId: string) => void;
  onUnarchiveProfile: (profileId: string) => void;
  onOpenDimEditor: (profile: ScoringProfile) => void;
  onSaveDimension: (profileId: string, dim: ScoringDimension) => void;
  onDeleteDimension: (profileId: string, dimId: string | undefined) => void;
  onAddDimension: (profileId: string) => void;
  onViewScores: (profile: ScoringProfile) => void;
}

export default function ProfilesTab({
  profiles, loading, profileStatus, setProfileStatus, showCreate, setShowCreate,
  newProfile, setNewProfile, seeding, scoringId, scoreSummary,
  dimEditId, manageDims, setManageDims, newDim, setNewDim, dimBusy,
  onCreateProfile, onSeedDefaults, onScoreRecent, onArchiveProfile, onUnarchiveProfile,
  onOpenDimEditor, onSaveDimension, onDeleteDimension, onAddDimension, onViewScores,
}: ProfilesTabProps) {
  return (
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

          <button onClick={onCreateProfile} disabled={!newProfile.name}
            className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90 disabled:opacity-40">
            Create Profile
          </button>
        </Card>
      )}

      {profiles.length === 0 && !loading && (
        <div className="py-6 text-center">
          <EmptyState title="No scoring profiles yet" description="Create a profile to define what quality means for your agents — or start from the seeded examples." />
          {!isDemoMode() && profileStatus === 'active' && (
            <button
              onClick={onSeedDefaults}
              disabled={seeding}
              className="mx-auto mt-3 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
            >
              {seeding ? 'Loading…' : 'Load starter profiles'}
            </button>
          )}
        </div>
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
                  <button onClick={() => onScoreRecent(profile)} disabled={scoringId === profile.id}
                    className="text-xs text-brand hover:text-brand/80 disabled:opacity-50">
                    {scoringId === profile.id ? 'Scoring…' : 'Score recent'}
                  </button>
                )}
                <button onClick={() => onViewScores(profile)}
                  className="text-xs text-brand hover:text-brand/80">View Scores</button>
                {!isDemoMode() && (
                  <button onClick={() => onOpenDimEditor(profile)}
                    className="text-xs text-tertiary hover:text-white">
                    {dimEditId === profile.id ? 'Close' : 'Manage dims'}
                  </button>
                )}
                {profile.status === 'archived' ? (
                  <button onClick={() => onUnarchiveProfile(profile.id)}
                    className="text-xs text-tertiary hover:text-success">Unarchive</button>
                ) : (
                  <button onClick={() => onArchiveProfile(profile.id)}
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
                      onClick={() => onViewScores(profile)}
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
                    <button onClick={() => onSaveDimension(profile.id, manageDims[i] as ScoringDimension)} disabled={dimBusy || !dim.name}
                      className="col-span-2 text-xs text-brand hover:text-brand/80 disabled:opacity-40">Save</button>
                    <button onClick={() => onDeleteDimension(profile.id, dim.id)} disabled={dimBusy}
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
                  <button onClick={() => onAddDimension(profile.id)} disabled={dimBusy || !newDim.name}
                    className="col-span-3 text-xs text-brand hover:text-brand/80 disabled:opacity-40">+ Add dimension</button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
