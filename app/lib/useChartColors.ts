'use client';

import { useEffect, useState } from 'react';

export interface ChartColors {
  brand: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  tick: string;
  border: string;
  borderHover: string;
  tooltipBg: string;
}

// Recharts renders stroke/fill/stop-color as SVG presentation attributes,
// where CSS var() is not reliably honored. This hook resolves the design
// tokens at runtime (getComputedStyle) so charts stay token-driven — no
// hardcoded palettes in chart components. These initials mirror
// app/globals.css purely as a pre-hydration / getComputedStyle-failure
// fallback; if a token changes there, update the mirror here.
const FALLBACK: ChartColors = {
  brand: '#f97316',
  success: '#22c55e',
  warning: '#eab308',
  error: '#ef4444',
  muted: '#5c5c66',
  tick: '#9b9ba8',
  border: 'rgba(255, 255, 255, 0.08)',
  borderHover: 'rgba(255, 255, 255, 0.14)',
  tooltipBg: '#1d2026',
};

const TOKEN_MAP: Record<keyof ChartColors, string> = {
  brand: '--color-brand',
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
  muted: '--color-text-disabled',
  tick: '--color-text-tertiary',
  border: '--color-border',
  borderHover: '--color-border-hover',
  tooltipBg: '--color-bg-tertiary',
};

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK);

  useEffect(() => {
    try {
      const s = getComputedStyle(document.documentElement);
      const read = (token: string, fallback: string) => s.getPropertyValue(token).trim() || fallback;
      setColors(Object.fromEntries(
        (Object.keys(TOKEN_MAP) as Array<keyof ChartColors>).map((k) => [k, read(TOKEN_MAP[k], FALLBACK[k])])
      ) as unknown as ChartColors);
    } catch {
      /* keep fallbacks (jsdom / very old browsers) */
    }
  }, []);

  return colors;
}
