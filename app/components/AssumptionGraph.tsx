'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, HelpCircle, RefreshCw, Zap, GitBranch,
} from 'lucide-react';

// SVG stroke colours for connector lines. These are SVG DOM attribute values
// (stroke=/fill=), not canvas 2D context colors, so they resolve CSS custom
// properties fine — token references here propagate from app/globals.css.
const SVG_COLOR_SUCCESS  = 'var(--color-success)';
const SVG_COLOR_ERROR    = 'var(--color-error)';
const SVG_COLOR_WARNING  = 'var(--color-warning)';
const SVG_COLOR_ZINC     = 'var(--color-text-disabled)'; // muted/cancelled
// No token exists for this solid zinc-700 connector stroke (--color-border is a
// translucent white at 8% opacity — swapping in that value would make these
// connector lines nearly invisible). Left as a hardcoded hex; not converted.
const SVG_COLOR_BORDER   = '#3f3f46'; // zinc-700, close to --color-border elevated
const SVG_COLOR_INFO     = 'var(--color-info)';

interface AssumptionGraphProps {
  trace: any;
  currentActionId: string;
  onNodeClick?: (node: { type: any; id: any; actionId: any }) => void;
}

/**
 * SVG + HTML trace graph for the post-mortem page.
 * Shows parent chain (center column), assumptions (left), loops (right), related actions (bottom).
 *
 * @param {Object} props
 * @param {Object} props.trace - Trace object from /api/actions/[id]/trace
 * @param {string} props.currentActionId - The current action being inspected
 * @param {Function} [props.onNodeClick] - Callback when a node is clicked ({ type, id, actionId })
 */
