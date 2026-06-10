'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderGit2, ChevronRight, Trash2 } from 'lucide-react';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { bulkAction } from '../lib/bulkAction';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import CopyPathButton from './CopyPathButton';

interface ProjectRow {
  id: string;
  slug: string;
  cwd: string | null;
  session_count: number | string;
  total_cost_usd: number | string | null;
  last_session_at: string | null;
}

/**
 * Client projects table for /code-sessions (server page passes the rows as
 * props — same server-page + client-child shape as WeeklyMemoPanel). Adds the
 * shared multi-select pattern + bulk Delete and an org-wide "Clear all" with
 * typed confirm. Path display: real cwd primary (font-mono + copy), slug
 * secondary; slug-only fallback when cwd is null.
 */
export default function ProjectsTable({ projects: initialProjects }: { projects: ProjectRow[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>(initialProjects);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearText, setClearText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selection = useSelection<ProjectRow>(projects, (p) => p.id);
  useSelectAllHotkey(selection.toggleAll);

  async function bulkDelete() {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(
      `Delete ${selection.count} ${selection.count === 1 ? 'project' : 'projects'} and all their sessions? This telemetry cannot be recovered.`
    )) return;
    const { ok, failed } = await bulkAction(selection.selectedIds, (id) =>
      fetch(`/api/code-sessions/projects/${id}`, { method: 'DELETE' })
    );
    setProjects((prev) => prev.filter((p) => !ok.includes(p.id)));
    if (failed.length > 0) setError(`${failed.length} delete${failed.length === 1 ? '' : 's'} failed`);
    selection.clear();
  }

  async function clearAll() {
    setClearing(true);
    setError(null);
    try {
      const res = await fetch('/api/code-sessions/projects?confirm=all', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Clear all failed');
        return;
      }
      setProjects([]);
      selection.clear();
      setClearOpen(false);
      setClearText('');
      router.refresh();
    } catch {
      setError('Clear all failed');
    } finally {
      setClearing(false);
    }
  }

  const sessionTotal = projects.reduce((n, p) => n + (Number(p.session_count) || 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-3">
        <BulkActionBar
          count={selection.count}
          actions={[{ id: 'delete', label: 'Delete', icon: Trash2, onClick: bulkDelete, danger: true }]}
          onClear={selection.clear}
        />
        {selection.count === 0 && (
          <span className="text-xs tabular-nums text-tertiary">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </span>
        )}
        <button
          type="button"
          onClick={() => setClearOpen(true)}
          className="text-xs font-medium text-tertiary transition-colors hover:text-error"
        >
          Clear all…
        </button>
      </div>

      {error && (
        <div role="alert" className="border-b border-error/20 bg-error-subtle px-6 py-2 text-xs text-error">
          {error}
        </div>
      )}

      {/* Typed-confirm modal — clearing is irreversible telemetry loss. */}
      {clearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="clear-all-title">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface-secondary p-5">
            <h2 id="clear-all-title" className="text-sm font-semibold text-white">Clear all code sessions</h2>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              This permanently deletes {projects.length} {projects.length === 1 ? 'project' : 'projects'} and{' '}
              {sessionTotal} {sessionTotal === 1 ? 'session' : 'sessions'} — messages, tool uses, signals, and memos
              included. Handoff bundles survive, detached from their projects. This cannot be undone.
            </p>
            <label htmlFor="clear-all-confirm" className="mt-4 block text-xs text-tertiary">
              Type <span className="font-mono font-semibold text-error">DELETE</span> to confirm
            </label>
            <input
              id="clear-all-confirm"
              value={clearText}
              onChange={(e) => setClearText(e.target.value)}
              autoComplete="off"
              className="mt-1.5 w-full rounded-md border border-border bg-surface-tertiary px-3 py-1.5 font-mono text-sm text-white outline-none focus:border-error/50"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setClearOpen(false); setClearText(''); }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={clearText !== 'DELETE' || clearing}
                className="rounded-md border border-error/30 bg-error-subtle px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {clearing ? 'Clearing…' : 'Clear everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              <th className="w-10 px-4 py-4">
                <SelectCheckbox checked={selection.allSelected} onToggle={() => selection.toggleAll()} label="Select all projects" />
              </th>
              <th className="px-2 py-4">Project</th>
              <th className="px-6 py-4 text-right">Sessions</th>
              <th className="px-6 py-4 text-right">Total cost</th>
              <th className="px-6 py-4">Last activity</th>
              <th className="px-6 py-4 text-right">Inspect</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {projects.map((p) => (
              <tr key={p.id} data-entity-type="codeSession" data-entity-id={p.id} className="transition-colors hover:bg-white/[0.02]">
                <td className="w-10 px-4 py-4">
                  <SelectCheckbox checked={selection.isSelected(p.id)} onToggle={() => selection.toggle(p.id)} label={`Select ${p.slug}`} />
                </td>
                <td className="px-2 py-4">
                  <Link href={`/code-sessions/${p.id}`} className="group/name flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-white/[0.03] text-secondary">
                      <FolderGit2 size={16} />
                    </div>
                    <div className="min-w-0">
                      {p.cwd ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-mono text-sm font-medium text-white transition-colors group-hover/name:text-brand">
                              {p.cwd}
                            </span>
                            <CopyPathButton path={p.cwd} />
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-tertiary">{p.slug}</div>
                        </>
                      ) : (
                        <div className="truncate text-sm font-medium text-white transition-colors group-hover/name:text-brand">
                          {p.slug}
                        </div>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-6 py-4 text-right text-sm text-secondary tabular-nums">
                  {p.session_count}
                </td>
                <td className="px-6 py-4 text-right text-sm font-medium text-white tabular-nums">
                  ${Number(p.total_cost_usd || 0).toFixed(2)}
                </td>
                <td className="px-6 py-4">
                  {p.last_session_at ? (
                    <div className="flex flex-col text-xs">
                      <span className="text-secondary tabular-nums">
                        {new Date(p.last_session_at).toLocaleDateString()}
                      </span>
                      <span className="text-[11px] text-tertiary tabular-nums">
                        {new Date(p.last_session_at).toLocaleTimeString()}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-tertiary">Never</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <Link
                    href={`/code-sessions/${p.id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand transition-colors hover:text-brand-hover"
                  >
                    Inspect <ChevronRight size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
