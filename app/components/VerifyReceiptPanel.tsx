'use client';

import { useState } from 'react';
import { ShieldCheck, ShieldX, FileCheck } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';

// Operator surface for POST /api/integrity/verify — lets an auditor holding a
// downloaded proof receipt or signed compliance bundle independently confirm
// it's authentic against the instance's published JWKS. Public + stateless:
// the route never reads the original record. Returns { ok, kid?, reason? }.

const TYPES = [
  { value: 'bundle', label: 'Signed bundle' },
  { value: 'receipt', label: 'Proof receipt' },
];

export default function VerifyReceiptPanel() {
  const [type, setType] = useState('bundle');
  const [json, setJson] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      setError('Paste valid JSON to verify.');
      return;
    }
    // If the pasted JSON is already wrapped ({receipt}/{bundle}) pass it
    // through; otherwise wrap it under the selected type.
    const body = parsed && (parsed.receipt || parsed.bundle) ? parsed : { [type]: parsed };
    setVerifying(true);
    try {
      const res = await fetch('/api/integrity/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><FileCheck size={14} className="text-brand" aria-hidden="true" />Verify a receipt or bundle</span>} />
      <CardContent className="space-y-3">
        <p className="text-xs text-tertiary">
          Paste a downloaded proof receipt or signed compliance bundle to confirm its signature against this
          instance&apos;s published keys. Stateless: the original record is never read.
        </p>
        <div role="tablist" aria-label="Artifact type" className="flex items-center gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={type === t.value}
              onClick={() => { setType(t.value); setResult(null); setError(null); }}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                type === t.value
                  ? 'border-brand/30 bg-brand/10 text-brand'
                  : 'border-transparent text-tertiary hover:border-border hover:text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleVerify} className="space-y-3">
          <label className="block">
            <span className="sr-only">Receipt or bundle JSON</span>
            <textarea
              value={json}
              onChange={(e) => setJson(e.target.value)}
              rows={6}
              placeholder='Paste the receipt or bundle JSON…'
              aria-label="Receipt or bundle JSON"
              className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-xs text-white placeholder:text-disabled focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={verifying || !json.trim()}
              aria-busy={verifying}
              className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
            >
              {verifying ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </form>

        {error && (
          <div role="alert" className="rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">{error}</div>
        )}

        {result && (
          <div
            role="status"
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              result.ok ? 'border-success/20 bg-success-subtle text-success' : 'border-error/20 bg-error-subtle text-error'
            }`}
          >
            {result.ok ? <ShieldCheck size={15} aria-hidden="true" /> : <ShieldX size={15} aria-hidden="true" />}
            <span className="font-medium">{result.ok ? 'Verified' : 'Not verified'}</span>
            {result.ok && result.kid && <Badge variant="success" size="xs">key: {result.kid}</Badge>}
            {!result.ok && (result.reason || result.error) && (
              <span className="text-xs">{result.reason || result.error}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
