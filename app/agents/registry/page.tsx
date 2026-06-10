'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Boxes, Plus } from 'lucide-react';
import PageLayout from '../../components/PageLayout';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListSkeleton, Skeleton } from '../../components/ui/Skeleton';
import { RISK_CLASSES, AUTH_TYPES, INPUT_CLASS, REGISTRY_TEMPLATES } from './components/constants';
import InvokePanel from './components/InvokePanel';
import CapabilitiesCard from './components/CapabilitiesCard';
import EditPanel from './components/EditPanel';
import HowItWorks from './components/HowItWorks';
import RegistryEmptyState from './components/RegistryEmptyState';

interface RegistryForm {
  name: string;
  endpoint: string;
  auth_type: string;
  risk_class: string;
  default_budget_usd: number | string;
}

const EMPTY_FORM: RegistryForm = { name: '', endpoint: '', auth_type: 'none', risk_class: 'medium', default_budget_usd: '' };

export default function AgentRegistryPage() {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<RegistryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('');

  const fetchAgents = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const res = await fetch(`/api/agents/registry${qs}`);
      if (res.ok) {
        setAgents((await res.json()).registered_agents || []);
      } else {
        // A 403/500 must not masquerade as an empty registry.
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to load registered agents (HTTP ${res.status})`);
      }
    } catch {
      setError('Failed to load registered agents');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const selectAgent = useCallback(async (agent: any) => {
    setSelectedId(agent.entry_id);
    setDetail(null);
    setEditing(false);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/agents/registry/${agent.entry_id}`);
      if (res.ok) {
        setDetail(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to load agent detail (HTTP ${res.status})`);
      }
    } catch {
      setError('Failed to load agent detail');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleRegister = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: any = { ...form };
      if (payload.default_budget_usd === '') delete payload.default_budget_usd;
      else payload.default_budget_usd = Number(payload.default_budget_usd);
      const res = await fetch('/api/agents/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Failed to register agent'); return; }
      setShowForm(false);
      setForm(EMPTY_FORM);
      await fetchAgents();
    } catch {
      setError('Failed to register agent');
    } finally {
      setSaving(false);
    }
  };

  // Reflect an updated registered_agent into both the master list and the open detail.
  const applyUpdatedAgent = useCallback((updated: any) => {
    if (!updated) return;
    setAgents((prev) => prev.map((a) => (a.entry_id === updated.entry_id ? { ...a, ...updated } : a)));
    setDetail((prev: any) => (prev ? { ...prev, registered_agent: { ...prev.registered_agent, ...updated } } : prev));
  }, []);

  const handleSetStatus = async (status: 'active' | 'inactive') => {
    if (!detail?.registered_agent) return;
    const id = detail.registered_agent.entry_id;
    setError(null);
    try {
      const res = await fetch(`/api/agents/registry/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) applyUpdatedAgent(json.registered_agent);
      else setError(json.error || `Failed to ${status === 'active' ? 'activate' : 'deactivate'} agent`);
    } catch {
      setError(`Failed to ${status === 'active' ? 'activate' : 'deactivate'} agent`);
    }
  };

  const handleCapabilitiesChange = useCallback((next: any) => {
    setDetail((prev: any) => (prev ? { ...prev, capabilities: next } : prev));
  }, []);

  const reg = detail?.registered_agent;

  return (
    <PageLayout
      title="Agent Registry"
      subtitle="Register external services or sub-agents that DashClaw can invoke for you — each call is governed, risk-scored, and recorded."
      breadcrumbs={['Agents', 'Registry']}
      maturity="beta"
      actions={
        <button
          onClick={() => { setShowForm((v) => !v); setError(null); }}
          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
        >
          <Plus size={12} aria-hidden="true" /> Register agent
        </button>
      }
    >
      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-error/30 bg-error-subtle p-3 text-sm text-error">{error}</div>
      )}

      {showForm && (
        <Card className="mb-6">
          <CardContent>
            <div className="mb-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Start from a template</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="registry-templates">
                {REGISTRY_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.name}
                    type="button"
                    onClick={() => setForm({ ...EMPTY_FORM, ...tpl.form })}
                    className="group rounded-lg border border-border bg-surface-tertiary p-3 text-left transition-colors hover:border-border-hover"
                  >
                    <div className="text-xs font-medium text-secondary group-hover:text-white">{tpl.name}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-tertiary">{tpl.description}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-secondary">Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT_CLASS} />
              </label>
              <label className="text-xs text-secondary">Endpoint
                <input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="https://provider.example.com"
                  className={INPUT_CLASS} />
                <span className="mt-1 block text-[11px] text-tertiary">Descriptive metadata only — actual calls use the grouped capability&apos;s endpoint (configured at <Link href="/capabilities/new" className="text-brand hover:underline">/capabilities/new</Link>).</span>
              </label>
              <label className="text-xs text-secondary">Auth type
                <select value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })} className={INPUT_CLASS}>
                  {AUTH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="mt-1 block text-[11px] text-tertiary">Descriptive metadata only — call auth comes from the capability&apos;s invocation schema (token via org settings).</span>
              </label>
              <label className="text-xs text-secondary">Risk class
                <select value={form.risk_class} onChange={(e) => setForm({ ...form, risk_class: e.target.value })} className={INPUT_CLASS}>
                  {RISK_CLASSES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <span className="mt-1 block text-[11px] text-tertiary">Baseline risk for calls to this agent; feeds the guard decision and can trigger approval.</span>
              </label>
              <label className="text-xs text-secondary">Default budget (USD)
                <input type="number" value={form.default_budget_usd} onChange={(e) => setForm({ ...form, default_budget_usd: e.target.value })}
                  className={INPUT_CLASS} />
                <span className="mt-1 block text-[11px] text-tertiary">Per-call spend authority; higher budgets raise the risk score.</span>
              </label>
            </div>
            <button onClick={handleRegister} disabled={saving || !form.name.trim()}
              className="mt-3 rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
              {saving ? 'Registering…' : 'Register'}
            </button>
          </CardContent>
        </Card>
      )}

      <HowItWorks />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card>
            <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
              <span className="text-sm font-semibold text-white">Registered agents</span>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setLoading(true); }}
                aria-label="Filter by status"
                className="rounded-md border border-border bg-surface-tertiary px-2 py-1 text-[11px] text-secondary"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-5"><ListSkeleton rows={4} /></div>
              ) : agents.length === 0 ? (
                <RegistryEmptyState onRegister={() => { setShowForm(true); setError(null); }} />
              ) : (
                <div className="divide-y divide-border">
                  {agents.map((a) => (
                    <button key={a.entry_id} onClick={() => selectAgent(a)}
                      className={`flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-white/5 ${selectedId === a.entry_id ? 'bg-white/5' : ''}`}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{a.name}</div>
                        <div className="truncate text-xs text-tertiary">{a.slug}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge size="xs">{a.risk_class}</Badge>
                        <Badge variant={a.status === 'active' ? 'success' : 'default'} size="xs">{a.status}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          {detailLoading ? (
            <div className="space-y-6">
              <Card><CardContent><div className="space-y-3"><Skeleton className="h-5 w-40" /><ListSkeleton rows={3} /></div></CardContent></Card>
              <Card><CardContent><ListSkeleton rows={4} /></CardContent></Card>
            </div>
          ) : !detail ? (
            <Card><CardContent><EmptyState icon={Boxes} title="Select an agent" description="Choose a registered agent to view its capabilities, invoke it, and review its invocation history." /></CardContent></Card>
          ) : (
            <div className="space-y-6">
              {/* Header + lifecycle actions */}
              <Card>
                <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">{reg.name}</span>
                    <Badge variant={reg.status === 'active' ? 'success' : 'default'} size="xs">{reg.status}</Badge>
                    <Badge size="xs">{reg.risk_class}</Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => setEditing((v) => !v)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white">
                      {editing ? 'Close edit' : 'Edit'}
                    </button>
                    {reg.status === 'active' ? (
                      <button onClick={() => handleSetStatus('inactive')}
                        className="rounded-lg border border-error/30 px-3 py-1.5 text-xs text-error transition-colors hover:bg-error-subtle">
                        Deactivate
                      </button>
                    ) : (
                      <button onClick={() => handleSetStatus('active')}
                        className="rounded-lg border border-success/30 px-3 py-1.5 text-xs text-success transition-colors hover:bg-success-subtle">
                        Activate
                      </button>
                    )}
                  </div>
                </div>
                <CardContent>
                  <div className="text-xs text-tertiary">
                    {reg.endpoint ? <span className="break-all font-mono text-secondary">{reg.endpoint}</span> : 'No endpoint configured'}
                  </div>
                </CardContent>
              </Card>

              {editing && (
                <EditPanel
                  agent={reg}
                  onSaved={(updated) => { applyUpdatedAgent(updated); setEditing(false); }}
                  onCancel={() => setEditing(false)}
                />
              )}

              <CapabilitiesCard agentId={reg.entry_id} capabilities={detail.capabilities || []} onChange={handleCapabilitiesChange} />

              <InvokePanel agent={reg} capabilities={detail.capabilities || []} />

              <Card>
                <div className="border-b border-border px-5 py-3 text-sm font-semibold text-white">Invocation history</div>
                <CardContent>
                  {(detail.invocations || []).length === 0 ? (
                    <p className="text-xs text-tertiary">No invocations recorded yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.invocations.map((inv: any) => (
                        <li key={inv.id} className="flex items-center justify-between text-[11px] text-tertiary">
                          {inv.action_id ? (
                            <Link href={`/decisions/${inv.action_id}`} className="font-mono text-secondary transition-colors hover:text-brand">
                              {inv.action_id}
                            </Link>
                          ) : (
                            <span className="font-mono text-secondary">{inv.id}</span>
                          )}
                          <span>{inv.created_at ? new Date(inv.created_at).toLocaleString() : '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
