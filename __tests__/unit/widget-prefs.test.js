import { describe, it, expect } from 'vitest';
import {
  WIDGET_PREFS_KEY,
  WIDGET_PREFS_VERSION,
  defaultWidgetPrefs,
  loadWidgetPrefs,
  saveWidgetPrefs,
  applyQueryOverrides,
} from '../../app/lib/widgetPrefs';

/** Minimal in-memory Storage stub — the module takes injected storage. */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('widgetPrefs', () => {
  it('default shape: everything visible, current version', () => {
    const d = defaultWidgetPrefs();
    expect(d).toEqual({
      v: WIDGET_PREFS_VERSION,
      sections: { metrics: true, approvals: true, topSignal: true, recentLog: true },
      metrics: { agents: true, pending: true, signals: true, spend: true },
    });
  });

  it('roundtrips through storage', () => {
    const storage = makeStorage();
    const prefs = defaultWidgetPrefs();
    prefs.sections.topSignal = false;
    prefs.metrics.spend = false;
    saveWidgetPrefs(prefs, storage);
    const loaded = loadWidgetPrefs(storage);
    expect(loaded.sections.topSignal).toBe(false);
    expect(loaded.metrics.spend).toBe(false);
    expect(loaded.sections.metrics).toBe(true);
  });

  it('falls back to full defaults on corrupt storage', () => {
    const storage = makeStorage({ [WIDGET_PREFS_KEY]: '{not json' });
    expect(loadWidgetPrefs(storage)).toEqual(defaultWidgetPrefs());
  });

  it('discards a payload from a different version', () => {
    const stale = { v: WIDGET_PREFS_VERSION + 1, sections: { recentLog: false } };
    const storage = makeStorage({ [WIDGET_PREFS_KEY]: JSON.stringify(stale) });
    expect(loadWidgetPrefs(storage)).toEqual(defaultWidgetPrefs());
  });

  it('merges partial payloads onto defaults and drops unknown/non-boolean keys', () => {
    const partial = {
      v: WIDGET_PREFS_VERSION,
      sections: { recentLog: false, bogus: false, approvals: 'yes' },
      metrics: { spend: false },
    };
    const storage = makeStorage({ [WIDGET_PREFS_KEY]: JSON.stringify(partial) });
    const loaded = loadWidgetPrefs(storage);
    expect(loaded.sections.recentLog).toBe(false);
    expect(loaded.sections.approvals).toBe(true); // non-boolean → default
    expect(loaded.sections).not.toHaveProperty('bogus');
    expect(loaded.metrics).toEqual({ agents: true, pending: true, signals: true, spend: false });
  });

  it('returns defaults with no storage and tolerates a throwing storage', () => {
    expect(loadWidgetPrefs(null)).toEqual(defaultWidgetPrefs());
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    };
    expect(loadWidgetPrefs(throwing)).toEqual(defaultWidgetPrefs());
    expect(() => saveWidgetPrefs(defaultWidgetPrefs(), throwing)).not.toThrow();
  });

  describe('applyQueryOverrides', () => {
    it('?hide= turns off sections and individual metrics', () => {
      const out = applyQueryOverrides(defaultWidgetPrefs(), { hide: 'topSignal, spend' });
      expect(out.sections.topSignal).toBe(false);
      expect(out.metrics.spend).toBe(false);
      expect(out.sections.recentLog).toBe(true);
    });

    it('overrides win over stored prefs and show beats hide', () => {
      const stored = defaultWidgetPrefs();
      stored.sections.approvals = false; // stored says hidden
      const out = applyQueryOverrides(stored, { hide: 'approvals', show: 'approvals' });
      expect(out.sections.approvals).toBe(true);
    });

    it('ignores unknown tokens and does not mutate the input', () => {
      const input = defaultWidgetPrefs();
      const out = applyQueryOverrides(input, { hide: 'nonsense,', show: null });
      expect(out).toEqual(defaultWidgetPrefs());
      expect(input.sections.topSignal).toBe(true);
      expect(out).not.toBe(input);
    });
  });
});
