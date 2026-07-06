'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import type { RiskTemplate, RiskRule, NewTemplateState } from './types';

interface RiskTemplatesTabProps {
  riskTemplates: RiskTemplate[];
  newTemplate: NewTemplateState;
  setNewTemplate: Dispatch<SetStateAction<NewTemplateState>>;
  editTemplateId: string | null;
  setEditTemplateId: (id: string | null) => void;
  onCreateTemplate: () => void;
  onUpdateTemplate: () => void;
  onDeleteTemplate: (templateId: string) => void;
}

export default function RiskTemplatesTab({
  riskTemplates, newTemplate, setNewTemplate, editTemplateId, setEditTemplateId,
  onCreateTemplate, onUpdateTemplate, onDeleteTemplate,
}: RiskTemplatesTabProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Risk Templates</h2>
      <p className="text-sm text-secondary mb-4">
        Define rules for automatic risk scoring. Instead of agents hardcoding a number,
        DashClaw computes risk based on action properties matching your rules.
      </p>
      <p className="text-sm text-secondary mb-4 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2">
        Active templates apply to live guard evaluations: a matching template&apos;s score is
        folded into each decision&apos;s effective risk (it can raise, never lower it) and shows
        up in the decision&apos;s risk derivation as <span className="font-mono text-xs">template:&lt;name&gt;</span>.
        Changes take effect within seconds.
      </p>

      <Card className="mb-6 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-secondary">{editTemplateId ? 'Edit Risk Template' : 'Create Risk Template'}</h3>
          {editTemplateId && (
            <button onClick={() => { setEditTemplateId(null); setNewTemplate({ name: '', description: '', action_type: '', base_risk: 20, rules: [{ condition: '', add: 10 }] }); }}
              className="text-xs text-tertiary hover:text-white">Cancel edit</button>
          )}
        </div>
        <input value={newTemplate.name} onChange={e => setNewTemplate(t => ({ ...t, name: e.target.value }))}
          placeholder="Template name (e.g. 'Production Safety')"
          className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
        <div className="grid grid-cols-2 gap-3">
          <input value={newTemplate.action_type} onChange={e => setNewTemplate(t => ({ ...t, action_type: e.target.value }))}
            placeholder="Action type (optional)"
            className="px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-tertiary">Base risk:</label>
            <input type="number" min="0" max="100" value={newTemplate.base_risk}
              onChange={e => setNewTemplate(t => ({ ...t, base_risk: parseInt(e.target.value) || 0 }))}
              className="w-20 px-2 py-2 bg-secondary border border-border rounded-lg text-sm text-white" />
          </div>
        </div>

        <h4 className="text-xs font-medium text-secondary mt-2">Rules (condition -&gt; add risk)</h4>
        {newTemplate.rules.map((rule, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input value={rule.condition} onChange={e => {
              const rules = [...newTemplate.rules];
              rules[i] = { ...(rules[i] as RiskRule), condition: e.target.value };
              setNewTemplate(t => ({ ...t, rules }));
            }} placeholder="e.g. metadata.environment == 'production'"
              className="flex-1 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white font-mono" />
            <span className="text-xs text-tertiary">+</span>
            <input type="number" value={rule.add} onChange={e => {
              const rules = [...newTemplate.rules];
              rules[i] = { ...(rules[i] as RiskRule), add: parseInt(e.target.value) || 0 };
              setNewTemplate(t => ({ ...t, rules }));
            }} className="w-16 px-2 py-1.5 bg-primary border border-border rounded text-sm text-white text-center" />
            <button onClick={() => setNewTemplate(t => ({ ...t, rules: t.rules.filter((_, j) => j !== i) }))}
              className="text-error text-xs hover:text-error">x</button>
          </div>
        ))}
        <button onClick={() => setNewTemplate(t => ({ ...t, rules: [...t.rules, { condition: '', add: 10 }] }))}
          className="text-sm text-brand hover:text-brand/80">+ Add rule</button>

        <button onClick={editTemplateId ? onUpdateTemplate : onCreateTemplate} disabled={!newTemplate.name}
          className="px-4 py-2 rounded-lg bg-brand text-black text-sm font-medium hover:bg-brand/90 disabled:opacity-40">
          {editTemplateId ? 'Save changes' : 'Create Template'}
        </button>
      </Card>

      {riskTemplates.length === 0 && <EmptyState title="No risk templates" description="Create templates to replace hardcoded agent risk scores." />}

      <div className="space-y-2">
        {riskTemplates.map(tmpl => (
          <Card key={tmpl.id} className="p-3">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-medium text-white">{tmpl.name}</h3>
                <div className="flex gap-2 mt-1">
                  {tmpl.action_type && <Badge variant="info">{tmpl.action_type}</Badge>}
                  <Badge variant="default">Base: {tmpl.base_risk}</Badge>
                  <Badge variant="default">{(tmpl.rules || []).length} rules</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setEditTemplateId(tmpl.id); setNewTemplate({ name: tmpl.name, description: tmpl.description || '', action_type: tmpl.action_type || '', base_risk: tmpl.base_risk ?? 20, rules: (tmpl.rules && tmpl.rules.length) ? tmpl.rules.map(r => ({ condition: r.condition, add: r.add })) : [{ condition: '', add: 10 }] }); }}
                  className="text-xs text-tertiary hover:text-white">Edit</button>
                <button onClick={() => onDeleteTemplate(tmpl.id)}
                  className="text-xs text-tertiary hover:text-error">Delete</button>
              </div>
            </div>
            {tmpl.rules && tmpl.rules.length > 0 && (
              <div className="mt-2 space-y-1">
                {tmpl.rules.map((rule, i) => (
                  <div key={i} className="text-xs text-tertiary font-mono">
                    if <span className="text-secondary">{rule.condition}</span> -&gt; <span className="text-brand">+{rule.add}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
