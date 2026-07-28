'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const inputClass = 'w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-brand/50 focus:outline-none';
const selectClass = 'w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none';

const DECISION_ACTIONS = [
  { value: 'block', label: 'Block' },
  { value: 'warn', label: 'Warn' },
  { value: 'require_approval', label: 'Require Approval' },
];

// Test-status ladder enforced by the green_contract guard (app/lib/guard.js).
const GREEN_LEVELS = [
  { value: 'targeted', label: 'Targeted' },
  { value: 'package', label: 'Package' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'merge_ready', label: 'Merge-ready' },
];

// Branch states the branch_freshness guard can trigger on.
const FRESHNESS_OPTIONS = ['stale', 'diverged'];

interface ActionTypePickerProps {
  selected?: string[];
  options: string[];
  onChange: (next: string[]) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
}

// Action-type picker: preset quick-picks (one-click toggles) PLUS a free-text
// input so operators can target ANY action type — e.g. marketplace_publish,
// ps-finance:charge_customer, stripe.charge — the same custom strings Import/YAML
// already accepts. Selected types land in form.actionTypes → rules.action_types,
// the only field the guard matches on for these policy types (app/lib/guard.js).
function ActionTypePicker({ selected, options, onChange, label, hint }: ActionTypePickerProps) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(selected) ? selected : [];

  const toggle = (type: string) =>
    onChange(list.includes(type) ? list.filter((t) => t !== type) : [...list, type]);

  const remove = (type: string) => onChange(list.filter((t) => t !== type));

  const addCustom = () => {
    const value = draft.trim();
    if (!value) return; // non-empty
    if (!list.includes(value)) onChange([...list, value]); // dedupe
    setDraft('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addCustom();
    } else if (event.key === 'Backspace' && draft === '' && list.length > 0) {
      remove(list[list.length - 1]!);
    }
  };

  // Selected presets show their state via the highlighted quick-pick button;
  // custom (non-preset) types render as removable chips so they're visible and
  // deletable even though they have no preset button.
  const customSelected = list.filter((type) => !options.includes(type));

  return (
    <div>
      <label className="block text-xs text-secondary mb-2">
        {label}
        {hint ? <span className="text-tertiary"> {hint}</span> : null}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={list.includes(type)}
            onClick={() => toggle(type)}
            className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
              list.includes(type)
                ? 'bg-brand text-white'
                : 'bg-surface-tertiary text-secondary border border-border hover:text-white'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {customSelected.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {customSelected.map((type) => (
            <span
              key={type}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-brand/15 border border-brand/30 text-brand"
            >
              {type}
              <button
                type="button"
                onClick={() => remove(type)}
                aria-label={`Remove ${type}`}
                className="text-brand/70 hover:text-brand"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a custom action type (e.g. marketplace_publish), press Enter"
          aria-label="Custom action type"
          className={inputClass}
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!draft.trim()}
          className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium text-brand border border-brand/20 bg-brand/10 transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

interface DelegationConstraintFieldsProps {
  form: any;
  onChange: (field: string, value: any) => void;
}

// Scoped delegation constraints (app/lib/guard/policy.ts) attenuate a spawned
// subagent's authority relative to its parent — the rule only fires on
// composed identities (`parent:child`, the ':' delimiter DashClaw reserves
// for subagent spawns). This branch has no other data-fetch precedent in the
// file, so it owns a small local useEffect (mirrors ActionTypePicker owning
// its own local state above) that fetches /api/agents once on mount and
// offers observed composed ids as one-click prefill chips. Free-text entry
// for parent/child types stays available whether or not the fetch succeeds.
function DelegationConstraintFields({ form, onChange }: DelegationConstraintFieldsProps) {
  const [observedIds, setObservedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents')
      .then((res) => (res.ok ? res.json() : { agents: [] }))
      .then((data: { agents?: Array<{ agent_id?: string }> }) => {
        if (cancelled) return;
        const composed = (Array.isArray(data.agents) ? data.agents : [])
          .map((a) => a.agent_id)
          .filter((id): id is string => typeof id === 'string' && id.includes(':'));
        setObservedIds([...new Set(composed)]);
      })
      .catch(() => {
        // free-text entry still works without the observed roster
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyObservedId = (id: string) => {
    const sep = id.indexOf(':');
    if (sep <= 0) return;
    onChange('parent', id.slice(0, sep));
    onChange('childTypes', id.slice(sep + 1).split(':').filter(Boolean));
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-tertiary">
        Caps what a spawned subagent may do relative to its parent. Fires only for composed{' '}
        <code className="text-secondary">parent:child</code> identities — plain, non-delegated agents
        are always unaffected.
      </p>

      {observedIds.length > 0 && (
        <div>
          <label className="block text-xs text-secondary mb-2">Observed subagent identities</label>
          <div className="flex flex-wrap gap-2">
            {observedIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => applyObservedId(id)}
                className="px-2.5 py-1 rounded-md text-xs bg-surface-tertiary text-secondary border border-border hover:text-white transition-colors"
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-secondary mb-1">Parent (agent id, or * for any)</label>
          <input
            aria-label="Delegation parent"
            type="text"
            value={form.parent}
            onChange={(event) => onChange('parent', event.target.value)}
            placeholder="*"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1">Max risk score (0-100)</label>
          <input
            aria-label="Delegation max risk score"
            type="number"
            min="0"
            max="100"
            value={form.maxRiskScore}
            onChange={(event) => {
              const value = event.target.value === ''
                ? ''
                : Math.max(0, Math.min(100, parseInt(event.target.value, 10) || 0));
              onChange('maxRiskScore', value);
            }}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-secondary mb-1">Child types (one per line, or * for any)</label>
        <textarea
          aria-label="Delegation child types"
          value={(form.childTypes || []).join('\n')}
          onChange={(event) => onChange('childTypes', event.target.value.split('\n'))}
          placeholder={'*'}
          rows={2}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-secondary mb-1">Allowed action types (one per line, optional)</label>
          <textarea
            aria-label="Delegation allowed action types"
            value={(form.allowedActionTypes || []).join('\n')}
            onChange={(event) => onChange('allowedActionTypes', event.target.value.split('\n'))}
            placeholder={'read\nsearch'}
            rows={3}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1">Blocked action types (one per line, optional)</label>
          <textarea
            aria-label="Delegation blocked action types"
            value={(form.blockedActionTypes || []).join('\n')}
            onChange={(event) => onChange('blockedActionTypes', event.target.value.split('\n'))}
            placeholder={'deploy\nmigrate'}
            rows={3}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-secondary mb-1">Blocked path globs (one per line, optional)</label>
        <textarea
          aria-label="Delegation blocked path globs"
          value={(form.blockedPathGlobs || []).join('\n')}
          onChange={(event) => onChange('blockedPathGlobs', event.target.value.split('\n'))}
          placeholder={'**/secrets/**\nmiddleware.js'}
          rows={3}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-secondary mb-1">Max spawn depth (optional)</label>
          <input
            aria-label="Delegation max depth"
            type="number"
            min="1"
            max="8"
            value={form.maxDepth}
            onChange={(event) => onChange('maxDepth', event.target.value === '' ? '' : parseInt(event.target.value, 10) || 1)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1">On violation</label>
          <select
            aria-label="Delegation escalate action"
            value={form.escalateAction}
            onChange={(event) => onChange('escalateAction', event.target.value)}
            className={selectClass}
          >
            <option value="require_approval">Require Approval</option>
            <option value="block">Block</option>
          </select>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-white sm:mt-5">
            <input
              aria-label="Require verified parent"
              type="checkbox"
              checked={!!form.requireVerifiedParent}
              onChange={(event) => onChange('requireVerifiedParent', event.target.checked)}
              className="h-4 w-4 accent-brand"
            />
            Require verified parent
          </label>
          <p className="text-xs text-tertiary mt-1">
            Requires the caller&apos;s verified identity (JWKS) — without Phase-2 identity configured, every composed call escalates.
          </p>
        </div>
      </div>
    </div>
  );
}

interface PolicyRuleBuilderSectionProps {
  form: any;
  actionOptions: string[];
  onChange: (field: string, value: any) => void;
}

export default function PolicyRuleBuilderSection({
  form,
  actionOptions,
  onChange,
}: PolicyRuleBuilderSectionProps) {
  const toggleFreshness = (state: string) => {
    const current = Array.isArray(form.freshness) ? form.freshness : [];
    onChange(
      'freshness',
      current.includes(state)
        ? current.filter((value: string) => value !== state)
        : [...current, state]
    );
  };

  return (
    <>
      {form.type === 'risk_threshold' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-secondary mb-1">Risk Threshold (0-100)</label>
            <input
              aria-label="Risk Threshold"
              type="number"
              min="0"
              max="100"
              value={form.threshold}
              onChange={(event) => {
                const value = event.target.value === ''
                  ? ''
                  : Math.max(0, Math.min(100, parseInt(event.target.value, 10) || 0));
                onChange('threshold', value);
              }}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Action</label>
            <select
              aria-label="Action"
              value={form.action}
              onChange={(event) => onChange('action', event.target.value)}
              className={selectClass}
            >
              {DECISION_ACTIONS.map((action) => (
                <option key={action.value} value={action.value}>{action.label}</option>
              ))}
            </select>
          </div>

          {/* Containment band (RFC containment-verdicts, Locked Decision 10)
              — only meaningful on an interrupt policy: it carves a lower
              band that executes contained (isolated worktree, operator
              promote/discard) instead of interrupting outright. IMPORTANT 4
              (final fix wave, 2026-07-27). */}
          {form.action === 'require_approval' && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-secondary mb-1">
                Contain below the interrupt threshold (optional)
              </label>
              <input
                aria-label="Contain Above"
                type="number"
                min="0"
                max={Math.max(0, (Number(form.threshold) || 0) - 1)}
                placeholder="e.g. 50 — unset means no containment band"
                value={form.containAbove}
                onChange={(event) => {
                  const value = event.target.value === ''
                    ? ''
                    : Math.max(0, Math.min(100, parseInt(event.target.value, 10) || 0));
                  onChange('containAbove', value);
                }}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-tertiary">
                Risk scores from this value up to (but below) the threshold execute in an isolated
                worktree for one-click operator Promote/Discard, instead of interrupting the agent.
                Must be lower than the threshold above.
              </p>
            </div>
          )}
        </div>
      )}

      {(form.type === 'require_approval' || form.type === 'block_action_type') && (
        <ActionTypePicker
          label="Action Types"
          options={actionOptions}
          selected={form.actionTypes}
          onChange={(next) => onChange('actionTypes', next)}
        />
      )}

      {form.type === 'rate_limit' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-secondary mb-1">Max Actions</label>
            <input
              aria-label="Max Actions"
              type="number"
              min="1"
              value={form.maxActions}
              onChange={(event) => onChange('maxActions', parseInt(event.target.value, 10) || 1)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Window (minutes)</label>
            <input
              aria-label="Window Minutes"
              type="number"
              min="1"
              value={form.windowMinutes}
              onChange={(event) => onChange('windowMinutes', parseInt(event.target.value, 10) || 1)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Action</label>
            <select
              aria-label="Rate Limit Action"
              value={form.action}
              onChange={(event) => onChange('action', event.target.value)}
              className={selectClass}
            >
              {DECISION_ACTIONS.map((action) => (
                <option key={action.value} value={action.value}>{action.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {form.type === 'webhook_check' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-3">
            <label className="block text-xs text-secondary mb-1">Webhook URL (HTTPS required)</label>
            <input
              aria-label="Webhook URL"
              type="url"
              value={form.webhookUrl}
              onChange={(event) => onChange('webhookUrl', event.target.value)}
              placeholder="https://your-api.example.com/guard"
              required
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">Timeout (ms)</label>
            <input
              aria-label="Webhook Timeout"
              type="number"
              min="1000"
              max="10000"
              step="500"
              value={form.webhookTimeout}
              onChange={(event) => onChange('webhookTimeout', parseInt(event.target.value, 10) || 5000)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1">On Timeout</label>
            <select
              aria-label="Webhook On Timeout"
              value={form.webhookOnTimeout}
              onChange={(event) => onChange('webhookOnTimeout', event.target.value)}
              className={selectClass}
            >
              <option value="require_approval">Require approval (fail-closed default)</option>
              <option value="block">Block (strict fail-closed)</option>
              <option value="allow">Allow (fail-open escape hatch)</option>
            </select>
          </div>
        </div>
      )}

      {form.type === 'non_fabrication' && (
        <div className="space-y-4">
          <p className="text-xs text-tertiary">
            Verifies the action&apos;s outbound content against a source-of-truth: every amount, date,
            percentage, and registered ID must trace to an allowed fact, and no forbidden pattern may
            appear. Attach <code className="text-secondary">content</code> and{' '}
            <code className="text-secondary">source_of_truth</code> to the action (SDK:{' '}
            <code className="text-secondary">content</code> + <code className="text-secondary">sourceOfTruth</code>).
            Fail-closed: a missing or malformed source-of-truth blocks.
          </p>
          <ActionTypePicker
            label="Action Types"
            hint="(optional, leave empty to apply to all)"
            options={actionOptions}
            selected={form.actionTypes}
            onChange={(next) => onChange('actionTypes', next)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">On Violation</label>
              <select
                aria-label="On Violation"
                value={form.onViolation}
                onChange={(event) => onChange('onViolation', event.target.value)}
                className={selectClass}
              >
                <option value="block">Block (fail-closed)</option>
                <option value="require_approval">Require Approval</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Content field path</label>
              <input
                aria-label="Content field path"
                type="text"
                value={form.contentPath}
                onChange={(event) => onChange('contentPath', event.target.value)}
                placeholder="content"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Source-of-truth field path</label>
              <input
                aria-label="Source-of-truth field path"
                type="text"
                value={form.sourcePath}
                onChange={(event) => onChange('sourcePath', event.target.value)}
                placeholder="source_of_truth"
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      {form.type === 'permission_escalation' && (
        <div className="space-y-4">
          <p className="text-xs text-tertiary">
            Compares the permission a tool requires against the agent&apos;s approved pairing level.
            The policy is inert until enforcement is turned on.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                aria-label="Enforce permission escalation"
                type="checkbox"
                checked={!!form.enforce}
                onChange={(event) => onChange('enforce', event.target.checked)}
                className="h-4 w-4 accent-brand"
              />
              Enforce this policy
            </label>
            <div>
              <label className="block text-xs text-secondary mb-1">On escalation</label>
              <select
                aria-label="Permission escalation action"
                value={form.action}
                onChange={(event) => onChange('action', event.target.value)}
                className={selectClass}
              >
                {DECISION_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {form.type === 'green_contract' && (
        <div className="space-y-4">
          <p className="text-xs text-tertiary">
            Gates the selected actions until the agent reports a test status at or above the required
            level. A missing test status fails the contract.
          </p>
          <ActionTypePicker
            label="Action Types"
            options={actionOptions}
            selected={form.actionTypes}
            onChange={(next) => onChange('actionTypes', next)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">Required green level</label>
              <select
                aria-label="Required green level"
                value={form.requiredLevel}
                onChange={(event) => onChange('requiredLevel', event.target.value)}
                className={selectClass}
              >
                {GREEN_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>{level.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">On violation</label>
              <select
                aria-label="Green contract action"
                value={form.action}
                onChange={(event) => onChange('action', event.target.value)}
                className={selectClass}
              >
                {DECISION_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {form.type === 'branch_freshness' && (
        <div className="space-y-4">
          <p className="text-xs text-tertiary">
            Blocks the selected actions when the agent&apos;s working branch is in one of the chosen
            states and is too many commits behind its base.
          </p>
          <ActionTypePicker
            label="Action Types"
            options={actionOptions}
            selected={form.actionTypes}
            onChange={(next) => onChange('actionTypes', next)}
          />
          <div>
            <label className="block text-xs text-secondary mb-2">Trigger when branch is</label>
            <div className="flex flex-wrap gap-2">
              {FRESHNESS_OPTIONS.map((state) => (
                <button
                  key={state}
                  type="button"
                  aria-pressed={(form.freshness || []).includes(state)}
                  onClick={() => toggleFreshness(state)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                    (form.freshness || []).includes(state)
                      ? 'bg-brand text-white'
                      : 'bg-surface-tertiary text-secondary border border-border hover:text-white'
                  }`}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">Max commits behind</label>
              <input
                aria-label="Max commits behind"
                type="number"
                min="0"
                value={form.maxCommitsBehind}
                onChange={(event) => onChange('maxCommitsBehind', parseInt(event.target.value, 10) || 0)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">On violation</label>
              <select
                aria-label="Branch freshness action"
                value={form.action}
                onChange={(event) => onChange('action', event.target.value)}
                className={selectClass}
              >
                {DECISION_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {form.type === 'require_evidence' && (
        <div className="space-y-4">
          <p className="text-xs text-tertiary">
            Escalates guard calls that declare intent without attaching the actual act (the shell
            command, HTTP request, SQL statement, or file write) for the server to classify.
            Leave the action types empty to require evidence on every call.
          </p>
          <ActionTypePicker
            label="Action Types"
            options={actionOptions}
            selected={form.actionTypes}
            onChange={(next) => onChange('actionTypes', next)}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-secondary mb-1">When evidence is missing</label>
              <select
                aria-label="Require evidence enforcement"
                value={form.enforcement}
                onChange={(event) => onChange('enforcement', event.target.value)}
                className={selectClass}
              >
                {DECISION_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {form.type === 'protected_path' && (
        <div className="space-y-4">
          <p className="text-xs text-tertiary">
            Warns or requires approval when an action&apos;s target path matches one of these globs.
            Patterns support <code className="text-secondary">**</code> (any depth) and{' '}
            <code className="text-secondary">*</code> (one segment). The Policy Coach pre-fills these
            from observed protected-path writes (auth, secrets, billing, middleware, cron/gateway).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-secondary mb-1">Protected path globs (one per line)</label>
              <textarea
                aria-label="Protected path globs"
                value={(form.protectedPaths || []).join('\n')}
                onChange={(event) => onChange('protectedPaths', event.target.value.split('\n'))}
                placeholder={'**/auth/**\n**/secrets/**\nmiddleware.js'}
                rows={4}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Action</label>
              <select
                aria-label="Protected path action"
                value={form.action}
                onChange={(event) => onChange('action', event.target.value)}
                className={selectClass}
              >
                {DECISION_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {form.type === 'agent_allowlist' && (
        <div className="space-y-4">
          <p className="text-xs text-tertiary">
            Warns (or escalates) when the agent uses an action type outside this list: its observed
            safe envelope. The Policy Coach pre-fills the list from the agent&apos;s recorded behavior;
            the policy fires only on novel action types.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-secondary mb-1">Allowed action types (one per line)</label>
              <textarea
                aria-label="Allowed action types"
                value={(form.allowedActionTypes || []).join('\n')}
                onChange={(event) => onChange('allowedActionTypes', event.target.value.split('\n'))}
                placeholder={'read\nsearch\nbuild'}
                rows={4}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-secondary mb-1">Action</label>
              <select
                aria-label="Agent allowlist action"
                value={form.action}
                onChange={(event) => onChange('action', event.target.value)}
                className={selectClass}
              >
                {DECISION_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {form.type === 'delegation_constraint' && (
        <DelegationConstraintFields form={form} onChange={onChange} />
      )}

    </>
  );
}
