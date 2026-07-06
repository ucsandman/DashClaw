'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Search } from 'lucide-react';
import type { GuideArea, GuideData, ItemStatus } from './types';
import { AREA_BLURBS, NAV_GROUPS, buildQuickstart } from './data/curated';
import CodeTabs from './components/CodeTabs';
import PolicyPlayground from './components/PolicyPlayground';
import ReferenceItem from './components/ReferenceItem';
import StatusBadge from './components/StatusBadge';

const PROGRESS_KEY = 'dashclaw-platform-guide-progress';
const STATUS_ORDER: ItemStatus[] = ['stable', 'beta', 'experimental', 'deprecated', 'archived'];

function loadProgress(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export default function PlatformGuideClient() {
  const [data, setData] = useState<GuideData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/guides/platform-guide-data.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setLoadError(String(err)));
  }, []);

  if (loadError) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-16 text-sm text-error">
        Failed to load the guide data ({loadError}). Reload the page to retry.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-16 text-sm text-text-tertiary">
        Loading the full platform reference…
      </div>
    );
  }
  return <GuideBody data={data} />;
}

/** Normalize an endpoint string ("POST /api/guard", "/api/guard?x=1") to its /api path. */
function endpointPath(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  const match = endpoint.match(/\/api\/[a-zA-Z0-9_\-/{}[\]:]+/);
  return match ? match[0].replace(/\/$/, '').toLowerCase() : null;
}

