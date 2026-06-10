import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  ChevronLeft,
  Coins,
  Database,
  Cog,
  Wrench,
  Target,
  ListTree,
} from 'lucide-react';
import { getSql } from '../../../lib/db';
import {
  getSessionDetail,
  listSignalsForSession,
} from '../../../lib/repositories/code-sessions.repository';
import { estimateCost } from '../../../lib/billing';
import { labelFor, severityRank } from '../../../lib/claude-code/signal-labels';
import PageLayout from '../../../components/PageLayout';
import { Card, CardHeader, CardContent } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { StatCompact } from '../../../components/ui/Stat';
import OptimalFilesPanel from './OptimalFilesPanel';
import { buildAutopsyFromDetail } from '../../../lib/claude-code/goals';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TIMELINE_DEFAULT_CAP = 50;

// /goal autopsy outcome → verdict-chip tone via the Badge variant. The label
// always pairs with the color so the verdict survives a color-blind / WCAG read.
// Unknown or future outcomes fall back to a neutral chip rather than blank.
const OUTCOME_META: Record<string, { label: string; variant: string }> = {
  completed: { label: 'Completed', variant: 'success' },
  thrashed: { label: 'Thrashed', variant: 'warning' },
  fell_back_to_rules: { label: 'Fell back to rules', variant: 'warning' },
  timed_out: { label: 'Timed out', variant: 'warning' },
  aborted: { label: 'Aborted', variant: 'error' },
};

function OutcomeChip({ outcome }: { outcome?: any }) {
  const meta = OUTCOME_META[outcome]
    || { label: outcome || 'unknown', variant: 'default' };
  return <Badge variant={meta.variant} size="sm">{meta.label}</Badge>;
}

