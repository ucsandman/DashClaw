'use client';

import Link from 'next/link';
import { useMemo } from 'react';

// SVG fill/stroke colours for node tones and connector lines. These are SVG
// DOM attribute values (fill=/stroke=) and inline styles, not canvas 2D
// context colors, so CSS custom properties resolve fine here.
// Converted to token vars where a real token exists and its own value is the
// intended role (solid tokens for solid strokes, "-subtle" tokens for fill
// washes). Left as hardcoded hex/rgba where the constant encodes a bespoke
// opacity blend (no matching token at that alpha) or names a color family
// with no corresponding token (purple, sky, zinc) — forcing those would
// either wash out the visual or require CSS color-mix() beyond a plain var()
// swap.
const SVG_TONE_ERROR_FILL        = 'var(--color-error-subtle)';
const SVG_TONE_ERROR_STROKE      = 'var(--color-error)';
const SVG_TONE_SUCCESS_FILL      = 'var(--color-success-subtle)';
const SVG_TONE_SUCCESS_STROKE_60 = 'rgba(16,185,129,0.6)';   // --color-success @ 60% (no matching token alpha; not converted)
const SVG_TONE_SUCCESS_STROKE_55 = 'rgba(16,185,129,0.55)';  // --color-success @ 55% (no matching token alpha; not converted)
const SVG_TONE_PURPLE_FILL       = 'rgba(168,85,247,0.14)';  // purple-500 @ 14% (unresolved assumption) — no token
const SVG_TONE_PURPLE_STROKE     = 'rgba(168,85,247,0.6)';   // purple-500 @ 60% — no token
const SVG_TONE_APPROVAL_STROKE   = '#a855f7';                 // purple-500 (approval state) — no token
const SVG_TONE_APPROVAL_FILL     = 'rgba(168,85,247,0.18)';  // purple-500 @ 18% — no token
const SVG_TONE_WARNING_FILL      = 'var(--color-warning-subtle)';
const SVG_TONE_WARNING_STROKE    = 'rgba(245,158,11,0.7)';   // --color-warning @ 70% (no matching token alpha; not converted)
const SVG_TONE_INFO_FILL         = 'rgba(14,165,233,0.14)';  // sky-500 @ 14% (running) — no token (--color-info is blue, not sky)
const SVG_TONE_INFO_STROKE       = 'rgba(14,165,233,0.65)';  // sky-500 @ 65% — no token
const SVG_TONE_ZINC_FILL         = 'rgba(113,113,122,0.14)'; // zinc-500 @ 14% (default) — no token
const SVG_TONE_ZINC_STROKE       = 'rgba(113,113,122,0.55)'; // zinc-500 @ 55% — no token
const SVG_EDGE_STROKE            = 'rgba(255,255,255,0.18)';  // --color-border at a slightly higher opacity for edges (deliberately boosted; converting to var(--color-border) would dim edges below intent)

const NODE_WIDTH = 220;
const NODE_HEIGHT = 60;
const COL_GAP = 60;
const ROW_GAP = 24;
const PADDING = 20;

/**
 * Choose fill/stroke classes for a node based on its type + status.
 * Keeps blocked / invalidated / open-loop states visually obvious.
 */
