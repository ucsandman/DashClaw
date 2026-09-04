'use client';

import { Database } from 'lucide-react';

/**
 * Database containment evidence (RFC 2026-09-04-database-containment).
 *
 * The hook posts the SAME `artifact_type: 'patch'` artifact the file path uses
 * — only its content differs (`kind: 'db'`) — so the route's evidence binding
 * and every artifact fetch stay unchanged. This is what the operator reads
 * before Promote: the statement that ran, the schema diff Neon reports between
 * the staged branch and its parent (or the note saying there is none), and the
 * tail of the command's output. Rendered identically on /approvals (the
 * ContainmentCard) and /decisions/[actionId].
 */
export interface PatchArtifactContent {
  /** 'db' for a database branch; absent/other means the file-worktree shape. */
  kind?: string;
  diff?: string;
  stat?: string;
  ref?: string;
  truncated?: boolean;
  untracked?: string[];
  // db-only
  statement?: string;
  stdout_tail?: string;
  project_id?: string;
  branch_id?: string;
  parent_branch_id?: string;
  db_name?: string;
  note?: string;
}

export const DB_SCHEMA_UNCHANGED_NOTE =
  'Schema unchanged — data changes are not diffable. Review the statement and its output.';

export function isDbPatchContent(content: PatchArtifactContent | null | undefined): boolean {
  return Boolean(content && content.kind === 'db');
}

function SchemaDiffLine({ line }: { line: string }) {
  const isAdd = line.startsWith('+') && !line.startsWith('+++');
  const isDel = line.startsWith('-') && !line.startsWith('---');
  const tone = isAdd ? 'text-status-success' : isDel ? 'text-status-error' : 'text-secondary';
  return <div className={tone}>{line || ' '}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-disabled">{children}</div>;
}

export default function ContainmentDbEvidence({ content }: { content: PatchArtifactContent }) {
  const diff = typeof content.diff === 'string' ? content.diff.trim() : '';
  const stdoutTail = typeof content.stdout_tail === 'string' ? content.stdout_tail.trim() : '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Database size={14} className="text-brand" />
        <span className="text-xs font-medium text-secondary">Database branch</span>
        <span className="font-mono text-[11px] text-tertiary">{content.branch_id || 'branch id not captured'}</span>
        {content.db_name && <span className="text-[11px] text-tertiary">· {content.db_name}</span>}
      </div>

      <div>
        <SectionLabel>Statement</SectionLabel>
        <pre className="max-h-48 overflow-x-auto rounded-lg border border-border bg-black/30 p-3 font-mono text-xs leading-relaxed text-secondary">
          {content.statement || 'Not captured.'}
        </pre>
      </div>

      <div>
        <SectionLabel>Schema diff</SectionLabel>
        {diff ? (
          <pre className="max-h-96 overflow-x-auto rounded-lg border border-border bg-black/30 p-3 font-mono text-xs leading-relaxed">
            {diff.split('\n').map((line, i) => <SchemaDiffLine key={i} line={line} />)}
          </pre>
        ) : (
          <div className="rounded-lg border border-border bg-surface-tertiary px-3 py-2.5 text-xs text-tertiary">
            {content.note || DB_SCHEMA_UNCHANGED_NOTE}
          </div>
        )}
      </div>

      {stdoutTail && (
        <div>
          <SectionLabel>Output</SectionLabel>
          <pre className="max-h-48 overflow-x-auto rounded-lg border border-border bg-black/30 p-3 font-mono text-xs leading-relaxed text-secondary">
            {stdoutTail}
          </pre>
        </div>
      )}
    </div>
  );
}