export default function AssumptionGraph({ trace, currentActionId, onNodeClick }: AssumptionGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  if (!trace) {
    return (
      <div className="py-6 text-center text-sm text-tertiary">
        No trace data available for this action.
      </div>
    );
  }

  const parentChain = trace.parent_chain || [];
  const allAssumptions = trace.assumptions?.items || [];
  const allLoops = trace.loops?.items || [];
  const subActions = trace.sub_actions || [];
  const relatedActions = trace.related_actions || [];

  const hasContent = parentChain.length > 0 || allAssumptions.length > 0 || allLoops.length > 0 || subActions.length > 0 || relatedActions.length > 0;

  if (!hasContent) {
    return (
      <div className="py-6 text-center text-sm text-tertiary">
        <GitBranch size={24} className="mx-auto mb-2 text-disabled" />
        No parent chain, assumptions, loops, or sub-actions to visualize.
      </div>
    );
  }

  // Layout constants
  const NODE_W = 220;
  const NODE_H = 56;
  const BRANCH_W = 200;
  const BRANCH_H = 44;
  const COL_CENTER_X = 300;
  const COL_LEFT_X = 40;
  const COL_RIGHT_X = 560;
  const ROW_GAP = 80;
  const SUB_ACTION_ROW_GAP = 80;
  const BRANCH_GAP_Y = 52;
  const PADDING_TOP = 30;
  const RELATED_Y_OFFSET = 60;

  // Build center column: reversed parent chain + current action
  const centerNodes = [
    ...parentChain.slice().reverse().map((p: any, i: number) => ({
      id: p.action_id,
      type: 'action',
      label: p.declared_goal || p.action_id,
      status: p.status,
      x: COL_CENTER_X,
      y: PADDING_TOP + i * ROW_GAP,
    })),
    {
      id: currentActionId,
      type: 'current',
      label: 'Current Action',
      status: null,
      x: COL_CENTER_X,
      y: PADDING_TOP + parentChain.length * ROW_GAP,
    },
  ];

  const currentActionNode = centerNodes[centerNodes.length - 1];

  // Build sub-actions row (below current action)
  const subActionNodes = subActions.map((s: any, i: number) => ({
    id: s.action_id,
    type: 'action', // using action style for subactions
    label: s.declared_goal || s.action_id,
    status: s.status,
    x: COL_CENTER_X + (i - (subActions.length - 1) / 2) * (NODE_W + 20),
    y: currentActionNode.y + SUB_ACTION_ROW_GAP,
  }));

  // Map assumptions/loops to their action in the center column
  const actionIndex: Record<string, number> = {};
  centerNodes.forEach((n, i) => { actionIndex[n.id] = i; });

  // Build left branches (assumptions)
  const leftBranches: any[] = [];
  allAssumptions.forEach((asm: any, idx: number) => {
    const parentIdx = actionIndex[asm.action_id];
    const anchorY = parentIdx !== undefined
      ? centerNodes[parentIdx].y
      : currentActionNode.y;
    leftBranches.push({
      id: asm.assumption_id,
      type: 'assumption',
      label: asm.assumption,
      validated: asm.validated,
      invalidated: !!asm.invalidated_at || asm.invalidated,
      x: COL_LEFT_X,
      y: anchorY + idx * BRANCH_GAP_Y,
      anchorY,
    });
  });

  // Build right branches (loops)
  const rightBranches: any[] = [];
  allLoops.forEach((loop: any, idx: number) => {
    const parentIdx = actionIndex[loop.action_id];
    const anchorY = parentIdx !== undefined
      ? centerNodes[parentIdx].y
      : currentActionNode.y;
    rightBranches.push({
      id: loop.loop_id,
      type: 'loop',
      label: loop.description,
      status: loop.status,
      x: COL_RIGHT_X,
      y: anchorY + idx * BRANCH_GAP_Y,
      anchorY,
    });
  });

  // Related actions (bottom row)
  const lastCenterY = currentActionNode.y;
  const lastSubActionY = subActionNodes.length > 0
    ? Math.max(...subActionNodes.map((n: any) => n.y))
    : lastCenterY;

  const branchMaxY = Math.max(
    ...leftBranches.map(b => b.y + BRANCH_H),
    ...rightBranches.map(b => b.y + BRANCH_H),
    lastCenterY + NODE_H,
    lastSubActionY + NODE_H,
  );
  const relatedY = branchMaxY + RELATED_Y_OFFSET;

  const relatedNodes = relatedActions.slice(0, 5).map((rel: any, idx: number) => ({
    id: rel.action_id,
    type: 'related',
    label: rel.declared_goal || rel.action_id,
    status: rel.status,
    x: 40 + idx * (NODE_W + 16),
    y: relatedY,
  }));

  const totalHeight = relatedNodes.length > 0
    ? relatedY + NODE_H + 30
    : branchMaxY + 30;

  const minX = Math.min(
    COL_LEFT_X,
    subActionNodes.length > 0 ? Math.min(...subActionNodes.map((n: any) => n.x)) : COL_LEFT_X,
    0
  );
  const maxX = Math.max(
    COL_RIGHT_X + BRANCH_W + 40,
    subActionNodes.length > 0 ? Math.max(...subActionNodes.map((n: any) => n.x)) + NODE_W + 40 : 0,
    relatedNodes.length > 0 ? relatedNodes[relatedNodes.length - 1].x + NODE_W + 40 : 0,
  );

  const totalWidth = maxX - minX;

  const getNodeColor = (node: any) => {
    if (node.type === 'current') return 'border-brand';
    if (node.type === 'assumption') {
      if (node.validated) return 'border-green-500';
      if (node.invalidated) return 'border-error';
      return 'border-warning';
    }
    if (node.type === 'loop') {
      if (node.status === 'resolved') return 'border-green-500';
      if (node.status === 'cancelled') return 'border-zinc-500';
      return 'border-warning';
    }
    // action / related
    switch (node.status) {
      case 'completed': return 'border-green-500/50';
      case 'failed': return 'border-error/50';
      case 'cancelled': return 'border-zinc-500/50';
      default: return 'border-zinc-600';
    }
  };

  const getLineColor = (node: any) => {
    if (node.type === 'assumption') {
      if (node.validated) return SVG_COLOR_SUCCESS;
      if (node.invalidated) return SVG_COLOR_ERROR;
      return SVG_COLOR_WARNING;
    }
    if (node.type === 'loop') {
      if (node.status === 'resolved') return SVG_COLOR_SUCCESS;
      if (node.status === 'cancelled') return SVG_COLOR_ZINC;
      return SVG_COLOR_WARNING;
    }
    return SVG_COLOR_BORDER;
  };

  const handleClick = (node: any) => {
    if (!onNodeClick) return;
    onNodeClick({
      type: node.type,
      id: node.id,
      actionId: node.type === 'action' || node.type === 'related' ? node.id : undefined,
    });
  };

  const NodeIcon = ({ node }: { node: any }) => {
    if (node.type === 'assumption') {
      if (node.validated) return <CheckCircle2 size={14} className="text-success flex-shrink-0" />;
      if (node.invalidated) return <XCircle size={14} className="text-error flex-shrink-0" />;
      return <HelpCircle size={14} className="text-warning flex-shrink-0" />;
    }
    if (node.type === 'loop') {
      if (node.status === 'resolved') return <CheckCircle2 size={14} className="text-success flex-shrink-0" />;
      if (node.status === 'cancelled') return <XCircle size={14} className="text-secondary flex-shrink-0" />;
      return <RefreshCw size={14} className="text-warning flex-shrink-0" />;
    }
    if (node.type === 'current') return <Zap size={14} className="text-brand flex-shrink-0" />;
    return <Zap size={14} className="text-secondary flex-shrink-0" />;
  };

  const offsetX = -minX;

  return (
    <div className="mb-8 overflow-x-auto">
      <div className="text-xs text-tertiary uppercase font-medium mb-3 flex items-center gap-2">
        <GitBranch size={14} />
        Trace Graph
      </div>
      <div
        ref={containerRef}
        className="relative bg-surface-secondary rounded-lg border border-border"
        style={{ width: totalWidth, height: totalHeight, minWidth: '100%' }}
      >
        {/* SVG connector lines */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={totalWidth}
          height={totalHeight}
          style={{ zIndex: 0 }}
        >
          {/* Center column vertical connectors */}
          {centerNodes.map((node, idx) => {
            if (idx === 0) return null;
            const prev = centerNodes[idx - 1];
            return (
              <line
                key={`center-${idx}`}
                x1={prev.x + NODE_W / 2 + offsetX} y1={prev.y + NODE_H}
                x2={node.x + NODE_W / 2 + offsetX} y2={node.y}
                stroke={SVG_COLOR_BORDER} strokeWidth={1.5} strokeDasharray="4 3"
              />
            );
          })}

          {/* Sub-action connectors (current -> children) */}
          {subActionNodes.map((child: any) => (
            <path
              key={`sub-${child.id}`}
              d={`M${currentActionNode.x + NODE_W / 2 + offsetX},${currentActionNode.y + NODE_H} C${currentActionNode.x + NODE_W / 2 + offsetX},${child.y} ${child.x + NODE_W / 2 + offsetX},${currentActionNode.y + NODE_H} ${child.x + NODE_W / 2 + offsetX},${child.y}`}
              fill="none"
              stroke={SVG_COLOR_INFO}
              strokeWidth={1.5}
              strokeOpacity={0.4}
              strokeDasharray="4 2"
            />
          ))}

          {/* Left branch connectors (assumption -> center) */}
          {leftBranches.map(branch => {
            const cx = COL_CENTER_X + offsetX;
            const startX = branch.x + BRANCH_W + offsetX;
            const startY = branch.y + BRANCH_H / 2;
            const endX = cx;
            const endY = branch.anchorY + NODE_H / 2;
            const midX = (startX + endX) / 2;
            return (
              <path
                key={`lbranch-${branch.id}`}
                d={`M${startX},${startY} C${midX},${startY} ${midX},${endY} ${endX},${endY}`}
                fill="none"
                stroke={getLineColor(branch)}
                strokeWidth={1.5}
                strokeOpacity={0.6}
              />
            );
          })}

          {/* Right branch connectors (center -> loop) */}
          {rightBranches.map(branch => {
            const cx = COL_CENTER_X + NODE_W + offsetX;
            const endX = branch.x + offsetX;
            const endY = branch.y + BRANCH_H / 2;
            const startY = branch.anchorY + NODE_H / 2;
            const midX = (cx + endX) / 2;
            return (
              <path
                key={`rbranch-${branch.id}`}
                d={`M${cx},${startY} C${midX},${startY} ${midX},${endY} ${endX},${endY}`}
                fill="none"
                stroke={getLineColor(branch)}
                strokeWidth={1.5}
                strokeOpacity={0.6}
              />
            );
          })}
        </svg>

        {/* HTML node overlay */}
        {/* Center column nodes */}
        {centerNodes.map(node => (
          <div
            key={node.id}
            onClick={() => handleClick(node)}
            className={`absolute rounded-lg border-2 ${getNodeColor(node)} bg-surface-primary px-3 py-2 cursor-pointer hover:brightness-125 transition-all ${
              node.type === 'current' ? 'ring-1 ring-brand/40' : ''
            }`}
            style={{
              left: node.x + offsetX,
              top: node.y,
              width: NODE_W,
              height: NODE_H,
              zIndex: 1,
            }}
          >
            <div className="flex items-center gap-2">
              <NodeIcon node={node} />
              <span className="text-xs text-white font-medium truncate">{node.label}</span>
            </div>
            {node.status && (
              <span className={`text-[10px] mt-0.5 inline-block ${
                node.status === 'completed' ? 'text-success' :
                node.status === 'failed' ? 'text-error' : 'text-secondary'
              }`}>
                {node.status}
              </span>
            )}
          </div>
        ))}

        {/* Sub-action nodes */}
        {subActionNodes.map((node: any) => (
          <div
            key={node.id}
            onClick={() => handleClick(node)}
            className={`absolute rounded-lg border-2 ${getNodeColor(node)} bg-surface-primary px-3 py-2 cursor-pointer hover:brightness-125 transition-all`}
            style={{
              left: node.x + offsetX,
              top: node.y,
              width: NODE_W,
              height: NODE_H,
              zIndex: 1,
            }}
          >
            <div className="flex items-center gap-2">
              <NodeIcon node={node} />
              <span className="text-xs text-secondary font-medium truncate">{node.label}</span>
            </div>
            {node.status && (
              <span className={`text-[10px] mt-0.5 inline-block ${
                node.status === 'completed' ? 'text-success' :
                node.status === 'failed' ? 'text-error' : 'text-secondary'
              }`}>
                {node.status}
              </span>
            )}
          </div>
        ))}

        {/* Left branches (assumptions) */}
        {leftBranches.map(node => (
          <div
            key={node.id}
            onClick={() => handleClick(node)}
            className={`absolute rounded-full border ${getNodeColor(node)} bg-surface-primary px-3 py-1.5 cursor-pointer hover:brightness-125 transition-all`}
            style={{
              left: node.x,
              top: node.y,
              width: BRANCH_W,
              height: BRANCH_H,
              zIndex: 1,
            }}
          >
            <div className="flex items-center gap-2 h-full">
              <NodeIcon node={node} />
              <span className="text-[11px] text-secondary truncate">{node.label}</span>
            </div>
          </div>
        ))}

        {/* Right branches (loops) */}
        {rightBranches.map(node => (
          <div
            key={node.id}
            onClick={() => handleClick(node)}
            className={`absolute rounded-full border ${getNodeColor(node)} bg-surface-primary px-3 py-1.5 cursor-pointer hover:brightness-125 transition-all`}
            style={{
              left: node.x,
              top: node.y,
              width: BRANCH_W,
              height: BRANCH_H,
              zIndex: 1,
            }}
          >
            <div className="flex items-center gap-2 h-full">
              <NodeIcon node={node} />
              <span className="text-[11px] text-secondary truncate">{node.label}</span>
            </div>
          </div>
        ))}

        {/* Related actions (bottom row) */}
        {relatedNodes.map((node: any) => (
          <div
            key={node.id}
            onClick={() => handleClick(node)}
            className={`absolute rounded-lg border ${getNodeColor(node)} bg-surface-primary px-3 py-2 cursor-pointer hover:brightness-125 transition-all`}
            style={{
              left: node.x,
              top: node.y,
              width: NODE_W,
              height: NODE_H,
              zIndex: 1,
            }}
          >
            <div className="flex items-center gap-2">
              <NodeIcon node={node} />
              <span className="text-xs text-secondary truncate">{node.label}</span>
            </div>
            {node.status && (
              <span className={`text-[10px] mt-0.5 inline-block ${
                node.status === 'completed' ? 'text-success' :
                node.status === 'failed' ? 'text-error' : 'text-secondary'
              }`}>
                {node.status}
              </span>
            )}
          </div>
        ))}

        {/* Related actions label */}
        {relatedNodes.length > 0 && (
          <div
            className="absolute text-[10px] text-tertiary uppercase font-medium"
            style={{ left: 40, top: relatedY - 18, zIndex: 1 }}
          >
            Related Actions
          </div>
        )}
      </div>
    </div>
  );
}
