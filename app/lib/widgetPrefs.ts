/**
 * Pure preferences logic for the desktop status widget (`/widget`).
 *
 * Modeled on dashboardLayoutState.ts: injected storage (defaults to
 * globalThis.localStorage) so the module unit-tests without a browser, a
 * versioned payload so shape changes discard stale prefs instead of
 * half-parsing them, and safe-parse with a full-default fallback.
 *
 * Customization is presentation-only: prefs decide what the client renders,
 * never what GET /api/widget/summary returns (the privacy whitelist there is
 * a deliberate boundary).
 */

export const WIDGET_PREFS_KEY = 'dashclaw_widget_prefs';
export const WIDGET_PREFS_VERSION = 1;

export interface WidgetSectionPrefs {
  metrics: boolean;
  approvals: boolean;
  topSignal: boolean;
  recentLog: boolean;
}

export interface WidgetMetricPrefs {
  agents: boolean;
  pending: boolean;
  signals: boolean;
  spend: boolean;
}

export interface WidgetPrefs {
  v: number;
  sections: WidgetSectionPrefs;
  metrics: WidgetMetricPrefs;
}

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function defaultWidgetPrefs(): WidgetPrefs {
  return {
    v: WIDGET_PREFS_VERSION,
    sections: { metrics: true, approvals: true, topSignal: true, recentLog: true },
    metrics: { agents: true, pending: true, signals: true, spend: true },
  };
}

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Merge a parsed payload onto the defaults, keeping only known boolean keys. */
function normalize(parsed: Record<string, unknown>): WidgetPrefs {
  const d = defaultWidgetPrefs();
  const sections = (parsed.sections ?? {}) as Record<string, unknown>;
  const metrics = (parsed.metrics ?? {}) as Record<string, unknown>;
  return {
    v: WIDGET_PREFS_VERSION,
    sections: {
      metrics: bool(sections.metrics, d.sections.metrics),
      approvals: bool(sections.approvals, d.sections.approvals),
      topSignal: bool(sections.topSignal, d.sections.topSignal),
      recentLog: bool(sections.recentLog, d.sections.recentLog),
    },
    metrics: {
      agents: bool(metrics.agents, d.metrics.agents),
      pending: bool(metrics.pending, d.metrics.pending),
      signals: bool(metrics.signals, d.metrics.signals),
      spend: bool(metrics.spend, d.metrics.spend),
    },
  };
}

export function loadWidgetPrefs(
  storage: PrefsStorage | null | undefined = globalThis?.localStorage,
): WidgetPrefs {
  try {
    if (!storage) return defaultWidgetPrefs();
    const raw = storage.getItem(WIDGET_PREFS_KEY);
    if (!raw) return defaultWidgetPrefs();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.v !== WIDGET_PREFS_VERSION) {
      return defaultWidgetPrefs();
    }
    return normalize(parsed as Record<string, unknown>);
  } catch {
    return defaultWidgetPrefs();
  }
}

export function saveWidgetPrefs(
  prefs: WidgetPrefs,
  storage: PrefsStorage | null | undefined = globalThis?.localStorage,
): void {
  try {
    if (storage) {
      storage.setItem(WIDGET_PREFS_KEY, JSON.stringify({ ...prefs, v: WIDGET_PREFS_VERSION }));
    }
  } catch {
    // ignore storage errors (private mode, quota)
  }
}

const SECTION_KEYS: ReadonlyArray<keyof WidgetSectionPrefs> = [
  'metrics',
  'approvals',
  'topSignal',
  'recentLog',
];
const METRIC_KEYS: ReadonlyArray<keyof WidgetMetricPrefs> = [
  'agents',
  'pending',
  'signals',
  'spend',
];

const parseList = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * Read-only URL overrides for chrome --app launchers and pinned shortcuts:
 * `/widget?hide=topSignal,spend` / `?show=approvals`. Overrides WIN over
 * stored prefs and are never persisted. `show` is applied after `hide` so an
 * explicit show always wins. Unknown tokens are ignored. Token `metrics`
 * targets the section; `agents`/`pending`/`signals`/`spend` target individual
 * metrics.
 */
export function applyQueryOverrides(
  prefs: WidgetPrefs,
  params: { hide?: string | null; show?: string | null },
): WidgetPrefs {
  const next: WidgetPrefs = {
    v: prefs.v,
    sections: { ...prefs.sections },
    metrics: { ...prefs.metrics },
  };
  const apply = (tokens: string[], value: boolean) => {
    for (const token of tokens) {
      if ((SECTION_KEYS as readonly string[]).includes(token)) {
        next.sections[token as keyof WidgetSectionPrefs] = value;
      }
      if ((METRIC_KEYS as readonly string[]).includes(token)) {
        next.metrics[token as keyof WidgetMetricPrefs] = value;
      }
    }
  };
  apply(parseList(params.hide), false);
  apply(parseList(params.show), true);
  return next;
}
