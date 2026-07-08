'use client';

import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import styles from '../policies.module.css';
import PolicyGeneratedDraftEditor from './PolicyGeneratedDraftEditor';
import { normalizeGeneratedPolicyDrafts } from '../lib/policyGeneratorDrafts.js';
import {
  compilePolicyPayload,
  buildPolicySummary,
  POLICY_TYPE_OPTIONS as POLICY_TYPES,
} from '../lib/policyFormModel';

const ACTION_OPTIONS = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other',
];

interface GeneratePanelProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  agents: Array<{ agent_id: string; agent_name: string }>;
}

// Standalone AI-generator modal for the redesigned /policies Ledger. Describe a
// goal in plain English → the generator drafts a policy (and asks clarifying
// follow-ups), then compilePolicyPayload + POST /api/policies creates it.
export default function GeneratePanel({ open, onClose, onCreated, agents }: GeneratePanelProps) {
  const [genInput, setGenInput] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);
  const [genDrafts, setGenDrafts] = useState<any[]>([]);
  const [genDraftForm, setGenDraftForm] = useState<any>(null);
  const [genAssumptions, setGenAssumptions] = useState<string[]>([]);
  const [genClarifications, setGenClarifications] = useState<any[]>([]);
  const [genAnswers, setGenAnswers] = useState<Record<string, string | string[]>>({});
  const [genWarnings, setGenWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const runGenerator = async (answers: Record<string, string | string[]>) => {
    setGenLoading(true);
    setGenError(null);
    setGenSuccess(null);
    try {
      const answerList = Object.entries(answers || {}).map(([id, value]) => ({ id, value }));
      const res = await fetch('/api/policies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_text: genInput, answers: answerList, dry_run: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setGenError(data.error || 'Failed to generate policy drafts'); return; }
      const drafts = normalizeGeneratedPolicyDrafts(data.drafts || []);
      const clarifications = data.clarifications || [];
      const warnings = [...(data.warnings || [])];
      // The generator returns a single best draft for compound requests (and
      // clarifies the rest). If it returns more anyway, surface it instead of
      // silently dropping drafts 2..N — the editor only shows the first.
      if (drafts.length > 1) {
        warnings.push(`Generated ${drafts.length} policies from one request, showing the first ("${drafts[0]?.name || 'draft'}"). Save it, then refine to author the others one at a time.`);
      }
      setGenDrafts(drafts);
      setGenAssumptions(data.assumptions || []);
      setGenClarifications(clarifications);
      setGenWarnings(warnings);
      setGenDraftForm(drafts.length ? JSON.parse(JSON.stringify(drafts[0]?.formState)) : null);
      if (!drafts.length && !clarifications.length) {
        setGenError("DashClaw couldn't draft a policy or a follow-up. Try describing the action, risk, or paths to protect.");
      }
    } catch (err: any) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleGenerate = () => runGenerator({});
  const handleRefine = () => runGenerator(genAnswers);

  const toggleAnswer = (id: string, value: string, multi: boolean) => {
    setGenAnswers((prev) => {
      if (!multi) return { ...prev, [id]: value };
      const cur = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      return { ...prev, [id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  };

  const handleCreateDraft = async () => {
    if (!genDraftForm) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const payload = compilePolicyPayload(genDraftForm);
      const res = await fetch('/api/policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setGenError(data.error || 'Failed to create policy'); return; }
      setGenInput(''); setGenDrafts([]); setGenDraftForm(null); setGenAssumptions([]); setGenClarifications([]); setGenAnswers({}); setGenWarnings([]);
      onCreated();
      onClose();
    } catch (err: any) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  };

  const hasResult = Boolean(genDrafts.length || genClarifications.length);

  return (
    <div
      className={styles.modalBackdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`${styles.modal} ${styles.modalWide}`} role="dialog" aria-modal="true" aria-label="AI policy generator">
        <div className={styles.modalHead}>
          <h3>AI policy generator</h3>
          <button className={`${styles.btn} ${styles.btnGhost} ${styles.btnIcon}`} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className="space-y-3">
            <p className="text-xs text-secondary">Describe what you want DashClaw to prevent or enforce in plain English. DashClaw drafts a policy and asks follow-ups to pin it down: it never just says no.</p>
            {genSuccess && <div className="rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-xs text-success">{genSuccess}</div>}
            {genError && <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{genError}</div>}
            <textarea
              value={genInput}
              onChange={(e) => setGenInput(e.target.value)}
              placeholder="e.g. Stop my agents from deleting things I care about"
              rows={3}
              maxLength={5000}
              className="w-full resize-none rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-xs text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <div className="flex items-center justify-end">
              <span className="text-[11px] tabular-nums text-tertiary">{genInput.length}/5000</span>
            </div>

            {genAssumptions.length > 0 && (
              <div className="rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-[11px] text-tertiary">
                <span className="font-medium text-secondary">Assumptions:</span> {genAssumptions.join('; ')}
              </div>
            )}

            {genWarnings.length > 0 && (
              <div className="rounded-lg border border-yellow-500/20 bg-status-warning/10 px-3 py-2 text-[11px] text-warning">
                <span className="font-medium">Warnings:</span> {genWarnings.join('; ')}
              </div>
            )}

            {genClarifications.length > 0 && (
              <div className="space-y-2 rounded-lg border border-brand/20 bg-brand/5 p-3">
                <div className="text-xs font-medium text-white">Help me get this right:</div>
                {genClarifications.map((c: any) => (
                  <div key={c.id} className="space-y-1">
                    <div className="text-[11px] text-secondary">{c.question}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.suggestions.map((s: string) => {
                        const active = c.multi ? ((genAnswers[c.id] as string[]) || []).includes(s) : genAnswers[c.id] === s;
                        return (
                          <button key={s} onClick={() => toggleAnswer(c.id, s, c.multi)} aria-pressed={active}
                            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${active ? 'border-brand bg-brand/15 text-brand' : 'border-border bg-surface-tertiary text-secondary hover:border-border-hover'}`}>
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button onClick={handleRefine} disabled={genLoading}
                  className="mt-1 flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
                  <Sparkles size={12} aria-hidden="true" /> {genLoading ? 'Refining…' : 'Refine with my answers'}
                </button>
              </div>
            )}

            {genDraftForm && (
              <div className="space-y-3 rounded-lg border border-border bg-surface-tertiary p-3">
                <div className="text-xs font-medium text-white">Review &amp; save</div>
                <PolicyGeneratedDraftEditor
                  draft={genDrafts[0] || null}
                  form={genDraftForm}
                  setForm={setGenDraftForm}
                  policyTypes={POLICY_TYPES}
                  actionOptions={ACTION_OPTIONS}
                  agents={agents}
                  summary={buildPolicySummary(genDraftForm)}
                  saving={genLoading}
                  onSave={handleCreateDraft}
                  saveDisabled={!genDraftForm?.name?.trim()}
                />
              </div>
            )}
          </div>
        </div>

        <div className={styles.modalFoot}>
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>Close</button>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleGenerate}
            disabled={genLoading || !genInput.trim()}
          >
            <Sparkles size={13} aria-hidden="true" /> {genLoading ? 'Working…' : (hasResult ? 'Regenerate' : 'Generate')}
          </button>
        </div>
      </div>
    </div>
  );
}
