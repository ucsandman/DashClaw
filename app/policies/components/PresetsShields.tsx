'use client';

import { useState } from 'react';
import {
  ChevronDown, Rocket, TriangleAlert, ShieldAlert, Ban, Timer, Globe,
  MessageSquare, BadgeCheck, Fingerprint, Shield, GitFork, type LucideIcon,
} from 'lucide-react';
import type { PolicySummary } from '../lib/modesClient';
import { SHIELDS, matchShieldsToPolicies, buildShieldPayload } from '../lib/shields';
import ModeDrawer from './ModeDrawer';
import styles from '../policies.module.css';

/**
 * Section 4: the "presets & shields" quick-add row. A mode writes a tagged batch
 * of rules; each shield is one canned rule. Both land in the ledger below with a
 * source tag — this is where their relationship becomes literal. All ten shields
 * are visible at first paint (no hidden disclosure).
 */

interface PresetsShieldsProps {
  summary: PolicySummary;
  onChanged: () => void;
}

const SHIELD_ICONS: Record<string, LucideIcon> = {
  deploy_gate: Rocket,
  risk_high: TriangleAlert,
  risk_critical: ShieldAlert,
  destructive_block: Ban,
  rate_limiter: Timer,
  api_review: Globe,
  outbound_gate: MessageSquare,
  non_fabrication_guard: BadgeCheck,
  evidence_required: Fingerprint,
  subagent_constraint: GitFork,
};

const LEVEL: Record<string, { cls?: string; label: string; sub: string }> = {
  low: { cls: styles.lvlLow, label: 'Low', sub: 'Interrupt rarely; auto-allow most actions.' },
  medium: { cls: styles.lvlMed, label: 'Medium', sub: 'Interrupt on real risk, auto-allow the routine.' },
  high: { cls: styles.lvlHigh, label: 'High', sub: 'Interrupt on anything uncertain.' },
};

export default function PresetsShields({ summary, onChanged }: PresetsShieldsProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mode = summary.primaryMode;
  const level = mode ? LEVEL[mode.interruptionLevel] ?? LEVEL.medium : null;
  const shields = summary.shields;
  const activeCount = shields.filter((s) => s.on).length;

  async function toggleShield(shieldId: string, currentlyOn: boolean) {
    setBusy(shieldId);
    setError(null);
    try {
      const res = await fetch('/api/policies');
      if (!res.ok) throw new Error(`Couldn't load policies (${res.status})`);
      const { policies } = await res.json();
      const matched = matchShieldsToPolicies(policies) as Map<string, { id: string } | null>;
      const existing = matched.get(shieldId);
      const catalog = SHIELDS.find((s) => s.id === shieldId);

      let mres: Response;
      if (currentlyOn) {
        if (!existing) { setBusy(null); return; }
        mres = await fetch('/api/policies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existing.id, active: 0 }),
        });
      } else if (existing) {
        mres = await fetch('/api/policies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existing.id, active: 1 }),
        });
      } else {
        if (!catalog) { setBusy(null); return; }
        mres = await fetch('/api/policies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildShieldPayload(catalog)),
        });
      }
      if (!mres.ok) {
        const body = await mres.json().catch(() => ({}));
        throw new Error(body.error || `Toggle failed (${mres.status})`);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className={styles.secHead}>
        <div className={styles.lhs}>
          <h2>Presets &amp; shields</h2>
          <span className={styles.secHelp}>
            Fast ways to add rules to the ledger below. A <b>mode</b> writes a tagged batch; each <b>shield</b> is one canned rule.
          </span>
        </div>
      </div>

      <div className={styles.presets}>
        {/* Mode card */}
        <div className={`${styles.card} ${styles.presetCard}`}>
          <span className={styles.metaLabel}>Active mode</span>
          <button type="button" className={styles.modeSelect} onClick={() => setDrawerOpen(true)}>
            <span className={styles.lvl}>
              {mode && level ? (
                <>
                  <span className={`${styles.lvlBadge} ${level.cls}`}>{level.label}</span>
                  {mode.name}
                </>
              ) : (
                <span style={{ color: 'var(--color-text-tertiary)' }}>No mode applied</span>
              )}
            </span>
            <ChevronDown size={15} style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
          <div className={styles.modeFoot}>
            <span className={styles.sub}>
              {level ? level.sub : 'Your agents run unchecked until you apply a mode.'}
            </span>
          </div>
          <div className={styles.modeFoot} style={{ marginTop: 12, gap: 8 }}>
            <button type="button" className={`${styles.btn} ${styles.btnSm}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setDrawerOpen(true)}>
              Preview diff
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnPrimary}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setDrawerOpen(true)}>
              {mode ? 'Change mode' : 'Apply a mode'}
            </button>
          </div>
        </div>

        {/* Shields */}
        <div className={`${styles.card} ${styles.presetCard}`}>
          <div className={styles.shieldsHead}>
            <span className={styles.metaLabel}>
              <Shield size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 5 }} aria-hidden="true" />
              Shields &middot; {activeCount} of {shields.length} active
            </span>
            <span className={`${styles.secHelp} ${styles.mono}`} style={{ fontSize: 11 }}>toggle = create / patch a rule</span>
          </div>
          <div className={styles.shieldGrid}>
            {shields.map((s) => {
              const Icon = SHIELD_ICONS[s.id] ?? Shield;
              const isBusy = busy === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.shield} ${s.on ? styles.on : ''} ${isBusy ? styles.shieldBusy : ''}`}
                  onClick={() => toggleShield(s.id, s.on)}
                  role="switch"
                  aria-checked={s.on}
                  aria-label={`${s.name}: ${s.on ? 'on' : 'off'}. ${s.description}`}
                  title={s.description}
                  disabled={isBusy}
                >
                  <span className={styles.shieldIco}><Icon size={15} aria-hidden="true" /></span>
                  <span className={styles.shieldMeta}>
                    <span className={styles.nm}>{s.name}</span>
                    <span className={styles.st}>{s.on ? 'On' : 'Off'}</span>
                  </span>
                  <span className={styles.toggle} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          {error && <div className={styles.rowError} style={{ marginTop: 10 }}>{error}</div>}
        </div>
      </div>

      <ModeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onApplied={onChanged} />
    </>
  );
}
