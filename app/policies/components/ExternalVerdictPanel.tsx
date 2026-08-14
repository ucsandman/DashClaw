'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import styles from '../policies.module.css';

/**
 * External decision provider configuration (RFC 2026-08-13-external-policy-
 * verdict-input §6). One optional provider per org; its verdict joins the
 * local guard result stricter-wins. The form is the ONLY way to configure it
 * — no env-var-only path, per the RFC.
 *
 * Secrets discipline: the server auto-encrypts the URL and token and returns
 * them MASKED to browser sessions. The form round-trips masked values as-is;
 * the settings API skips masked writes, so an untouched secret is never
 * overwritten and never readable here.
 */

const KEYS = [
  'EXTERNAL_VERDICT_ENABLED',
  'EXTERNAL_VERDICT_PROVIDER',
  'EXTERNAL_VERDICT_PROVIDER_URL',
  'EXTERNAL_VERDICT_AUTH_TOKEN',
  'EXTERNAL_VERDICT_TIMEOUT_MS',
  'EXTERNAL_VERDICT_POSTURE',
] as const;

interface FormState {
  enabled: boolean;
  provider: string;
  url: string;
  token: string;
  timeoutMs: string;
  posture: 'fail_closed' | 'fail_open';
}

const EMPTY: FormState = {
  enabled: false, provider: '', url: '', token: '', timeoutMs: '', posture: 'fail_closed',
};

export default function ExternalVerdictPanel() {
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings?category=general', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not read provider settings (HTTP ${res.status})`);
        const data = await res.json();
        if (cancelled) return;
        const rows: Array<{ key: string; value: string | null }> = data.settings ?? [];
        const val = (k: string) => rows.find((r) => r.key === k)?.value ?? '';
        setForm({
          enabled: val('EXTERNAL_VERDICT_ENABLED') === 'true',
          provider: val('EXTERNAL_VERDICT_PROVIDER'),
          url: val('EXTERNAL_VERDICT_PROVIDER_URL'),
          token: val('EXTERNAL_VERDICT_AUTH_TOKEN'),
          timeoutMs: val('EXTERNAL_VERDICT_TIMEOUT_MS'),
          posture: val('EXTERNAL_VERDICT_POSTURE') === 'fail_open' ? 'fail_open' : 'fail_closed',
        });
      } catch (err) {
        if (!cancelled) { setForm(EMPTY); setError((err as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const values: Record<(typeof KEYS)[number], string> = {
        EXTERNAL_VERDICT_ENABLED: form.enabled ? 'true' : 'false',
        EXTERNAL_VERDICT_PROVIDER: form.provider.trim(),
        EXTERNAL_VERDICT_PROVIDER_URL: form.url.trim(),
        EXTERNAL_VERDICT_AUTH_TOKEN: form.token.trim(),
        EXTERNAL_VERDICT_TIMEOUT_MS: form.timeoutMs.trim(),
        EXTERNAL_VERDICT_POSTURE: form.posture,
      };
      for (const key of KEYS) {
        // An empty optional token stays unset instead of storing ''.
        if (key === 'EXTERNAL_VERDICT_AUTH_TOKEN' && !values[key]) continue;
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, value: values[key], category: 'general' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Saving ${key} failed (HTTP ${res.status})`);
      }
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [form]);

  if (!form) return null;

  const set = (patch: Partial<FormState>) => { setSaved(false); setForm({ ...form, ...patch }); };

  return (
    <div className={`${styles.card} ${styles.extPanel}`}>
      <p className={styles.extLead}>
        One outside decision engine can add its verdict to every guard decision. It can tighten
        the result — <b>allow &lt; warn &lt; require approval &lt; block</b> — and it can never
        loosen it. Its <b>deny</b> is absolute for the evaluated act.
      </p>

      <div className={styles.extRow}>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          aria-label="Use an external decision provider"
          className={`${styles.extSwitch} ${form.enabled ? styles.extSwitchOn : ''}`}
          onClick={() => set({ enabled: !form.enabled })}
        />
        <span className={styles.extRowLabel}>Use an external decision provider</span>
      </div>

      <div className={styles.extGrid}>
        <label className={styles.extField}>
          <span>Provider URL</span>
          <input
            type="text"
            value={form.url}
            placeholder="https://provider.example.com/verdict"
            onChange={(e) => set({ url: e.target.value })}
          />
        </label>
        <label className={styles.extField}>
          <span>Auth token (optional)</span>
          <input
            type="password"
            value={form.token}
            placeholder="Sent as a Bearer header"
            autoComplete="off"
            onChange={(e) => set({ token: e.target.value })}
          />
        </label>
        <label className={styles.extField}>
          <span>Provider label</span>
          <input
            type="text"
            value={form.provider}
            placeholder="agent-memory-pama"
            onChange={(e) => set({ provider: e.target.value })}
          />
        </label>
        <label className={styles.extField}>
          <span>Timeout (ms, 100–5000)</span>
          <input
            type="number"
            min={100}
            max={5000}
            value={form.timeoutMs}
            placeholder="1200"
            onChange={(e) => set({ timeoutMs: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.extRow}>
        <span className={styles.extRowLabel}>When the provider is unreachable:</span>
        <div className={styles.extSeg} role="radiogroup" aria-label="Unavailability posture">
          <button
            type="button"
            role="radio"
            aria-checked={form.posture === 'fail_closed'}
            className={form.posture === 'fail_closed' ? styles.extSegOn : ''}
            onClick={() => set({ posture: 'fail_closed' })}
          >
            Fail closed — ask a human
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={form.posture === 'fail_open'}
            className={form.posture === 'fail_open' ? styles.extSegOn : ''}
            onClick={() => set({ posture: 'fail_open' })}
          >
            Fail open — local rules only
          </button>
        </div>
      </div>
      <p className={styles.extHint}>
        Either way the decision records the outage as <b>external unavailable</b> — an unreachable
        provider is never shown as external governance.
      </p>

      <div className={styles.extFoot}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`}
          onClick={save}
          disabled={busy}
        >
          {busy ? <Loader2 size={14} className={styles.spin} /> : null}
          Save provider
        </button>
        {saved && (
          <span className={styles.extSaved}>
            <Check size={14} aria-hidden="true" /> Saved — applies to the next guard decision
          </span>
        )}
        {error && <span className={styles.pauseError}>{error}</span>}
      </div>
    </div>
  );
}
