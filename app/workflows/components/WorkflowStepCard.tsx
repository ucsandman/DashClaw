'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, MoveDown, MoveUp, Trash2 } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import WorkflowVariableInsertButton from './WorkflowVariableInsertButton';
import { buildWorkflowStepSummary, insertVariableToken, WORKFLOW_STEP_TYPES } from '../lib/workflowStepFormModel.js';

const inputClass = 'w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand';
const labelClass = 'block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5';

interface BodyRow {
  key: string;
  value: string;
}

function bodyObjectToRows(body: Record<string, any> | undefined): BodyRow[] {
  return Object.entries(body || {}).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}

function bodyRowsToObject(rows: BodyRow[]): Record<string, string> {
  return rows.reduce((acc: Record<string, string>, row) => {
    if (!row.key?.trim()) return acc;
    acc[row.key.trim()] = row.value ?? '';
    return acc;
  }, {});
}

function titleForType(type: string): string {
  return WORKFLOW_STEP_TYPES.find((item) => item.value === type)?.label || type;
}

function makeFieldId(stepId: string, fieldName: string): string {
  return `${stepId}-${fieldName}`;
}

interface WorkflowStepCardProps {
  step: any;
  index: number;
  total: number;
  resourceOptions?: any;
  resourceLookups?: any;
  variableGroups?: any;
  onChange: (nextStep: any) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export default function WorkflowStepCard({
  step,
  index,
  total,
  resourceOptions,
  resourceLookups,
  variableGroups,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: WorkflowStepCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [bodyRows, setBodyRows] = useState<BodyRow[]>(() => bodyObjectToRows(step.config?.body));
  const [showCondition, setShowCondition] = useState(!!step.condition);
  const stepNameId = makeFieldId(step.id, 'name');
  const collectionId = makeFieldId(step.id, 'collection-id');
  const topResultsId = makeFieldId(step.id, 'top-results');
  const searchQueryId = makeFieldId(step.id, 'search-query');
  const capabilityId = makeFieldId(step.id, 'capability-id');
  const promptTemplateId = makeFieldId(step.id, 'prompt-template');
  const systemPromptId = makeFieldId(step.id, 'system-prompt');
  const maxTokensId = makeFieldId(step.id, 'max-tokens');
  const temperatureId = makeFieldId(step.id, 'temperature');
  const conditionId = makeFieldId(step.id, 'condition');

  const summary = useMemo(() => buildWorkflowStepSummary(step, resourceLookups), [resourceLookups, step]);
  const collections = resourceOptions?.knowledgeCollections || [];
  const capabilities = resourceOptions?.capabilities || [];
  const promptTemplates = resourceOptions?.promptTemplates || [];

  function updateStep(patch: Record<string, any>) {
    onChange({
      ...step,
      ...patch,
    });
  }

  function updateConfig(configPatch: Record<string, any>) {
    updateStep({
      config: {
        ...step.config,
        ...configPatch,
      },
    });
  }

  function updateBodyRow(nextRows: BodyRow[]) {
    setBodyRows(nextRows);
    updateConfig({ body: bodyRowsToObject(nextRows) });
  }

  function appendTokenToConfigField(field: string) {
    return (token: string) => {
      updateConfig({
        [field]: insertVariableToken(step.config?.[field] || '', token),
      });
    };
  }

  return (
    <div className="rounded-xl border border-border bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3 px-4 py-4 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="info" size="xs">Step {index + 1}</Badge>
            <Badge variant="success" size="xs">{titleForType(step.type)}</Badge>
          </div>
          <div className="mt-2 text-sm font-medium text-white">{step.name}</div>
          <p className="mt-1 text-xs text-secondary">{summary}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button type="button" onClick={() => setCollapsed((value) => !value)} className="p-2 text-tertiary hover:text-white transition-colors" aria-label={collapsed ? 'Expand step' : 'Collapse step'}>
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button type="button" onClick={onMoveUp} disabled={index === 0} className="p-2 text-tertiary hover:text-white transition-colors disabled:opacity-30" aria-label="Move step up">
            <MoveUp size={14} />
          </button>
          <button type="button" onClick={onMoveDown} disabled={index === total - 1} className="p-2 text-tertiary hover:text-white transition-colors disabled:opacity-30" aria-label="Move step down">
            <MoveDown size={14} />
          </button>
          <button type="button" onClick={onDuplicate} className="p-2 text-tertiary hover:text-white transition-colors" aria-label="Duplicate step">
            <Copy size={14} />
          </button>
          <button type="button" onClick={onDelete} className="p-2 text-tertiary hover:text-error transition-colors" aria-label="Delete step">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4">
          <div>
            <label htmlFor={stepNameId} className={labelClass}>Step name</label>
            <input
              id={stepNameId}
              type="text"
              value={step.name}
              onChange={(event) => updateStep({ name: event.target.value })}
              className={inputClass}
            />
          </div>

          {step.type === 'knowledge_search' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={collectionId} className={labelClass}>Knowledge collection</label>
                <select
                  id={collectionId}
                  value={step.config.collection_id}
                  onChange={(event) => updateConfig({ collection_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">Select a knowledge collection</option>
                  {collections.map((option: any) => (
                    <option key={option.value} value={option.value}>
                      {option.unavailable ? `${option.label} (Unavailable)` : option.label}
                    </option>
                  ))}
                </select>
                {step.config.collection_id && resourceLookups?.knowledgeCollections?.[step.config.collection_id] && (
                  <p className="mt-2 text-xs text-tertiary">{resourceLookups.knowledgeCollections[step.config.collection_id]}</p>
                )}
              </div>
              <div>
                <label htmlFor={topResultsId} className={labelClass}>Top results</label>
                <input
                  id={topResultsId}
                  type="number"
                  min="1"
                  value={step.config.top_k}
                  onChange={(event) => updateConfig({ top_k: Number(event.target.value) || 1 })}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <label htmlFor={searchQueryId} className={labelClass}>Search query</label>
                  <WorkflowVariableInsertButton variableGroups={variableGroups} onInsert={appendTokenToConfigField('query')} />
                </div>
                <input
                  id={searchQueryId}
                  type="text"
                  value={step.config.query}
                  onChange={(event) => updateConfig({ query: event.target.value })}
                  className={inputClass}
                  placeholder="refund eligibility"
                />
              </div>
            </div>
          )}

          {step.type === 'capability_invoke' && (
            <div className="space-y-4">
              <div>
                <label htmlFor={capabilityId} className={labelClass}>Capability</label>
                <select
                  id={capabilityId}
                  value={step.config.capability_id}
                  onChange={(event) => updateConfig({ capability_id: event.target.value })}
                  className={inputClass}
                >
                  <option value="">Select a capability</option>
                  {capabilities.map((option: any) => (
                    <option key={option.value} value={option.value}>
                      {option.unavailable ? `${option.label} (Unavailable)` : option.label}
                    </option>
                  ))}
                </select>
                {step.config.capability_id && resourceLookups?.capabilities?.[step.config.capability_id] && (
                  <p className="mt-2 text-xs text-tertiary">{resourceLookups.capabilities[step.config.capability_id]}</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelClass}>Payload fields</label>
                  <button
                    type="button"
                    onClick={() => updateBodyRow([...bodyRows, { key: '', value: '' }])}
                    className="px-2.5 py-1 rounded-lg bg-white/5 text-xs text-secondary hover:bg-white/10 transition-colors"
                  >
                    Add payload field
                  </button>
                </div>
                <div className="space-y-2">
                  {bodyRows.length === 0 ? (
                    <p className="text-xs text-tertiary">No payload fields yet. Add key/value fields for the capability request body.</p>
                  ) : bodyRows.map((row, rowIndex) => (
                    <div key={`${step.id}-payload-${rowIndex}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <input
                        type="text"
                        value={row.key}
                        onChange={(event) => {
                          const nextRows = [...bodyRows];
                          nextRows[rowIndex] = { ...row, key: event.target.value };
                          updateBodyRow(nextRows);
                        }}
                        className={inputClass}
                        placeholder="field name"
                      />
                      <input
                        type="text"
                        value={row.value}
                        onChange={(event) => {
                          const nextRows = [...bodyRows];
                          nextRows[rowIndex] = { ...row, value: event.target.value };
                          updateBodyRow(nextRows);
                        }}
                        className={inputClass}
                        placeholder="field value"
                      />
                      <div className="sm:col-span-2">
                        <WorkflowVariableInsertButton
                          variableGroups={variableGroups}
                          onInsert={(token) => {
                            const nextRows = [...bodyRows];
                            nextRows[rowIndex] = { ...row, value: insertVariableToken(row.value || '', token) };
                            updateBodyRow(nextRows);
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => updateBodyRow(bodyRows.filter((_, candidateIndex) => candidateIndex !== rowIndex))}
                        className="px-3 py-2 rounded-lg bg-error-subtle text-error text-xs hover:bg-error-subtle transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step.type === 'prompt' && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Load prompt template</label>
                <select
                  value=""
                  onChange={(event) => {
                    const selected = promptTemplates.find((option: any) => option.value === event.target.value);
                    if (!selected) return;
                    updateConfig({ prompt_template: selected.content || step.config.prompt_template });
                    event.target.value = '';
                  }}
                  className={inputClass}
                >
                  <option value="">Choose a prompt template to load</option>
                  {promptTemplates.map((option: any) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <label htmlFor={promptTemplateId} className={labelClass}>Prompt template</label>
                  <WorkflowVariableInsertButton variableGroups={variableGroups} onInsert={appendTokenToConfigField('prompt_template')} />
                </div>
                <textarea
                  id={promptTemplateId}
                  value={step.config.prompt_template}
                  onChange={(event) => updateConfig({ prompt_template: event.target.value })}
                  rows={4}
                  className={inputClass}
                  placeholder="Summarize the knowledge search results for the customer."
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <label htmlFor={systemPromptId} className={labelClass}>System prompt</label>
                  <WorkflowVariableInsertButton variableGroups={variableGroups} onInsert={appendTokenToConfigField('system_prompt')} />
                </div>
                <textarea
                  id={systemPromptId}
                  value={step.config.system_prompt}
                  onChange={(event) => updateConfig({ system_prompt: event.target.value })}
                  rows={3}
                  className={inputClass}
                  placeholder="Optional system instruction"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={maxTokensId} className={labelClass}>Max tokens</label>
                  <input
                    id={maxTokensId}
                    type="number"
                    min="1"
                    value={step.config.max_tokens}
                    onChange={(event) => updateConfig({ max_tokens: Number(event.target.value) || 1 })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor={temperatureId} className={labelClass}>Temperature</label>
                  <input
                    id={temperatureId}
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={step.config.temperature}
                    onChange={(event) => updateConfig({ temperature: Number(event.target.value) || 0 })}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Condition & Failure Handling ── */}
          <div className="border-t border-border pt-4 mt-4 space-y-3">
            {!showCondition ? (
              <button
                type="button"
                onClick={() => setShowCondition(true)}
                className="text-[10px] text-brand hover:text-brand-hover transition-colors"
              >
                + Add condition
              </button>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor={conditionId} className={labelClass}>Condition (skip if falsy)</label>
                  <button
                    type="button"
                    onClick={() => { setShowCondition(false); updateStep({ condition: '' }); }}
                    className="text-[10px] text-tertiary hover:text-secondary transition-colors"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    id={conditionId}
                    type="text"
                    value={step.condition || ''}
                    onChange={(e) => updateStep({ condition: e.target.value })}
                    placeholder="${steps.prev_step.output.found}"
                    className={inputClass}
                  />
                  <WorkflowVariableInsertButton
                    variableGroups={variableGroups}
                    onInsert={(token) => updateStep({ condition: insertVariableToken(step.condition || '', token) })}
                  />
                </div>
                <p className="text-[10px] text-disabled mt-1">Step is skipped if this resolves to empty, 0, false, or null.</p>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!step.continue_on_failure}
                onChange={(e) => updateStep({ continue_on_failure: e.target.checked })}
                className="rounded border-white/20 bg-surface-tertiary text-brand focus:ring-brand/30"
              />
              <span className="text-xs text-secondary">Continue on failure</span>
            </label>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <p className={labelClass}>Retry policy</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={makeFieldId(step.id, 'max-retries')} className={labelClass}>Max retries</label>
                <input
                  id={makeFieldId(step.id, 'max-retries')}
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  value={step.retry_policy?.max_retries ?? 0}
                  onChange={(event) => updateStep({
                    retry_policy: {
                      ...step.retry_policy,
                      max_retries: Number(event.target.value),
                    },
                  })}
                  className={inputClass}
                />
              </div>

              {(step.retry_policy?.max_retries || 0) > 0 ? (
                <>
                  <div>
                    <label htmlFor={makeFieldId(step.id, 'backoff')} className={labelClass}>Backoff strategy</label>
                    <select
                      id={makeFieldId(step.id, 'backoff')}
                      value={step.retry_policy?.backoff || 'none'}
                      onChange={(event) => updateStep({
                        retry_policy: {
                          ...step.retry_policy,
                          backoff: event.target.value,
                        },
                      })}
                      className={inputClass}
                    >
                      <option value="none">none (immediate)</option>
                      <option value="fixed">fixed delay</option>
                      <option value="exponential">exponential backoff</option>
                    </select>
                  </div>

                  {step.retry_policy?.backoff && step.retry_policy.backoff !== 'none' ? (
                    <div>
                      <label htmlFor={makeFieldId(step.id, 'base-delay')} className={labelClass}>Base delay (ms)</label>
                      <input
                        id={makeFieldId(step.id, 'base-delay')}
                        type="number"
                        min="100"
                        max="30000"
                        step="100"
                        value={step.retry_policy?.base_delay_ms ?? 1000}
                        onChange={(event) => updateStep({
                          retry_policy: {
                            ...step.retry_policy,
                            base_delay_ms: Number(event.target.value),
                          },
                        })}
                        className={inputClass}
                      />
                    </div>
                  ) : null}

                  {step.retry_policy?.backoff === 'exponential' ? (
                    <div>
                      <label htmlFor={makeFieldId(step.id, 'max-delay')} className={labelClass}>Max delay (ms)</label>
                      <input
                        id={makeFieldId(step.id, 'max-delay')}
                        type="number"
                        min="100"
                        max="60000"
                        step="1000"
                        value={step.retry_policy?.max_delay_ms ?? 30000}
                        onChange={(event) => updateStep({
                          retry_policy: {
                            ...step.retry_policy,
                            max_delay_ms: Number(event.target.value),
                          },
                        })}
                        className={inputClass}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