function formatElapsed(ms: number) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default async function CodeSessionDetailPage({ params }: { params: Promise<{ projectId: string; sessionId: string }> }) {
  const { projectId, sessionId } = await params;
  const h = await headers();
  const orgId = h.get('x-org-id') || 'org_default';
  const sql = getSql();

  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) notFound();
  const { session, messages, toolUses }: { session: any; messages: any[]; toolUses: any[] } = detail as any;
  const signals = await listSignalsForSession(sql, orgId, sessionId).catch(() => []);
  // Same shared assembler the autopsy API route uses, over the rows already
  // loaded above — the UI verdict can't drift from the API verdict.
  const autopsy = buildAutopsyFromDetail(detail as any) as any;

  // Mission Control reconciliation per A10: Agent Spend folds cache_read into
  // tokens_in at 10% and prices through the 2-column billing table; session
  // cost uses raw 4-column pricing. They should agree within ~5% for most
  // sessions; a >2x spread is a real divergence worth flagging.
  const foldedCacheTokensIn =
    (session.input_tokens || 0)
    + (session.cache_creation_tokens || 0)
    + Math.round((session.cache_read_tokens || 0) * 0.1);
  const missionControlCost = estimateCost(
    foldedCacheTokensIn,
    session.output_tokens || 0,
    session.model_primary,
  );
  const codeSessionsCost = Number(session.cost_usd || 0);
  const costRatio = codeSessionsCost > 0
    ? Math.max(missionControlCost, codeSessionsCost) / Math.min(missionControlCost, codeSessionsCost)
    : 0;
  const costDiverges = codeSessionsCost > 0 && costRatio >= 2;

  const cacheTotal = (session.input_tokens || 0)
                   + (session.cache_creation_tokens || 0)
                   + (session.cache_read_tokens || 0);
  const cacheHit = cacheTotal > 0 ? (session.cache_read_tokens || 0) / cacheTotal : 0;
  const cacheLow = cacheHit < 0.3;

  // Group repeated_run signals into one cluster summary so the panel doesn't
  // get overrun by N near-identical rows. The original payload is preserved
  // for the cluster detail.
  const namedSignals: any[] = [];
  const repeatedRuns: any[] = [];
  for (const sig of signals) {
    if (sig.kind === 'repeated_run') repeatedRuns.push(sig);
    else namedSignals.push(sig);
  }
  namedSignals.sort((a, b) => severityRank(b) - severityRank(a));

  const repeatedSummary = (() => {
    if (!repeatedRuns.length) return null;
    const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0 };
    const targetCounts = new Map<any, number>();
    for (const r of repeatedRuns) {
      byConfidence[r.confidence] = (byConfidence[r.confidence] || 0) + 1;
      const name = r.payload?.name || 'tool';
      const count = r.payload?.count || 1;
      targetCounts.set(name, (targetCounts.get(name) || 0) + count);
    }
    const topTargets = [...targetCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return { total: repeatedRuns.length, byConfidence, topTargets };
  })();

  // Filter chips for timeline. Server-rendered so it stays zero-JS — chips
  // are <Link>s carrying a `?filter=` query param consumed below.
  const filter = '';
  const totalMessages = messages.length;
  const filteredMessages = messages;
  const overCap = filteredMessages.length > TIMELINE_DEFAULT_CAP;
  const visibleMessages = filteredMessages.slice(0, TIMELINE_DEFAULT_CAP);
  const hiddenMessages = filteredMessages.slice(TIMELINE_DEFAULT_CAP);

  const sessionDuration = (() => {
    if (!session.started_at || !session.ended_at) return null;
    const ms = new Date(session.ended_at).getTime() - new Date(session.started_at).getTime();
    if (ms <= 0) return null;
    return formatElapsed(ms);
  })();

  function renderMessage(m: any) {
    const toolsForMessage = toolUses.filter((t: any) => t.message_id === m.id);
    return (
      <div key={m.id} className="rounded-lg border border-border bg-surface-tertiary/40 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
          <Badge variant="default" size="xs">{m.role}</Badge>
          {m.model && <span className="font-mono">{m.model}</span>}
          {m.timestamp && <span className="tabular-nums">{new Date(m.timestamp).toLocaleString()}</span>}
          {m.cost_usd != null && (
            <span className="tabular-nums text-secondary">${Number(m.cost_usd).toFixed(4)}</span>
          )}
          {toolsForMessage.length > 0 && (
            <Badge variant="default" size="xs">
              {toolsForMessage.length} tool{toolsForMessage.length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
        {m.text_preview && (
          <p className="mt-2 text-sm text-secondary line-clamp-3">{m.text_preview}</p>
        )}
        {toolsForMessage.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {toolsForMessage.map((t: any) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className="font-mono text-secondary">{t.name}</span>
                {t.target && <span className="truncate text-tertiary">{t.target}</span>}
                {t.action_id && (
                  <Link
                    href={`/replay/${t.action_id}`}
                    className="ml-auto shrink-0"
                  >
                    <Badge variant="success" size="xs">governed</Badge>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <PageLayout
      title="Session detail"
      subtitle={session.session_uuid}
      breadcrumbs={['Code Sessions', session.project_slug || projectId, String(session.session_uuid || '').slice(0, 8)]}
      maturity="beta"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Back control — a real button-styled link, not a bare underline. */}
        <Link
          href={`/code-sessions/${projectId}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary"
        >
          <ChevronLeft size={15} aria-hidden="true" />
          Back to project sessions
        </Link>

        {/* /goal autopsy — outcome verdict + where the cost went. Server-rendered
            from the same getSessionDetail rows the API uses (shared
            buildAutopsyFromDetail), so the UI verdict always matches the API. */}
        <Card hover={false}>
          <CardHeader title="Autopsy" icon={Target} />
          <CardContent>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <OutcomeChip outcome={autopsy.outcome} />
              <span className="text-xs tabular-nums text-tertiary">
                {autopsy.turns} turn{autopsy.turns === 1 ? '' : 's'}
              </span>
              <span className="text-xs tabular-nums text-tertiary">
                ${Number(autopsy.cost_usd).toFixed(2)}
              </span>
              {autopsy.elapsed_ms != null && (
                <span className="text-xs tabular-nums text-tertiary">{formatElapsed(autopsy.elapsed_ms)}</span>
              )}
            </div>

            {autopsy.goal_text && (
              <p className="mt-3 text-sm text-secondary">
                <span className="text-tertiary">Goal · </span>{autopsy.goal_text}
              </p>
            )}

            {autopsy.where_money_went?.length > 0 && (
              <div className="mt-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                  Where the cost went
                </div>
                <ul className="mt-3 space-y-2.5">
                  {autopsy.where_money_went.map((b: any) => {
                    const pct = Math.round((b.share || 0) * 100);
                    return (
                      <li key={b.bucket} className="flex items-center gap-3 text-xs">
                        <span className="w-32 shrink-0 truncate font-mono text-secondary">
                          {String(b.bucket || '—').replace(':', ' · ')}
                        </span>
                        <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full bg-brand"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="w-9 shrink-0 text-right tabular-nums text-tertiary">{pct}%</span>
                        <span className="w-16 shrink-0 text-right tabular-nums text-secondary">
                          ${Number(b.approxCost || 0).toFixed(2)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Session summary — model / message / source / timing as scannable stats
            instead of a cramped definition list. */}
        <Card hover={false}>
          <CardHeader title="Summary" icon={Cog} />
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <StatCompact label="Model" value={session.model_primary || '—'} />
              <StatCompact label="Messages" value={(session.message_count || 0).toLocaleString()} />
              <StatCompact label="Source" value={session.source || '—'} />
              <StatCompact label="Duration" value={sessionDuration || '—'} />
            </div>
            {session.started_at && (
              <p className="mt-4 text-xs tabular-nums text-tertiary">
                Started {new Date(session.started_at).toLocaleString()}
                {session.ended_at && ` · ended ${new Date(session.ended_at).toLocaleString()}`}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Cost — session vs Mission Control reconciliation, with the divergence
            flag promoted to a token-driven warning callout (no emoji). */}
        <Card hover={false}>
          <CardHeader title="Cost" icon={Coins} />
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
              <StatCompact label="Code Sessions" value={`$${codeSessionsCost.toFixed(4)}`} />
              <StatCompact label="Mission Control" value={`$${missionControlCost.toFixed(4)}`} />
              <StatCompact
                label="Cache hit rate"
                value={`${(cacheHit * 100).toFixed(1)}%`}
                color={cacheLow ? 'text-warning' : 'text-success'}
              />
            </div>
            {cacheLow && (
              <p className="mt-3 text-xs text-warning">Cache hit rate is below the 30% floor.</p>
            )}
            <p className="mt-4 text-xs text-tertiary">
              Code Sessions prices raw cache_read and cache_write separately; Mission Control
              folds cache_read at 10% into tokens_in. The two should agree within ~5% on normal sessions.
            </p>

            {costDiverges && (
              <div className="mt-4 rounded-xl border border-status-warning/30 bg-status-warning/10 p-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                  <div className="text-xs leading-relaxed text-secondary">
                    <span className="font-medium text-warning tabular-nums">{costRatio.toFixed(1)}× divergence</span>
                    {' '}— likely historical: this session was re-priced against the current pricing
                    table at ingest time, but the stored <code>cost_usd</code> may reflect older rates.
                    Run <code className="mx-1">scripts/backfill-code-session-cache-cost.mjs</code> to
                    recompute historical cost_usd against the latest <code>billing.js</code> rates.
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tokens — actual vs naive (no-cache) usage and the resulting savings. */}
        <Card hover={false}>
          <CardHeader title="Tokens" icon={Database} />
          <CardContent>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <StatCompact label="Input" value={(session.input_tokens || 0).toLocaleString()} />
              <StatCompact label="Output" value={(session.output_tokens || 0).toLocaleString()} />
              <StatCompact label="Cache write" value={(session.cache_creation_tokens || 0).toLocaleString()} />
              <StatCompact label="Cache read" value={(session.cache_read_tokens || 0).toLocaleString()} />
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Without caching (naive)
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                <StatCompact label="Naive cost" value={`$${Number(session.naive_cost_usd || 0).toFixed(4)}`} />
                <StatCompact
                  label="Cache savings"
                  value={`$${Number(session.cache_savings_usd || 0).toFixed(4)}`}
                  color="text-success"
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs tabular-nums sm:grid-cols-4">
                <div><span className="text-tertiary">input: </span>{Number(session.naive_input_tokens || 0).toLocaleString()}</div>
                <div><span className="text-tertiary">output: </span>{Number(session.naive_output_tokens || 0).toLocaleString()}</div>
                <div><span className="text-tertiary">cache write: </span>{Number(session.naive_cache_creation_tokens || 0).toLocaleString()}</div>
                <div><span className="text-tertiary">cache read: </span>{Number(session.naive_cache_read_tokens || 0).toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Parser</div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs tabular-nums sm:grid-cols-3">
                <div><span className="text-tertiary">version: </span>{session.parser_version}</div>
                <div><span className="text-tertiary">model requests: </span>{Number(session.model_requests || 0).toLocaleString()}</div>
                {Number(session.stuck_loops || 0) > 0 && (
                  <div className="text-warning">
                    <span className="text-tertiary">stuck loops: </span>{session.stuck_loops}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Signals — analyzer findings, severity-ordered, with repeated runs
            collapsed into one cluster. */}
        <Card hover={false}>
          <CardHeader
            title="Signals"
            icon={Wrench}
            count={namedSignals.length + (repeatedSummary ? repeatedSummary.total : 0)}
          />
          <CardContent>
            {!signals.length ? (
              <p className="text-sm text-tertiary">No signals for this session.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {namedSignals.map((sig: any) => {
                  const meta = labelFor(sig.kind);
                  const title = sig.payload?.title;
                  const description = sig.payload?.description;
                  return (
                    <li key={sig.id} className="border-l-2 border-border pl-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-primary">{meta.label}</span>
                        {sig.confidence && (
                          <Badge variant="default" size="xs" className="uppercase">
                            {sig.confidence}
                          </Badge>
                        )}
                        {sig.savings_usd != null && Number(sig.savings_usd) > 0 && (
                          <span className="text-xs tabular-nums text-success">
                            ≈ ${Number(sig.savings_usd).toFixed(2)} savings
                          </span>
                        )}
                      </div>
                      {title && <div className="mt-1 text-xs text-secondary">{title}</div>}
                      {description && (
                        <div className="mt-1 text-xs text-tertiary">{description}</div>
                      )}
                      {meta.suggestion && (
                        <div className="mt-1 text-xs italic text-tertiary">
                          → {meta.suggestion}
                        </div>
                      )}
                    </li>
                  );
                })}
                {repeatedSummary && (
                  <li className="border-l-2 border-border pl-3">
                    <details>
                      <summary className="cursor-pointer text-secondary">
                        <span className="font-medium text-primary">Repeated tool runs</span>
                        <span className="ml-2 text-xs text-tertiary">
                          {repeatedSummary.total} total — {repeatedSummary.byConfidence.high || 0} high,
                          {' '}{repeatedSummary.byConfidence.medium || 0} medium,
                          {' '}{repeatedSummary.byConfidence.low || 0} low
                        </span>
                      </summary>
                      <div className="mt-2 text-xs text-tertiary">
                        Top tools by call count:
                        <ul className="ml-4 mt-1 list-disc">
                          {repeatedSummary.topTargets.map(([name, count]) => (
                            <li key={name}><span className="font-mono text-secondary">{name}</span> ×{count}</li>
                          ))}
                        </ul>
                        <p className="mt-2 italic">→ {labelFor('repeated_run').suggestion}</p>
                      </div>
                    </details>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <OptimalFilesPanel sessionId={sessionId} />

        {/* Timeline — message-by-message stream, capped with expandable tail. */}
        <Card hover={false}>
          <CardHeader
            title="Timeline"
            icon={ListTree}
            action={
              <span className="text-xs tabular-nums text-tertiary">
                {totalMessages} message{totalMessages === 1 ? '' : 's'}
              </span>
            }
          />
          <CardContent>
            <div className="space-y-3">
              {visibleMessages.map(renderMessage)}
              {overCap && (
                <details className="rounded-lg border border-dashed border-border p-3">
                  <summary className="cursor-pointer text-sm text-tertiary">
                    Show remaining {hiddenMessages.length} message{hiddenMessages.length === 1 ? '' : 's'}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {hiddenMessages.map(renderMessage)}
                  </div>
                </details>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
