'use client';

import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { scoreColor, scoreBg } from './helpers';
import type { ScoringProfile, ScoreRecord } from './types';

interface ScoreExplorerTabProps {
  selectedProfile: ScoringProfile | null;
  scores: ScoreRecord[];
  scoreStats: any;
}

export default function ScoreExplorerTab({ selectedProfile, scores, scoreStats }: ScoreExplorerTabProps) {
  return (
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
  );
}
