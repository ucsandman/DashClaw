/**
 * Pure grouping/formatting helpers for the interruption contract's suppressed
 * patterns ("Never bother me about"). Learned allow_grant rules arrive one per
 * occurrence — often dozens of raw filesystem paths — so the panel groups them
 * by action type, dedupes identical shapes, and renders paths basename-first.
 */

export interface GrantLike {
  policy_id: string;
  label: string;
  shape_key: string;
  created_at?: string | null;
}

export interface SuppressedRow {
  shape_key: string;
  actionType: string;
  target: string | null;
  /** Every policy id sharing this shape (duplicates collapse into one row). */
  policy_ids: string[];
}

export interface SuppressedGroup {
  type: string;
  rows: SuppressedRow[];
  /** Every policy id in the group, for the bulk clear-group action. */
  policy_ids: string[];
}

export function groupGrants(grants: GrantLike[]): SuppressedGroup[] {
  const byShape = new Map<string, SuppressedRow>();
  for (const g of grants) {
    const sep = g.shape_key.indexOf('::');
    const actionType = (sep >= 0 ? g.shape_key.slice(0, sep) : g.shape_key) || 'other';
    const target = sep >= 0 ? g.shape_key.slice(sep + 2) || null : null;
    const existing = byShape.get(g.shape_key);
    if (existing) existing.policy_ids.push(g.policy_id);
    else byShape.set(g.shape_key, { shape_key: g.shape_key, actionType, target, policy_ids: [g.policy_id] });
  }

  const byType = new Map<string, SuppressedRow[]>();
  for (const row of byShape.values()) {
    const rows = byType.get(row.actionType);
    if (rows) rows.push(row);
    else byType.set(row.actionType, [row]);
  }

  return [...byType.entries()]
    .map(([type, rows]) => ({
      type,
      rows: rows.sort((a, b) => (a.target || '').localeCompare(b.target || '')),
      policy_ids: rows.flatMap((r) => r.policy_ids),
    }))
    .sort((a, b) => b.rows.length - a.rows.length || a.type.localeCompare(b.type));
}

/**
 * Long filesystem paths render basename-first with a middle-truncated dir;
 * the untouched original belongs on the title attribute.
 */
export function formatTarget(target: string | null, max = 64): { display: string; full: string } {
  if (!target) return { display: '(any target)', full: '' };
  const isPath = /[\\/]/.test(target);
  if (!isPath || target.length <= max) return { display: target, full: target };

  const parts = target.split(/[\\/]/).filter(Boolean);
  const basename = parts[parts.length - 1] || target;
  const dir = target.slice(0, target.length - basename.length);
  const room = Math.max(8, max - basename.length - 4);
  const head = Math.ceil(room / 2);
  const tail = Math.floor(room / 2);
  const truncatedDir = dir.length > room ? `${dir.slice(0, head)}…${dir.slice(-tail)}` : dir;
  return { display: `${basename} · ${truncatedDir}`, full: target };
}

export function addedWithinDays(
  grants: Array<Pick<GrantLike, 'created_at'>>,
  days: number,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - days * 86_400_000;
  return grants.filter((g) => {
    if (!g.created_at) return false;
    const t = new Date(g.created_at).getTime();
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}
