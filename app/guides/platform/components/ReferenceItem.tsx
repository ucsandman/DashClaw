'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FlaskConical } from 'lucide-react';
import type { GuideItem } from '../types';
import StatusBadge from './StatusBadge';
import CopyButton from './CopyButton';
import TryItPanel from './TryItPanel';

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[110px_1fr]">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">{label}</span>
      <div className="min-w-0 text-xs leading-relaxed text-secondary">{children}</div>
    </div>
  );
}

function InputsTable({ inputs }: { inputs: Record<string, unknown> }) {
  const rows: Array<[string, string]> = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, prefix ? `${prefix}.${key}` : key);
      } else {
        rows.push([prefix ? `${prefix}.${key}` : key, String(value ?? '')]);
      }
    }
  };
  walk(inputs, '');
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.map(([field, meaning]) => (
            <tr key={field} className="border-t border-border first:border-t-0">
              <td className="whitespace-nowrap py-1 pr-4 align-top font-mono text-[11px] text-text-primary">
                {field}
              </td>
              <td className="py-1 leading-relaxed text-text-tertiary">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One inventory entry: collapsed row -> expandable full reference card. */
export default function ReferenceItem({ item }: { item: GuideItem }) {
  const [open, setOpen] = useState(false);
  const [tryOpen, setTryOpen] = useState(false);

  const isApi = item.kind === 'api' && item.status !== 'archived';
  const [method = '', ...pathParts] = item.interface.split(' ');
  const apiPath = pathParts.join(' ');
  const canTry = isApi && !apiPath.includes('{') && !method.includes('/');

  return (
    <div className="border-t border-border first:border-t-0" id={item.id}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-tertiary"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-text-tertiary" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-text-tertiary" />
        )}
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">{item.name}</code>
        <StatusBadge status={item.status} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 pt-1 sm:pl-9">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-surface-primary px-3 py-1.5 font-mono text-xs text-secondary">
              {item.interface}
            </code>
            <CopyButton value={item.interface} compact />
          </div>
          {item.purpose && <DetailRow label="What">{item.purpose}</DetailRow>}
          {item.clickPath && <DetailRow label="Click path">{item.clickPath}</DetailRow>}
          {item.auth && <DetailRow label="Auth">{item.auth}</DetailRow>}
          {item.endpoint && (
            <DetailRow label="Calls">
              <code className="font-mono">{item.endpoint}</code>
            </DetailRow>
          )}
          {item.inputs && Object.keys(item.inputs).length > 0 && (
            <DetailRow label="Inputs">
              <InputsTable inputs={item.inputs} />
            </DetailRow>
          )}
          {item.envVars && item.envVars.length > 0 && (
            <DetailRow label="Env vars">
              <code className="font-mono">{item.envVars.join(', ')}</code>
            </DetailRow>
          )}
          {item.response && <DetailRow label="Returns">{item.response}</DetailRow>}
          {item.errors && <DetailRow label="Errors">{item.errors}</DetailRow>}
          {item.gotchas && <DetailRow label="Gotchas">{item.gotchas}</DetailRow>}
          {item.statusEvidence && <DetailRow label="Status why">{item.statusEvidence}</DetailRow>}
          {item.file && (
            <DetailRow label="Source">
              <code className="font-mono text-text-tertiary">{item.file}</code>
            </DetailRow>
          )}
          {canTry && !tryOpen && (
            <button
              type="button"
              onClick={() => setTryOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-brand hover:text-brand"
            >
              <FlaskConical size={12} />
              Try it against your instance
            </button>
          )}
          {canTry && tryOpen && (
            <TryItPanel
              method={method}
              path={apiPath}
              defaultBody={method === 'POST' || method === 'PATCH' || method === 'PUT' ? '{\n\n}' : ''}
              onClose={() => setTryOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