function GuideBody({ data }: { data: GuideData }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<ItemStatus>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [hashTarget, setHashTarget] = useState('');

  useEffect(() => {
    setReviewed(loadProgress());
    const readHash = () => setHashTarget(window.location.hash.replace(/^#/, ''));
    readHash();
    window.addEventListener('hashchange', readHash);
    // '/' focuses search unless the user is already typing somewhere.
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', readHash);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Cross-link index: /api path -> SDK methods + MCP tools that call it, and
  // the reverse (API entry id per path) so SDK/MCP entries link back.
  const relatedByItemId = useMemo(() => {
    const byPath = new Map<string, { id: string; name: string; kind: string }[]>();
    const apiByPath = new Map<string, { id: string; name: string; kind: string }>();
    for (const area of data.areas) {
      for (const it of area.items) {
        if (it.kind === 'api' && it.status !== 'archived') {
          const p = endpointPath(it.interface);
          if (p && !apiByPath.has(p)) apiByPath.set(p, { id: it.id, name: it.name, kind: 'api' });
        }
        if (it.kind === 'sdk-node' || it.kind === 'sdk-python' || it.kind === 'mcp-tool') {
          const p = endpointPath(it.endpoint);
          if (!p) continue;
          if (!byPath.has(p)) byPath.set(p, []);
          byPath.get(p)!.push({ id: it.id, name: it.name, kind: it.kind });
        }
      }
    }
    const out = new Map<string, { id: string; name: string; kind: string }[]>();
    for (const area of data.areas) {
      for (const it of area.items) {
        if (it.kind === 'api') {
          const p = endpointPath(it.interface);
          const rel = (p && byPath.get(p)) || [];
          if (rel.length) out.set(it.id, rel.slice(0, 8));
        } else if (it.kind === 'sdk-node' || it.kind === 'sdk-python' || it.kind === 'mcp-tool') {
          const p = endpointPath(it.endpoint);
          const api = p ? apiByPath.get(p) : null;
          if (api) out.set(it.id, [api]);
        }
      }
    }
    return out;
  }, [data.areas]);

  function toggleReviewed(areaId: string) {
    const next = new Set(reviewed);
    if (next.has(areaId)) next.delete(areaId);
    else next.add(areaId);
    setReviewed(next);
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable */
    }
  }

  function toggleStatus(s: ItemStatus) {
    const next = new Set(statusFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setStatusFilter(next);
  }

  const normalizedQuery = query.trim().toLowerCase();

  const filteredAreas = useMemo(() => {
    return data.areas
      .map((area) => {
        let items = area.items;
        if (statusFilter.size > 0) items = items.filter((it) => statusFilter.has(it.status));
        if (normalizedQuery) {
          items = items.filter(
            (it) =>
              it.name.toLowerCase().includes(normalizedQuery) ||
              (it.purpose || '').toLowerCase().includes(normalizedQuery) ||
              it.interface.toLowerCase().includes(normalizedQuery)
          );
        }
        return { ...area, items };
      })
      .filter((area) => area.items.length > 0 || (!normalizedQuery && statusFilter.size === 0));
  }, [data.areas, normalizedQuery, statusFilter]);

  const areaById = new Map(filteredAreas.map((a) => [a.id, a]));
  const groupedIds = new Set(NAV_GROUPS.flatMap((g) => g.areaIds));
  const remainingApi = filteredAreas.filter((a) => a.id.startsWith('api-') && !groupedIds.has(a.id));

  const navGroups = NAV_GROUPS.map((g) => ({
    label: g.label,
    areas:
      g.label === 'API reference'
        ? remainingApi
        : (g.areaIds.map((id) => (id === 'quickstart' ? QUICKSTART_STUB : areaById.get(id))).filter(Boolean) as GuideArea[]),
  })).filter((g) => g.areas.length > 0);

  const totalAreas = data.areas.length + 1; // + quickstart
  const reviewedCount = [...reviewed].filter(
    (id) => id === 'quickstart' || data.areas.some((a) => a.id === id)
  ).length;

  const quickstart = useMemo(() => buildQuickstart(data), [data]);
  const counts = data.meta.counts;

  return (
    <div className="mx-auto flex max-w-7xl gap-8 px-4 py-8 sm:px-6">
      {/* Sidebar */}
      <nav className="sticky top-24 hidden max-h-[calc(100vh-120px)] w-64 shrink-0 self-start overflow-y-auto pr-2 lg:block">
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-xs text-text-tertiary">
            <span className="font-mono uppercase tracking-wider">Progress</span>
            <span className="tabular-nums">
              {reviewedCount}/{totalAreas}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${Math.round((reviewedCount / totalAreas) * 100)}%` }}
            />
          </div>
        </div>
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-2 font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
              {group.label}
            </p>
            {group.areas.map((area) => (
              <a
                key={area.id}
                href={`#${area.id}`}
                className="group flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-secondary transition-colors hover:bg-surface-secondary hover:text-white"
              >
                {reviewed.has(area.id) ? (
                  <CheckCircle2 size={12} className="shrink-0 text-success" />
                ) : (
                  <Circle size={12} className="shrink-0 text-text-disabled" />
                )}
                <span className="min-w-0 flex-1 truncate">{area.title}</span>
                <span className="font-mono text-[10px] tabular-nums text-text-disabled">
                  {area.id === 'quickstart' ? '' : area.items.length}
                </span>
              </a>
            ))}
          </div>
        ))}
      </nav>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-10">
        {/* Controls */}
        <div className="sticky top-16 z-10 -mx-1 space-y-2 rounded-xl border border-border bg-surface-primary/95 p-3 backdrop-blur">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${counts.total ?? ''} routes, methods, tools, pages…`}
              className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 pr-9 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                aria-pressed={statusFilter.has(s)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  statusFilter.has(s)
                    ? 'border-brand bg-brand/15 text-brand'
                    : 'border-border text-text-tertiary hover:border-border-hover hover:text-secondary'
                }`}
              >
                {s} <span className="tabular-nums">{counts[s] || 0}</span>
              </button>
            ))}
            {(statusFilter.size > 0 || query) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter(new Set());
                  setQuery('');
                }}
                className="rounded-full px-2.5 py-1 text-[11px] text-text-tertiary underline-offset-2 hover:text-white hover:underline"
              >
                clear
              </button>
            )}
          </div>
        </div>

        {/* Quickstart: the governed-action loop, all live captures */}
        {!normalizedQuery && statusFilter.size === 0 && (
          <section id="quickstart" className="scroll-mt-28 space-y-4">
            <AreaHeader
              title="The governed-action loop (live examples)"
              subtitle="Every request and response below was captured from a real running instance — HTTP and SDK examples against a local build, MCP examples against a live hosted instance. Keys and org ids are replaced with placeholders; nothing else is edited."
              reviewed={reviewed.has('quickstart')}
              onToggle={() => toggleReviewed('quickstart')}
            />
            <div className="space-y-6">
              {quickstart.map((ex) => (
                <div key={ex.title} className="space-y-2">
                  <h3 className="text-base font-semibold text-white">{ex.title}</h3>
                  <p className="text-sm text-secondary">{ex.blurb}</p>
                  {ex.forms.length > 0 ? (
                    <CodeTabs forms={ex.forms} />
                  ) : (
                    <p className="text-xs text-text-tertiary">No live capture available for this step.</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Areas */}
        {navGroups.map((group) =>
          group.areas
            .filter((a) => a.id !== 'quickstart')
            .map((area) => (
              <section key={area.id} id={area.id} className="scroll-mt-28 space-y-3">
                <AreaHeader
                  title={area.title}
                  subtitle={
                    AREA_BLURBS[area.id] ||
                    `${area.items.length} entries${area.segment ? ` under /api/${area.segment}` : ''}.`
                  }
                  reviewed={reviewed.has(area.id)}
                  onToggle={() => toggleReviewed(area.id)}
                  statusMix={area.items}
                />
                {area.id === 'api-policies' && <PolicyPlayground />}
                <div className="overflow-hidden rounded-xl border border-border bg-surface-secondary">
                  {area.items.map((item) => (
                    <ReferenceItem
                      key={item.id}
                      item={item}
                      forceOpen={hashTarget === item.id}
                      related={relatedByItemId.get(item.id) || []}
                    />
                  ))}
                  {area.items.length === 0 && (
                    <p className="px-4 py-3 text-xs text-text-tertiary">No entries match the current filter.</p>
                  )}
                </div>
              </section>
            ))
        )}
      </div>
    </div>
  );
}

const QUICKSTART_STUB = {
  id: 'quickstart',
  kind: 'quickstart',
  title: 'The governed-action loop',
  items: [],
} as unknown as GuideArea;

function AreaHeader({
  title,
  subtitle,
  reviewed,
  onToggle,
  statusMix,
}: {
  title: string;
  subtitle: string;
  reviewed: boolean;
  onToggle: () => void;
  statusMix?: GuideArea['items'];
}) {
  const mix = statusMix
    ? STATUS_ORDER.filter((s) => statusMix.some((it) => it.status === s))
    : [];
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-white">{title}</h2>
          {mix.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-secondary">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={reviewed}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
          reviewed
            ? 'border-status-success text-success'
            : 'border-border text-text-tertiary hover:border-border-hover hover:text-secondary'
        }`}
      >
        {reviewed ? <CheckCircle2 size={12} /> : <Circle size={12} />}
        {reviewed ? 'Reviewed' : 'Mark reviewed'}
      </button>
    </div>
  );
}
