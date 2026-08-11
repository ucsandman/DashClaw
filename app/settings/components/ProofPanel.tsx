const STATUS_ICON: Record<string, string> = { pass: 'OK', fail: '!!', warn: '!', info: 'i' };
const STATUS_COLOR: Record<string, string> = { pass: 'text-success', fail: 'text-error', warn: 'text-warning', info: 'text-cyan-300' };

interface ProofCheck {
  id: string;
  status: string;
  label?: string;
  detail?: string;
  next_action?: string;
}

interface ProofCategory {
  id: string;
  status: string;
  title?: string;
  summary?: string;
  checks?: ProofCheck[];
}

interface ProofArtifact {
  categories?: ProofCategory[];
  verification?: unknown;
}

interface ProofPanelProps {
  view: { proofArtifact: ProofArtifact };
  proofDownloadHref: string;
}

export function ProofPanel({ view, proofDownloadHref }: ProofPanelProps) {
  const artifact = view.proofArtifact;
  const categories = artifact.categories || [];

  const counts: Record<string, number> = { pass: 0, fail: 0, warn: 0, info: 0 };
  for (const cat of categories) {
    for (const check of cat.checks || []) {
      counts[check.status] = (counts[check.status] || 0) + 1;
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-tertiary px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-tertiary">Verification proof</p>
        <a
          href={proofDownloadHref}
          className="text-xs text-tertiary underline transition-colors hover:text-secondary"
        >
          Download JSON
        </a>
      </div>

      {/* Aggregate check summary — surfaces the readable score instead of an
          opaque download. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full border border-emerald-900/40 bg-emerald-900/10 px-2 py-0.5 text-success">
          {counts.pass} passed
        </span>
        <span className="rounded-full border border-red-900/40 bg-red-900/10 px-2 py-0.5 text-error">
          {counts.fail} failed
        </span>
        {(counts.warn ?? 0) > 0 && (
          <span className="rounded-full border border-amber-900/40 bg-amber-900/10 px-2 py-0.5 text-warning">
            {counts.warn} warning{counts.warn === 1 ? '' : 's'}
          </span>
        )}
        {(counts.info ?? 0) > 0 && (
          <span className="rounded-full border border-cyan-900/40 bg-cyan-900/10 px-2 py-0.5 text-cyan-300">
            {counts.info} info
          </span>
        )}
      </div>

      {/* Per-category breakdown with nested checks. */}
      <div className="mt-3 space-y-2">
        {categories.map((cat) => {
          const allPass = (cat.checks || []).every((c) => c.status === 'pass');
          return (
            <details
              key={cat.id}
              open={!allPass}
              className="overflow-hidden rounded-lg border border-border bg-surface-secondary"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs select-none [&::-webkit-details-marker]:hidden">
                <span className={`shrink-0 font-bold ${STATUS_COLOR[cat.status] || 'text-tertiary'}`}>
                  {STATUS_ICON[cat.status] || 'i'}
                </span>
                <span className="min-w-0 flex-1 font-semibold text-secondary">{cat.title}</span>
                {cat.summary && <span className="truncate text-[10px] text-tertiary">{cat.summary}</span>}
              </summary>
              <div className="divide-y divide-border border-t border-border">
                {(cat.checks || []).map((check) => (
                  <div key={check.id} className="flex items-start gap-2 px-3 py-2">
                    <span className={`mt-0.5 w-4 shrink-0 text-[10px] font-bold ${STATUS_COLOR[check.status] || 'text-tertiary'}`}>
                      {STATUS_ICON[check.status] || 'i'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-secondary">{check.label}</p>
                      {check.detail && <p className="mt-0.5 text-[11px] text-tertiary">{check.detail}</p>}
                      {check.next_action && (
                        <p className="mt-0.5 text-[11px] text-secondary">Next action: {check.next_action}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-tertiary select-none">
          Preview raw artifact
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-[10px] font-mono text-tertiary">
          {JSON.stringify(artifact.verification, null, 2)}
        </pre>
      </details>
    </div>
  );
}
