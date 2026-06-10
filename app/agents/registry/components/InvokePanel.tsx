'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { Card, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-white focus:border-brand/50 focus:outline-none';

interface ResultBadge {
  variant: string;
  label: string;
}

/** Map an invoke HTTP status / payload to a result Badge variant + label. */
function resultBadge(status: number, payload: any): ResultBadge {
  if (status === 200 && payload?.success) return { variant: 'success', label: 'Completed' };
  if (status === 202) return { variant: 'warning', label: 'Pending approval' };
  if (status === 403) return { variant: 'error', label: 'Blocked by policy' };
  return {
    variant: 'error',
    label: payload?.error || payload?.result?.message || payload?.result?.error || `Failed (${status})`,
  };
}

interface Capability {
  capability_id: string;
  name: string;
}

interface InvokePanelProps {
  agent: any;
  capabilities?: Capability[];
}

interface InvokeResult {
  status: number;
  payload: any;
}

/**
 * Invoke a capability through a registered agent, governed end to end. Mirrors the
 * register-form layout. The caller-agent dropdown is populated from /api/agents
 * (the governed agents), not the registry.
 */
export default function InvokePanel({ agent, capabilities = [] }: InvokePanelProps) {
  const [capabilityId, setCapabilityId] = useState('');
  const [callerAgentId, setCallerAgentId] = useState('');
  const [declaredGoal, setDeclaredGoal] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvokeResult | null>(null);
  const [callerAgents, setCallerAgents] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agents');
        if (res.ok && !cancelled) setCallerAgents((await res.json()).agents || []);
      } catch { /* optional field — leave the dropdown empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Reset the form when the selected provider changes.
  useEffect(() => {
    setCapabilityId('');
    setCallerAgentId('');
    setDeclaredGoal('');
    setPayloadText('{}');
    setJsonError(null);
    setError(null);
    setResult(null);
  }, [agent.entry_id]);

  const handleInvoke = async () => {
    setError(null);
    setResult(null);
    if (!capabilityId) { setError('Select a capability to invoke.'); return; }
    let payload: any = {};
    const trimmed = payloadText.trim();
    if (trimmed) {
      try {
        payload = JSON.parse(trimmed);
        if (typeof payload !== 'object' || Array.isArray(payload)) {
          setJsonError('Payload must be a JSON object.');
          return;
        }
        setJsonError(null);
      } catch {
        setJsonError('Invalid JSON.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/agents/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registered_agent_id: agent.entry_id,
          capability_id: capabilityId,
          agent_id: callerAgentId || undefined,
          payload,
          declared_goal: declaredGoal || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      setResult({ status: res.status, payload: json });
    } catch {
      setError('Invocation request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const badge = result ? resultBadge(result.status, result.payload) : null;
  const actionId = result?.payload?.action_id;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold text-white">
        <Zap size={14} className="text-brand" aria-hidden="true" /> Invoke
      </div>
      <CardContent>
        {capabilities.length === 0 ? (
          <p className="text-xs text-tertiary">
            Add a capability to this agent before you can invoke it — create one at{' '}
            <Link href="/capabilities/new" className="text-brand hover:underline">/capabilities/new</Link>, then group it above.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-secondary">Capability
                <select value={capabilityId} onChange={(e) => setCapabilityId(e.target.value)} className={INPUT_CLASS}>
                  <option value="">Select a capability…</option>
                  {capabilities.map((c) => (
                    <option key={c.capability_id} value={c.capability_id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-secondary">Caller agent (optional)
                <select value={callerAgentId} onChange={(e) => setCallerAgentId(e.target.value)} className={INPUT_CLASS}>
                  <option value="">Anonymous</option>
                  {callerAgents.map((a) => (
                    <option key={a.agent_id} value={a.agent_id}>{a.agent_name || a.agent_id}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] text-tertiary">Attribute this invocation to one of your governed Fleet agents.</span>
              </label>
              <label className="text-xs text-secondary sm:col-span-2">Declared goal (optional)
                <input value={declaredGoal} onChange={(e) => setDeclaredGoal(e.target.value)}
                  placeholder="Why this invocation is being made" className={INPUT_CLASS} />
              </label>
              <label className="text-xs text-secondary sm:col-span-2">Payload (JSON)
                <textarea value={payloadText} onChange={(e) => { setPayloadText(e.target.value); setJsonError(null); }}
                  rows={4} spellCheck={false}
                  className={`${INPUT_CLASS} font-mono text-xs`} />
              </label>
            </div>
            {jsonError && <p role="alert" className="mt-2 text-xs text-error">{jsonError}</p>}
            {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
            <button onClick={handleInvoke} disabled={submitting || !capabilityId}
              className="mt-3 rounded-lg border border-brand/20 bg-brand/10 px-4 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
              {submitting ? 'Invoking…' : 'Invoke'}
            </button>

            {result && badge && (
              <div className="mt-4 rounded-lg border border-border bg-surface-tertiary p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                  {actionId && (
                    <Link href={`/decisions/${actionId}`} className="text-xs text-brand transition-colors hover:underline">
                      View in Decisions →
                    </Link>
                  )}
                </div>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-secondary">
                  {JSON.stringify(result.payload, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
