'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Target } from 'lucide-react';
import { Badge } from './ui/Badge';
import { Card, CardContent } from './ui/Card';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { Skeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import {
  GAP_THRESHOLD,
  MIN_SCORED,
  type CalibrationVerdict,
  type ConfidenceCalibration,
} from '../lib/confidence-calibration';

const VERDICT_META: Record<CalibrationVerdict, { variant: string; label: string; Icon?: React.ElementType }> = {
  overconfident: { variant: 'warning', label: 'Overconfident', Icon: AlertTriangle },
  underconfident: { variant: 'info', label: 'Underconfident' },
  calibrated: { variant: 'success', label: 'Calibrated', Icon: CheckCircle2 },
  insufficient: { variant: 'default', label: `Needs ${MIN_SCORED}` },
};

const count = (n: number) => n.toLocaleString('en-US');
const percent = (n: number) => `${n.toLocaleString('en-US')}%`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')}`;

/**
 * Never colour alone: the verdict word is always spelled out, the icon only
 * doubles it for the two verdicts an operator is scanning for.
 */
function VerdictBadge({ verdict }: { verdict: CalibrationVerdict }) {
  const meta = VERDICT_META[verdict] ?? VERDICT_META.insufficient;
  const { Icon } = meta;
  return (
    <Badge variant={meta.variant} className="gap-1">
      {Icon && <Icon size={14} aria-hidden="true" />}
      {meta.label}
    </Badge>
  );
}

type PanelState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'ready'; data: ConfidenceCalibration };

/**
 * Predicted vs actual — the agent's own stated confidence scored against what
 * actually completed.
 *
 * Rides GET /api/actions/stats (no new route: the surface budget is a ceiling,
 * and /decisions already calls it). Best-effort like ObserveModeBanner: a failed
 * fetch, or a response whose `confidence` block degraded to null, renders
 * nothing rather than an error the operator can do nothing about.
 *
 * The common state is the quiet one. `confidence` defaults to 50 in the column
 * and hooks never send it, so most workspaces have thousands of closed actions
 * and no stated predictions at all. That case gets one coverage line and one
 * sentence saying how to start stating them — not an alarm, and not a tall empty
 * card implying something is broken.
 */
export default function ConfidenceCalibrationPanel() {
  const { agentId } = useAgentFilter();
  const [state, setState] = useState<PanelState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const res = await fetch(
          `/api/actions/stats${agentId ? `?agent_id=${encodeURIComponent(agentId)}` : ''}`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error('stats unavailable');
        const json = await res.json();
        if (cancelled) return;
        // A null block means the calibration query failed behind the endpoint;
        // showing a zeroed panel would be a fabricated clean.
        if (!json?.confidence) {
          setState({ status: 'hidden' });
          return;
        }
        setState({ status: 'ready', data: json.confidence as ConfidenceCalibration });
      } catch {
        if (!cancelled) setState({ status: 'hidden' }); // best-effort surface
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  if (state.status === 'hidden') return null;

  return (
    <div data-testid="confidence-calibration-panel">
      <CollapsibleSection id="confidence-calibration" title="Predicted vs actual" icon={Target} defaultOpen>
        {state.status === 'loading' ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-96" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <PanelBody data={state.data} />
        )}
      </CollapsibleSection>
    </div>
  );
}

function PanelBody({ data }: { data: ConfidenceCalibration }) {
  const { coverage, overall, agents, window_days } = data;

  const coverageLine = (
    <p className="text-sm tabular-nums text-secondary" data-testid="calibration-coverage">
      {count(coverage.stated)} of {count(coverage.closed)} closed actions in the last {window_days} days
      carried a stated confidence.
    </p>
  );

  if (overall.n < MIN_SCORED) {
    return (
      <div>
        {coverageLine}
        <p className="mt-1 text-xs text-tertiary">
          Actions left at the default confidence of 50 are not scored. Have your agent pass confidence when
          it records: <span className="font-mono">dashclaw_record &#123; confidence &#125;</span> over MCP, or{' '}
          <span className="font-mono">record(&#123; confidence &#125;)</span> in the SDK. Verdicts need{' '}
          {MIN_SCORED} scored actions.
        </p>
      </div>
    );
  }

  const rows = [
    { key: '__overall__', label: 'All agents', href: null as string | null, ...overall },
    ...agents.map((a) => ({
      key: a.agent_id,
      label: a.agent_name || a.agent_id,
      href: `/decisions?agent_id=${encodeURIComponent(a.agent_id)}`,
      n: a.n,
      stated_avg: a.stated_avg,
      observed_rate: a.observed_rate,
      gap: a.gap,
      verdict: a.verdict,
    })),
  ];

  return (
    <div>
      {coverageLine}
      <Card hover={false} className="mt-3">
        <CardContent className="pt-4">
          <table className="w-full text-sm" data-testid="calibration-table">
            <caption className="sr-only">
              Stated confidence against observed completion rate, per agent, over the last {window_days} days
            </caption>
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                <th scope="col" className="py-2 text-left font-semibold">Agent</th>
                <th scope="col" className="py-2 text-right font-semibold">Scored</th>
                <th scope="col" className="py-2 text-right font-semibold">Stated</th>
                <th scope="col" className="py-2 text-right font-semibold">Completed</th>
                <th scope="col" className="py-2 text-right font-semibold">Gap</th>
                <th scope="col" className="py-2 text-right font-semibold">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} data-testid="calibration-row" className="border-t border-border">
                  <th scope="row" className="max-w-[16rem] truncate py-2 pr-3 text-left font-medium text-white">
                    {row.href ? (
                      <Link href={row.href} className="transition-colors hover:text-brand">
                        {row.label}
                      </Link>
                    ) : (
                      row.label
                    )}
                  </th>
                  <td className="py-2 text-right tabular-nums text-secondary">{count(row.n)}</td>
                  <td className="py-2 text-right tabular-nums text-secondary">{percent(row.stated_avg)}</td>
                  <td className="py-2 text-right tabular-nums text-secondary">{percent(row.observed_rate)}</td>
                  <td className="py-2 text-right tabular-nums text-secondary">{signed(row.gap)}</td>
                  <td className="py-2 pl-3 text-right">
                    <VerdictBadge verdict={row.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-tertiary">
        Gap = stated confidence minus observed completion rate. Overconfident at +{GAP_THRESHOLD} or more
        over at least {MIN_SCORED} scored actions.
      </p>
    </div>
  );
}