function statusTone(type: any, status: any) {
  if (type === 'assumption') {
    if (status === 'invalidated') return { fill: SVG_TONE_ERROR_FILL, stroke: SVG_TONE_ERROR_STROKE };
    if (status === 'validated') return { fill: SVG_TONE_SUCCESS_FILL, stroke: SVG_TONE_SUCCESS_STROKE_60 };
    return { fill: SVG_TONE_PURPLE_FILL, stroke: SVG_TONE_PURPLE_STROKE }; // unresolved
  }
  if (type === 'loop') {
    return { fill: SVG_TONE_WARNING_FILL, stroke: SVG_TONE_WARNING_STROKE };
  }
  // action
  if (status === 'failed' || status === 'blocked') return { fill: SVG_TONE_ERROR_FILL, stroke: SVG_TONE_ERROR_STROKE };
  if (status === 'pending_approval') return { fill: SVG_TONE_APPROVAL_FILL, stroke: SVG_TONE_APPROVAL_STROKE };
  if (status === 'completed') return { fill: SVG_TONE_SUCCESS_FILL, stroke: SVG_TONE_SUCCESS_STROKE_55 };
  if (status === 'running') return { fill: SVG_TONE_INFO_FILL, stroke: SVG_TONE_INFO_STROKE };
  return { fill: SVG_TONE_ZINC_FILL, stroke: SVG_TONE_ZINC_STROKE };
}

function typeLabel(node: any) {
  if (node.type === 'assumption') return `assumption · ${node.status}`;
  if (node.type === 'loop') return `loop · ${node.status}${node.meta?.priority ? ` · ${node.meta.priority}` : ''}`;
  const bits = [node.actionType || 'action'];
  if (node.status) bits.push(node.status);
  if (node.riskScore != null) bits.push(`risk ${node.riskScore}`);
  return bits.join(' · ');
}

/**
 * Column-based layout: parents | root | children | related, with
 * assumption/loop rail stacked below the root column.
 */
function layoutNodes(graph: any) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return { laidOut: [], positions: new Map(), width: 0, height: 0 };
  }

  const rootId = `action:${graph.rootActionId}`;
  const nodeById = new Map<any, any>(graph.nodes.map((n: any) => [n.id, n]));

  const parents: any[] = [];
  const children: any[] = [];
  const related: any[] = [];
  const claimed = new Set([rootId]);

  for (const edge of graph.edges || []) {
    if (edge.type === 'parent_child' && edge.target === rootId && !claimed.has(edge.source)) {
      parents.push(edge.source);
      claimed.add(edge.source);
    } else if (edge.type === 'parent_child' && edge.source === rootId && !claimed.has(edge.target)) {
      children.push(edge.target);
      claimed.add(edge.target);
    } else if (edge.type === 'related' && !claimed.has(edge.target)) {
      related.push(edge.target);
      claimed.add(edge.target);
    }
  }

  const columns = [
    { nodes: parents.map((id) => nodeById.get(id)).filter(Boolean) },
    { nodes: [nodeById.get(rootId)].filter(Boolean) },
    { nodes: children.map((id) => nodeById.get(id)).filter(Boolean) },
    { nodes: related.map((id) => nodeById.get(id)).filter(Boolean) },
  ];

  const positions = new Map<any, any>();
  const laidOut: any[] = [];

  let x = PADDING;
  let maxActionY = PADDING;
  let rootColumnX = PADDING;

  for (const col of columns) {
    if (col.nodes.length === 0) continue;
    let y = PADDING;
    for (const n of col.nodes) {
      positions.set(n.id, { x, y });
      laidOut.push({ ...n, x, y });
      if (n.id === rootId) rootColumnX = x;
      y += NODE_HEIGHT + ROW_GAP;
    }
    maxActionY = Math.max(maxActionY, y);
    x += NODE_WIDTH + COL_GAP;
  }

  // Side rail for assumptions and loops — stacked below the root column
  const sideRail = graph.nodes.filter(
    (n: any) => (n.type === 'assumption' || n.type === 'loop') && !positions.has(n.id)
  );
  let railY = maxActionY + ROW_GAP;
  for (const n of sideRail) {
    positions.set(n.id, { x: rootColumnX, y: railY });
    laidOut.push({ ...n, x: rootColumnX, y: railY });
    railY += NODE_HEIGHT + ROW_GAP;
  }

  const width = Math.max(x + PADDING, rootColumnX + NODE_WIDTH + PADDING);
  const height = Math.max(maxActionY, railY) + PADDING;

  return { laidOut, positions, width, height };
}

