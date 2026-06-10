'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useChartColors } from '../../lib/useChartColors';

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="rounded-lg border border-border-hover bg-surface-tertiary px-3 py-2 text-xs shadow-xl">
      <div className="text-secondary">{d.date}</div>
      <div className="text-white font-medium">${d.cost?.toFixed(2)}</div>
      <div className="text-tertiary">{d.actions} actions</div>
    </div>
  );
}

interface CostTrendChartProps {
  daily: any[];
}

export default function CostTrendChart({ daily }: CostTrendChartProps) {
  // Tokens resolved at runtime — recharts SVG attrs don't honor CSS var().
  const colors = useChartColors();
  const totalCost = (daily || []).reduce((sum, d) => sum + (d.cost || 0), 0);
  const hasActions = (daily || []).some(d => (d.actions || 0) > 0);
  const noCostData = daily.length === 0 || totalCost === 0;

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-5">
      <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-4">Cost Trend</div>
      {noCostData ? (
        <div className="flex flex-col items-center justify-center h-48 text-center px-6">
          <div className="text-sm text-secondary">
            {hasActions ? 'No cost data reported yet' : 'No cost data in this period'}
          </div>
          {hasActions && (
            <div className="mt-1 text-xs text-tertiary max-w-xs">
              Report <code className="font-mono text-secondary">tokens_in</code>, <code className="font-mono text-secondary">tokens_out</code>, and <code className="font-mono text-secondary">model</code> with each action to populate this chart.
            </div>
          )}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={daily} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.brand} stopOpacity={0.2} />
                <stop offset="100%" stopColor={colors.brand} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fill: colors.tick, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fill: colors.tick, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} width={45} />
            {/* Explicit cursor — the recharts default is a light #ccc line. */}
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: colors.borderHover }} />
            <Area type="monotone" dataKey="cost" stroke={colors.brand} fill="url(#costGradient)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
