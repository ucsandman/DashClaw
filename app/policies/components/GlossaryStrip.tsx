'use client';

import styles from '../policies.module.css';

/**
 * Section 6: the plain-language key. Every coined term on this page is defined
 * once, in place, so nobody has to guess what "bucket", "grant", or "ratify"
 * mean. Kept quiet (tertiary heading) — a reference, not a headline.
 */
export default function GlossaryStrip() {
  return (
    <>
      <div className={styles.secHead} style={{ marginTop: 26 }}>
        <div className={styles.lhs}>
          <h2 style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Plain-language key</h2>
        </div>
      </div>
      <div className={`${styles.card} ${styles.glossary}`}>
        <div>
          <span className={styles.metaLabel}>Bucket</span>
          <span className={styles.gdef}>
            What happens when a rule fires: <b style={{ color: 'var(--color-warning)' }}>warn</b> (log + notice),{' '}
            <b style={{ color: 'var(--color-brand)' }}>approve</b> (wait for you), <b style={{ color: 'var(--color-error)' }}>block</b> (never).
          </span>
        </div>
        <div>
          <span className={styles.metaLabel}>Source</span>
          <span className={styles.gdef}>
            Where a rule came from: a mode preset, a shield toggle, your own edit, or auto-learned from what you approve.
          </span>
        </div>
        <div>
          <span className={styles.metaLabel}>Grant</span>
          <span className={styles.gdef}>
            A standing &ldquo;don&rsquo;t ask me about this&rdquo; suppression, removable, never edited.
          </span>
        </div>
        <div>
          <span className={styles.metaLabel}>Ratify / Tighten / Loosen</span>
          <span className={styles.gdef}>
            Accept a suggestion, make a rule stricter, or make it more permissive. Each from the inbox, each undoable.
          </span>
        </div>
      </div>
    </>
  );
}