interface ExecutionGraphProps {
  graph: any;
}

/**
 * Read-only execution graph. Renders action lineage (parents, sub-actions,
 * related), plus correlated assumptions and open loops, as an SVG canvas.
 * Action nodes deep-link into the corresponding decision replay page.
 */
export default function ExecutionGraph({ graph }: ExecutionGraphProps) {
  const { laidOut, positions, width, height } = useMemo(() => layoutNodes(graph), [graph]);

  if (!graph || laidOut.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-8 text-center text-sm text-secondary">
        No graph data available for this action yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="text-xs uppercase tracking-wider text-tertiary">Execution Graph</div>
        <div className="flex items-center gap-3 text-[10px] text-tertiary">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SVG_TONE_SUCCESS_STROKE_55 }} /> completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SVG_TONE_ERROR_STROKE }} /> failed / invalidated
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SVG_TONE_APPROVAL_STROKE }} /> approval
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SVG_TONE_WARNING_STROKE }} /> open loop
          </span>
        </div>
      </div>
      <div className="overflow-auto max-h-[560px]">
        <svg width={width} height={height} className="block">
          {/* Edges first so nodes paint over them */}
          {(graph.edges || []).map((edge: any) => {
            const s = positions.get(edge.source);
            const t = positions.get(edge.target);
            if (!s || !t) return null;

            const sx = s.x + NODE_WIDTH;
            const sy = s.y + NODE_HEIGHT / 2;
            const tx = t.x;
            const ty = t.y + NODE_HEIGHT / 2;

            // Side-rail edges (assumption/loop into root) are drawn as a short curve
            // from the top of the rail node up to the bottom of the target.
            const isSideRail = sx > tx;
            const path = isSideRail
              ? `M ${s.x + NODE_WIDTH / 2} ${s.y} C ${s.x + NODE_WIDTH / 2} ${s.y - 40}, ${t.x + NODE_WIDTH / 2} ${t.y + NODE_HEIGHT + 40}, ${t.x + NODE_WIDTH / 2} ${t.y + NODE_HEIGHT}`
              : `M ${sx} ${sy} C ${(sx + tx) / 2} ${sy}, ${(sx + tx) / 2} ${ty}, ${tx} ${ty}`;

            return (
              <g key={edge.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={SVG_EDGE_STROKE}
                  strokeWidth="1.5"
                />
                {edge.label && !isSideRail && (
                  <text
                    x={(sx + tx) / 2}
                    y={(sy + ty) / 2 - 4}
                    textAnchor="middle"
                    className="fill-zinc-500"
                    style={{ fontSize: 9 }}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {laidOut.map((node) => {
            const tone = statusTone(node.type, node.status);
            const href = node.type === 'action' ? `/decisions/${node.id.replace('action:', '')}` : null;
            const label = (node.label || '').slice(0, 34);
            const sub = typeLabel(node);

            const content = (
              <g>
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx="8"
                  ry="8"
                  fill={tone.fill}
                  stroke={tone.stroke}
                  strokeWidth={node.isRoot ? 2.5 : 1.5}
                />
                {node.isRoot && (
                  <rect
                    x={node.x + 8}
                    y={node.y + 8}
                    width={6}
                    height={6}
                    rx="1"
                    fill={tone.stroke}
                  />
                )}
                <text
                  x={node.x + (node.isRoot ? 22 : 12)}
                  y={node.y + 22}
                  className="fill-white"
                  style={{ fontSize: 12, fontWeight: 500 }}
                >
                  {label}
                </text>
                <text
                  x={node.x + 12}
                  y={node.y + 42}
                  className="fill-zinc-400"
                  style={{ fontSize: 10 }}
                >
                  {sub}
                </text>
              </g>
            );

            return href ? (
              <Link key={node.id} href={href} className="cursor-pointer">
                {content}
              </Link>
            ) : (
              <g key={node.id}>{content}</g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
