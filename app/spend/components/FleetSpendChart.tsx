'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useChartColors } from '../../lib/useChartColors';

const fmt = (n: any) => `$${Number(n || 0).toFixed(2)}`;

interface FleetSpendChartProps {
  trend: any[];
}

// Extracted from app/spend/page.tsx so recharts can load on demand (next/dynamic)
// instead of riding the page's initial chunk. Tokens resolved at runtime via
// useChartColors — recharts SVG attrs don't honor CSS var().
export default function FleetSpendChart({ trend }: FleetSpendChartProps) {
  const colors = useChartColors();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={trend} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          <linearGradient id="fleetSpendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.brand} stopOpacity={0.2} />
            <stop offset="100%" stopColor={colors.brand} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fill: colors.tick, fontSize: 10 }} tickFormatter={(v) => String(v).slice(5)} />
        <YAxis tick={{ fill: colors.tick, fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={45} />
        <Tooltip
          formatter={(v) => fmt(v)}
          cursor={{ stroke: colors.borderHover }}
          contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.borderHover}`, borderRadius: 8, fontSize: 12 }}
        />
        <Area type="monotone" dataKey="total" stroke={colors.brand} fill="url(#fleetSpendGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
