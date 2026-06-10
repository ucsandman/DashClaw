'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Target, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { StatCompact } from './ui/Stat';
import { CardSkeleton } from './ui/Skeleton';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';

export default function ScoringProfileCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const r = await fetch('/api/scoring/profiles');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d?.profiles) {
        setData({
          total: d.profiles.length,
          active: d.profiles.filter((p: any) => p.status === 'active').length,
          totalDimensions: d.profiles.reduce((sum: number, p: any) => sum + ((p.dimensions || []).length), 0),
        });
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <CardSkeleton />;

  return (
    <Card className="h-full">
      <CardHeader
        title={<span className="flex items-center">Scoring Profiles<HelpIcon sectionKey="scoring" tip={HELP_TIPS['scoring']} /></span>}
        icon={Target}
        action={
          <Link href="/scoring" className="flex items-center gap-1 text-xs text-secondary hover:text-white transition-colors">
            Manage <ArrowRight size={12} />
          </Link>
        }
      />
      <CardContent className="flex flex-col h-full justify-center">
        {error ? (
          <div className="text-center">
            <div className="text-sm text-error mb-3">Failed to load scoring profiles.</div>
            <button
              onClick={load}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-around">
            <StatCompact label="Active" value={data?.active || 0} color="text-brand" />
            <StatCompact label="Dimensions" value={data?.totalDimensions || 0} />
            <StatCompact label="Total" value={data?.total || 0} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
