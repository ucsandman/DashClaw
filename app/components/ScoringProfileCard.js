'use client';

import { useState, useEffect } from 'react';
import { Card } from './ui/Card';

export default function ScoringProfileCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/scoring/profiles')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.profiles) {
          setData({
            total: d.profiles.length,
            active: d.profiles.filter(p => p.status === 'active').length,
            totalDimensions: d.profiles.reduce((sum, p) => sum + ((p.dimensions || []).length), 0),
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">Scoring Profiles</h3>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="text-2xl font-bold text-white">{data.active}</div>
          <div className="text-xs text-zinc-500">Active profiles</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-white">{data.totalDimensions}</div>
          <div className="text-xs text-zinc-500">Dimensions</div>
        </div>
        <div>
          <a href="/scoring" className="text-xs text-brand hover:text-brand/80">Manage &rarr;</a>
        </div>
      </div>
    </Card>
  );
}
