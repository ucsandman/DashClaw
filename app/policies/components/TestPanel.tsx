'use client';

import { useEffect, useState, useCallback } from 'react';
import { FlaskConical, X, Check } from 'lucide-react';
import styles from '../policies.module.css';
import { Badge } from '../../components/ui/Badge';

interface TestPanelProps {
  open: boolean;
  onClose: () => void;
}

// Read-only guardrail test runner for the redesigned /policies Ledger. Runs the
// active policies' inline test recipes via POST /api/policies/test and renders
// per-policy pass/fail results. Runs automatically on open; footer re-runs.
export default function TestPanel({ open, onClose }: TestPanelProps) {
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);

  const handleRunTests = useCallback(async () => {
    setTestRunning(true);
    setTestResults(null);
    try {
      const res = await fetch('/api/policies/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      setTestResults(res.ok ? data.results : { error: data.error || 'Failed to run tests' });
    } catch {
      setTestResults({ error: 'Failed to run tests' });
    } finally {
      setTestRunning(false);
    }
  }, []);

  // Run the suite whenever the modal opens.
  useEffect(() => {
    if (open) handleRunTests();
  }, [open, handleRunTests]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.modalBackdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Guardrail test results">
        <div className={styles.modalHead}>
          <h3>Guardrail test results</h3>
          <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnIcon}`} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className="space-y-3">
            {testRunning && <p className="text-xs text-secondary">Running policy tests…</p>}
            {testResults?.error && (
              <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{testResults.error}</div>
            )}
            {testResults && !testResults.error && (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={testResults.success ? 'success' : 'error'} size="xs">
                    {`${testResults.passed}/${testResults.total_tests} passed`}
                  </Badge>
                  <span className="text-xs text-tertiary">{testResults.total_policies} policies</span>
                </div>
                {testResults.total_tests === 0 ? (
                  <p className="text-xs text-tertiary">No active policies to test.</p>
                ) : (
                  <div className="space-y-2">
                    {testResults.details.map((d: any) => (
                      <div key={d.policy_id} className="rounded-lg border border-border bg-surface-tertiary p-3">
                        <div className="text-xs font-medium text-white">{d.policy_name}</div>
                        <div className="mt-1.5 space-y-1">
                          {d.tests.map((t: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-[11px]">
                              {t.passed
                                ? <Check size={11} className="text-success" aria-hidden="true" />
                                : <X size={11} className="text-error" aria-hidden="true" />}
                              <span className="text-secondary">{t.name}</span>
                              {!t.passed && t.reason && <span className="text-tertiary">: {t.reason}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className={styles.modalFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>Close</button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleRunTests}
            disabled={testRunning}
          >
            <FlaskConical size={13} aria-hidden="true" /> {testRunning ? 'Running…' : 'Re-run'}
          </button>
        </div>
      </div>
    </div>
  );
}
