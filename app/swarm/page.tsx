'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, ArrowRight,
  RefreshCw, Activity, Search, MousePointer2, Info,
  History, Target, X, AlertCircle, CheckCircle2,
  Clock, Terminal, FileText, ChevronRight, Maximize2, ZoomIn, ZoomOut
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { isDemoMode } from '../lib/isDemoMode';
import { useRealtime } from '../hooks/useRealtime';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useForceSimulation } from './useForceSimulation';

// Honest sub-cent display: real spend below $0.01 must not round to "$0.00"
// (evidence over decoration). True zero stays $0.00; sub-cent shows 4 decimals.
function fmtCost(v: unknown): string {
  const n = Number(v) || 0;
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export default function SwarmTopologyPage() {
  const router = useRouter();
  const demo = isDemoMode();
  const { agentId: globalAgentId } = useAgentFilter();

  const [graphData, setGraphData] = useState<any>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI State
  const [selectedAgentId, setSelectedAgentId] = useState<any>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<any>(null);
  const [selectedLink, setSelectedLink] = useState<any>(null); // { source: nodeId, target: nodeId }
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isFocused, setIsFocused] = useState(false);
  const [query, setQuery] = useState('');

  // Performance Refs
  const packetsRef = useRef<any[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<any>({ isDragging: false, node: null, hasMoved: false });
  const hoveredLinkRef = useRef<any>(null);
  const selectedLinkRef = useRef<any>(null);
  // Design-token color strings for the canvas, read once from CSS custom
  // properties on mount so we never scatter raw hex through the draw loop.
  const colorsRef = useRef<any>({
    brand: '#f97316',
    success: '#22c55e',
    warning: '#eab308',
    error: '#ef4444',
    nodeBody: '#111111',
    bgPrimary: '#0e1014',
    label: '#fafafa',
    labelMuted: '#808088',
  });
  const renderStateRef = useRef<any>({
    selectedId: null,
    hoveredId: null,
    selectedLink: null,
    zoom: 0.8,
    pan: { x: 0, y: 0 },
    query: '',
    matchIds: null,
  });

  // Action Inspection State
  const [inspectedAction, setInspectedAction] = useState<any>(null);

  const { nodesRef, linksRef, nodesMapRef, setNodeFixed, wake, expand } = useForceSimulation({
    nodes: graphData.nodes,
    links: graphData.links,
    width: 800,
    height: 600
  });

  // Read design tokens into literal color strings once for the canvas.
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => {
      const v = cs.getPropertyValue(name).trim();
      return v || fallback;
    };
    colorsRef.current = {
      brand: read('--color-brand', '#f97316'),
      success: read('--color-success', '#22c55e'),
      warning: read('--color-warning', '#eab308'),
      error: read('--color-error', '#ef4444'),
      nodeBody: read('--color-bg-secondary', '#111111'),
      bgPrimary: read('--color-bg-primary', '#0e1014'),
      label: read('--color-text-primary', '#fafafa'),
      labelMuted: read('--color-text-tertiary', '#808088'),
    };
  }, []);

  // Agent search — match on name or id. Matched ids feed both the results
  // list and the canvas (matches stay lit and labeled; everything else dims).
  const normalizedQuery = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!normalizedQuery) return [] as any[];
    return (graphData.nodes as any[])
      .filter((n) =>
        String(n.name ?? '').toLowerCase().includes(normalizedQuery) ||
        String(n.id ?? '').toLowerCase().includes(normalizedQuery))
      .sort((a, b) => (b.risk || 0) - (a.risk || 0));
  }, [normalizedQuery, graphData.nodes]);
  const matchIdSet = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);

  // Sync React state to render ref for high-performance canvas access
  useEffect(() => {
    selectedLinkRef.current = selectedLink;
    renderStateRef.current = {
      selectedId: selectedAgentId,
      hoveredId: hoveredAgentId,
      selectedLink,
      zoom,
      pan,
      query: normalizedQuery,
      matchIds: matchIdSet,
    };
  }, [selectedAgentId, hoveredAgentId, selectedLink, zoom, pan, normalizedQuery, matchIdSet]);

  const [agentContext, setAgentContext] = useState<any>({
    loading: false,
    actions: [],
    messages: [],
  });

  const [linkContext, setLinkContext] = useState<any>({
    loading: false,
    shared_actions: [],
    messages: [],
  });

  // --- RENDERING LOOP (CANVAS) ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let frame: number;

    const render = () => {
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const nodesMap = nodesMapRef.current;
      const packets = packetsRef.current;
      const colors = colorsRef.current;
      const { selectedId, hoveredId, zoom: z, pan: p } = renderStateRef.current;

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);
      ctx.save();

      // Apply View Transform (Zoom/Pan)
      ctx.translate(width / 2 + p.x, height / 2 + p.y);
      ctx.scale(z, z);
      ctx.translate(-400, -300);

      // 1. Draw Links
      const sLink = renderStateRef.current.selectedLink;
      const q = renderStateRef.current.query;
      const matchIds = renderStateRef.current.matchIds;

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const s = typeof link.source === 'object' ? link.source : nodesMap.get(link.source);
        const t = typeof link.target === 'object' ? link.target : nodesMap.get(link.target);
        if (!s || !t) continue;

        const isSelectedLink = sLink && (
          (s.id === sLink.source && t.id === sLink.target) ||
          (s.id === sLink.target && t.id === sLink.source)
        );
        const isHoveredLink = hoveredLinkRef.current && (
          (s.id === hoveredLinkRef.current.source && t.id === hoveredLinkRef.current.target) ||
          (s.id === hoveredLinkRef.current.target && t.id === hoveredLinkRef.current.source)
        );

        ctx.beginPath();
        if (isSelectedLink) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = withAlpha(colors.brand, 0.6);
        } else if (isHoveredLink) {
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        } else {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        }

        // Additional highlight for selected agent's links
        if (!isSelectedLink && !isHoveredLink && selectedId && (s.id === selectedId || t.id === selectedId)) {
          ctx.strokeStyle = withAlpha(colors.brand, 0.4);
          ctx.lineWidth = 2;
        }

        // While searching, fade links that don't touch a matched agent.
        const linkDimmed = !!q && !!matchIds && !matchIds.has(s.id) && !matchIds.has(t.id);
        ctx.globalAlpha = linkDimmed ? 0.08 : 1;

        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 2. Draw Packets (NO SHADOWS - Performance Killer)
      const now = Date.now();
      const activePackets = [];

      ctx.fillStyle = colors.brand;
      for (let i = 0; i < packets.length; i++) {
        const p = packets[i];
        const progress = (now - p.startTime) / 800;
        if (progress > 1) continue; // Will be cleaned up

        activePackets.push(p);
        const s = nodesMap.get(p.from);
        const t = nodesMap.get(p.to === 'broadcast' ? nodes[0]?.id : p.to);
        if (!s || !t) continue;

        const px = s.x + (t.x - s.x) * progress;
        const py = s.y + (t.y - s.y) * progress;

        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      packetsRef.current = activePackets;

      // 3. Draw Nodes
      const zoomedIn = z > 1.3;
      const fewNodes = nodes.length < 15;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isSel = selectedId === node.id;
        const isHov = hoveredId === node.id;
        const isMatch = !!q && !!matchIds && matchIds.has(node.id);
        const dimmed = !!q && !!matchIds && !isMatch && !isSel && !isHov;

        ctx.globalAlpha = dimmed ? 0.12 : 1;

        const rCol = node.risk > 70 ? colors.error : node.risk > 40 ? colors.warning : colors.success;
        // Node radius carries activity: busier agents read larger (node.val ≈ log of action count).
        const baseR = 10 + Math.min(node.val || 0, 14) * 0.45;
        const r = isSel ? baseR + 5 : baseR;

        // Soft brand halo for the one agent in focus (selected/hovered only) — kept rare so orange stays a signal.
        if (isSel || isHov) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 22, 0, Math.PI * 2);
          const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 22);
          grad.addColorStop(0, withAlpha(colors.brand, isSel ? 0.3 : 0.18));
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Body: a filled, risk-tinted disc (not a hollow ring) so every agent reads at a glance.
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(rCol, 0.22);
        ctx.fill();
        ctx.lineWidth = isSel ? 3 : 2;
        ctx.strokeStyle = isSel ? colors.brand : rCol;
        ctx.stroke();

        // Bright status core keeps the risk color legible inside the tinted disc.
        ctx.beginPath();
        ctx.arc(node.x, node.y, Math.max(3, r * 0.4), 0, Math.PI * 2);
        ctx.fillStyle = rCol;
        ctx.fill();

        // Label: the focused agent, a search match, or everything once zoomed in.
        if (isSel || isHov || isMatch || zoomedIn || fewNodes) {
          const label = String(node.name);
          ctx.font = '600 11px Inter, system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const ly = node.y + r + 12;
          const focused = isSel || isHov || isMatch;
          if (focused) {
            // A chip behind the focused label keeps it readable over the network.
            const tw = ctx.measureText(label).width;
            const chipW = tw + 12;
            ctx.fillStyle = withAlpha(colors.bgPrimary, 0.85);
            roundRect(ctx, node.x - chipW / 2, ly - 8, chipW, 16, 5);
            ctx.fill();
            ctx.fillStyle = colors.label;
          } else {
            ctx.fillStyle = colors.labelMuted;
          }
          ctx.fillText(label, node.x, ly);
        }

        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      ctx.restore();
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [linksRef, nodesMapRef, nodesRef]); // Use refs as dependencies to satisfy linter

  // --- INTERACTION LOGIC ---

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (sx - rect.left) * (canvas.width / rect.width);
    const y = (sy - rect.top) * (canvas.height / rect.height);
    const { zoom: z, pan: p } = renderStateRef.current;
    const wx = (x - canvas.width / 2 - p.x) / z + 400;
    const wy = (y - canvas.height / 2 - p.y) / z + 300;
    return { x: wx, y: wy };
  }, []);

  const pointToLineDistance = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const l2 = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    if (l2 === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (x1 + t * (x2 - x1));
    const dy = py - (y1 + t * (y2 - y1));
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsFocused(true);
    const { x, y } = screenToWorld(e.clientX, e.clientY);

    const clickedNode = nodesRef.current.find(n => {
      const dx = n.x - x;
      const dy = n.y - y;
      const { zoom: z } = renderStateRef.current;
      return Math.sqrt(dx * dx + dy * dy) < 30 / z;
    });

    if (clickedNode) {
      dragRef.current = { isDragging: true, node: clickedNode, hasMoved: false };
      setSelectedAgentId(clickedNode.id);
      setSelectedLink(null);
    } else if (hoveredLinkRef.current) {
      dragRef.current = { isDragging: true, node: null, hasMoved: false };
      setSelectedLink(hoveredLinkRef.current);
      setSelectedAgentId(null);
    } else {
      dragRef.current = { isDragging: true, node: null, hasMoved: false };
      setSelectedAgentId(null);
      setSelectedLink(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);

    if (dragRef.current.isDragging) {
      dragRef.current.hasMoved = true;
      if (dragRef.current.node) {
        setNodeFixed(dragRef.current.node.id, x, y);
        setHoveredAgentId(null);
      } else {
        setPan(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
      }
    } else {
      const hovNode = nodesRef.current.find(n => {
        const dx = n.x - x;
        const dy = n.y - y;
        const { zoom: z } = renderStateRef.current;
        return Math.sqrt(dx * dx + dy * dy) < 30 / z;
      });
      setHoveredAgentId(hovNode?.id || null);

      if (!hovNode) {
        // Check links
        let bestLink = null;
        let minDist = 6; // 6 world-space pixels
        const links = linksRef.current;
        const nodesMap = nodesMapRef.current;

        for (const link of links) {
          const s = typeof link.source === 'object' ? link.source : nodesMap.get(link.source);
          const t = typeof link.target === 'object' ? link.target : nodesMap.get(link.target);
          if (!s || !t) continue;

          const dist = pointToLineDistance(x, y, s.x, s.y, t.x, t.y);
          if (dist < minDist) {
            minDist = dist;
            bestLink = { source: s.id, target: t.id };
          }
        }
        hoveredLinkRef.current = bestLink;
      } else {
        hoveredLinkRef.current = null;
      }
    }
  };

  const handleMouseUp = () => {
    if (dragRef.current.node && dragRef.current.hasMoved) {
      setNodeFixed(dragRef.current.node.id, null, null);
    }
    dragRef.current = { isDragging: false, node: null, hasMoved: false };
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isFocused) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const { zoom: z, pan: p } = renderStateRef.current;
    const newZoom = Math.max(0.1, Math.min(10, z * delta));

    if (newZoom !== z) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = (mx - canvas.width / 2 - p.x) * (delta - 1);
      const dy = (my - canvas.height / 2 - p.y) * (delta - 1);

      setPan(prev => ({ x: prev.x - dx, y: prev.y - dy }));
      setZoom(newZoom);
    }
  }, [isFocused]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el?.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Center the view on an agent and select it — used by the search results list.
  const focusOnNode = useCallback((id: any) => {
    const node = nodesMapRef.current.get(id);
    if (!node) return;
    const z = Math.max(renderStateRef.current.zoom, 1.5);
    setZoom(z);
    setPan({ x: -z * (node.x - 400), y: -z * (node.y - 300) });
    setSelectedAgentId(id);
    setSelectedLink(null);
    setIsFocused(true);
  }, [nodesMapRef]);

  // --- DATA FETCHING ---

  const triggerPacket = useCallback((fromId: any, toId: any) => {
    const packetId = Math.random().toString(36).substring(7);
    packetsRef.current.push({ id: packetId, from: fromId, to: toId, startTime: Date.now() });
    // No more state update here! The render loop will pick it up from the ref.
  }, []);

  useRealtime((event: any, payload: any) => {
    if (event === 'message.created') {
      triggerPacket(payload.from_agent_id, payload.to_agent_id || 'broadcast');
    }
  });

  const fetchGraph = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/swarm/graph');
      if (!res.ok) throw new Error('Failed to load swarm data');
      const json = await res.json();
      setGraphData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
    const interval = setInterval(fetchGraph, 60000);
    return () => clearInterval(interval);
  }, [fetchGraph]);

  // Sync the global header agent picker into the local node selection: picking
  // an agent globally focuses its node (when present in the graph). The graph
  // itself stays org-wide — topology needs every node — so this is selection,
  // not data filtering. Clearing the global filter leaves local selection alone.
  useEffect(() => {
    if (!globalAgentId) return;
    if (graphData.nodes?.some((n: any) => n.id === globalAgentId)) {
      setSelectedAgentId(globalAgentId);
    }
  }, [globalAgentId, graphData.nodes]);

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentContext({ loading: false, actions: [], messages: [] });
      return;
    }
    const ctrl = new AbortController();
    const load = async () => {
      setAgentContext((prev: any) => ({ ...prev, loading: true }));
      try {
        const qs = (path: string) => `/api/${path}?agent_id=${encodeURIComponent(selectedAgentId)}&limit=15`;
        const [actionsRes, msgsRes] = await Promise.all([
          fetch(qs('actions'), { signal: ctrl.signal }),
          fetch(qs('messages'), { signal: ctrl.signal }),
        ]);
        const [actionsJson, msgsJson] = await Promise.all([
          actionsRes.json().catch(() => ({ actions: [] })),
          msgsRes.json().catch(() => ({ messages: [] })),
        ]);
        setAgentContext({ loading: false, actions: actionsJson.actions || [], messages: msgsJson.messages || [] });
      } catch (e: any) {
        if (e.name !== 'AbortError') setAgentContext((prev: any) => ({ ...prev, loading: false }));
      }
    };
    load();
    return () => ctrl.abort();
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedLink) {
      setLinkContext({ loading: false, shared_actions: [], messages: [] });
      return;
    }
    const ctrl = new AbortController();
    const load = async () => {
      setLinkContext((prev: any) => ({ ...prev, loading: true }));
      try {
        const url = `/api/swarm/link?source=${encodeURIComponent(selectedLink.source)}&target=${encodeURIComponent(selectedLink.target)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const json = await res.json();
        setLinkContext({
          loading: false,
          shared_actions: json.shared_actions || [],
          messages: json.messages || []
        });
      } catch (e: any) {
        if (e.name !== 'AbortError') setLinkContext((prev: any) => ({ ...prev, loading: false }));
      }
    };
    load();
    return () => ctrl.abort();
  }, [selectedLink]);

  const selectedAgent = useMemo(() =>
    nodesRef.current.find(n => n.id === selectedAgentId),
  [selectedAgentId, nodesRef]);

  const selectedPartners = useMemo(() => {
    if (!selectedAgentId) return [];
    return linksRef.current
      .filter(l => l.source === selectedAgentId || l.target === selectedAgentId || l.source?.id === selectedAgentId || l.target?.id === selectedAgentId)
      .map(link => {
        const s = typeof link.source === 'object' ? link.source.id : link.source;
        const t = typeof link.target === 'object' ? link.target.id : link.target;
        const pId = s === selectedAgentId ? t : s;
        const pNode = nodesRef.current.find(n => n.id === pId);
        return { id: pId, name: pNode?.name || pId };
      });
  }, [selectedAgentId, linksRef, nodesRef]);

  const LinkInspectorPanel = ({ link, context, onClose }: { link: any; context: any; onClose: () => void }) => {
    const [activeTab, setActiveTab] = useState('activity');
    const sourceNode = nodesMapRef.current.get(link.source);
    const targetNode = nodesMapRef.current.get(link.target);

    if (!sourceNode || !targetNode) return null;

    return (
      <div className="flex flex-1 flex-col min-h-0 space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-tertiary border border-border text-[10px] font-semibold text-white">
                {sourceNode.name[0]}
              </div>
              <span className="mt-1 max-w-[60px] truncate text-[9px] text-tertiary">{sourceNode.name}</span>
            </div>
            <ArrowRight size={14} className="text-tertiary" />
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-tertiary border border-border text-[10px] font-semibold text-white">
                {targetNode.name[0]}
              </div>
              <span className="mt-1 max-w-[60px] truncate text-[9px] text-tertiary">{targetNode.name}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-tertiary transition-colors hover:bg-surface-tertiary hover:text-white" aria-label="Close inspector">
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('activity')}
            className={`border-b-2 px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${activeTab === 'activity' ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            Shared activity
          </button>
          <button
            onClick={() => setActiveTab('messages')}
            className={`border-b-2 px-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${activeTab === 'messages' ? 'border-brand text-primary' : 'border-transparent text-tertiary hover:text-secondary'}`}
          >
            Messages
          </button>
        </div>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {context.loading ? (
            <div className="py-12 text-center text-[11px] text-tertiary">Loading shared activity…</div>
          ) : activeTab === 'activity' ? (
            <div className="flex flex-1 flex-col min-h-0 gap-2">
              <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Shared actions ({context.shared_actions.length})
              </div>
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                {context.shared_actions.length > 0 ? (
                  <>
                    {context.shared_actions.slice(0, 3).map((act: any, i: number) => {
                      const statusColor = act.status === 'completed' ? 'bg-status-success' : act.status === 'failed' ? 'bg-status-error' : 'bg-status-warning';
                      const riskColor = act.risk_score >= 70 ? 'text-error' : 'text-warning';
                      return (
                        <a
                          key={i}
                          href={`/decisions/${act.action_id}`}
                          className="block rounded-lg bg-surface-tertiary p-2.5 text-xs transition-colors hover:bg-surface-elevated"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${statusColor}`} />
                            <span className="truncate text-secondary">{act.declared_goal || act.action_type}</span>
                            {act.risk_score >= 40 && (
                              <span className={`${riskColor} ml-auto shrink-0 font-mono text-[10px] tabular-nums`}>risk {act.risk_score}</span>
                            )}
                          </div>
                        </a>
                      );
                    })}
                    {context.shared_actions.length > 3 && (
                      <a
                        href={`/decisions?agents=${encodeURIComponent(link.source)},${encodeURIComponent(link.target)}`}
                        className="flex items-center justify-center gap-1 py-1 text-center text-[10px] text-secondary transition-colors hover:text-primary"
                      >
                        View all {context.shared_actions.length} actions <ArrowRight size={11} />
                      </a>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={Activity}
                    title="No shared actions"
                    description="No governed actions recorded between these agents within the current window."
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col min-h-0 gap-2">
              <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                Messages ({context.messages.length})
              </div>
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                {context.messages.length > 0 ? (
                  <>
                    {context.messages.slice(0, 5).map((msg: any, i: number) => {
                      const time = formatTimestamp(msg.created_at);
                      return (
                        <div key={i} className="rounded-lg bg-surface-tertiary p-2.5 text-xs">
                          <div className="mb-0.5 flex items-center gap-1 text-tertiary">
                            <span className="text-secondary">{msg.sender_agent_id}</span>
                            <ArrowRight size={10} />
                            <span>{msg.recipient_agent_id || 'broadcast'}</span>
                            <span className="ml-auto tabular-nums">{time}</span>
                          </div>
                          <div className="line-clamp-2 text-secondary">{msg.content}</div>
                        </div>
                      );
                    })}
                    {context.messages.length > 5 && (
                      <a
                        href={`/messages?agents=${encodeURIComponent(link.source)},${encodeURIComponent(link.target)}`}
                        className="flex items-center justify-center gap-1 py-1 text-center text-[10px] text-secondary transition-colors hover:text-primary"
                      >
                        View all {context.messages.length} messages <ArrowRight size={11} />
                      </a>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={Info}
                    title="No messages"
                    description="No direct messages recorded between these agents."
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const ActionDetailOverlay = ({ action, onClose }: { action: any; onClose: () => void }) => {
    if (!action) return null;
    return (
      <div className="absolute inset-0 z-[100] flex flex-col rounded-xl bg-surface-primary p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`rounded-xl p-3 ${
              action.status === 'completed' ? 'bg-success-subtle text-success' :
              action.status === 'failed' ? 'bg-error-subtle text-error' : 'bg-warning-subtle text-warning'
            }`}>
              {action.status === 'completed' ? <CheckCircle2 size={26} /> : action.status === 'failed' ? <AlertCircle size={26} /> : <Clock size={26} />}
            </div>
            <div>
              <h2 className="mb-2 text-xl font-semibold leading-none text-white">{action.action_type}</h2>
              <div className="flex items-center gap-2">
                <Badge
                  variant={action.status === 'completed' ? 'success' : action.status === 'failed' ? 'error' : 'default'}
                  size="xs"
                  className="uppercase"
                >
                  {action.status}
                </Badge>
                <span className="font-mono text-[10px] tracking-tight text-tertiary">{action.action_id}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-tertiary transition-colors hover:bg-surface-tertiary hover:text-white" aria-label="Close detail"><X size={20} /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                <Target size={14} className="text-tertiary" /> Risk score
              </div>
              <div className={`font-mono text-3xl tabular-nums tracking-tight ${action.risk_score > 70 ? 'text-error' : action.risk_score > 40 ? 'text-warning' : 'text-success'}`}>
                {action.risk_score || 0}%
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                <Clock size={14} className="text-tertiary" /> Execution time
              </div>
              <div className="font-mono text-xl tabular-nums tracking-tight text-secondary">
                {formatTimestamp(action.timestamp_start)}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              <Info size={14} className="text-tertiary" /> Decision rationale
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5 text-sm leading-relaxed text-secondary">
              {action.reasoning || 'Autonomous decision based on current fleet goals and policy constraints.'}
            </div>
          </div>

          {(() => {
            const meta = typeof action.metadata === 'string'
              ? (() => { try { return JSON.parse(action.metadata); } catch { return null; } })()
              : action.metadata;
            if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Object.keys(meta).length === 0) {
              // Non-object metadata (string/array/number) has no key/value shape — show the raw value.
              if (meta === null || meta === undefined || (typeof meta === 'object' && Object.keys(meta).length === 0)) return null;
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                    <Terminal size={14} className="text-tertiary" /> Contextual metadata
                  </div>
                  <pre className="overflow-x-auto rounded-xl border border-border bg-surface-tertiary p-5 font-mono text-[11px] leading-relaxed text-secondary">
                    {JSON.stringify(meta, null, 2)}
                  </pre>
                </div>
              );
            }
            // Humanize governance-meaningful keys into a labeled key/value list. Scalar
            // values render as labeled fields; nested objects/arrays collapse into a
            // small code block so the human-readable fields stay scannable.
            const LABELS: Record<string, string> = {
              model: 'Model',
              provider: 'Provider',
              capability: 'Capability',
              cost: 'Cost',
              cost_estimate: 'Cost estimate',
              tokens: 'Tokens',
              input_tokens: 'Input tokens',
              output_tokens: 'Output tokens',
              risk_score: 'Risk score',
              policy: 'Policy',
              decision: 'Decision',
              tool: 'Tool',
              agent_id: 'Agent',
              duration_ms: 'Duration (ms)',
            };
            const humanize = (key: string) =>
              LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            const entries = Object.entries(meta);
            const isScalar = (v: any) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
            const scalarEntries = entries.filter(([, v]) => isScalar(v));
            const complexEntries = entries.filter(([, v]) => !isScalar(v));
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                  <Terminal size={14} className="text-tertiary" /> Contextual metadata
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-surface-secondary p-5">
                  {scalarEntries.map(([key, value]) => (
                    <div key={key} className="min-w-0">
                      <dt className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
                        {humanize(key)}
                      </dt>
                      <dd className="break-words font-mono text-xs text-secondary">
                        {value === null ? '—' : String(value)}
                      </dd>
                    </div>
                  ))}
                  {complexEntries.map(([key, value]) => (
                    <details key={key} className="group col-span-2 min-w-0">
                      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary [&::-webkit-details-marker]:hidden">
                        <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                        {humanize(key)}
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-tertiary p-3 font-mono text-[11px] leading-relaxed text-secondary">
                        {JSON.stringify(value, null, 2)}
                      </pre>
                    </details>
                  ))}
                </dl>
              </div>
            );
          })()}
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <button
            onClick={() => router.push(`/decisions/${action.action_id}`)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
          >
            View decision record <FileText size={16} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <PageLayout
      title="Fleet topology"
      subtitle="Agent network: relationships, message flow, and per-agent risk"
      breadcrumbs={['Operations', 'Topology']}
      actions={<button onClick={fetchGraph} className="p-2 text-secondary transition-colors hover:text-white" aria-label="Refresh topology"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>}
    >
      <div className="space-y-6">
        {/* ROW 1: TOPOLOGY CANVAS + INSPECTOR (FULL VIEWPORT HEIGHT) */}
        <div className="flex h-[calc(100vh-140px)] min-h-[600px] flex-col gap-6 lg:flex-row">

          {/* Topology canvas */}
          <Card hover={false} className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-primary">
            <CardHeader>
              <div className="flex min-w-0 items-center gap-2">
                <Activity size={14} className="shrink-0 text-tertiary" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Agent network</span>
              </div>
              <Badge variant="default" size="xs" className="tabular-nums">{graphData.nodes.length} agents</Badge>
            </CardHeader>

            <CardContent className="relative flex-1 overflow-hidden p-0">
              <div
                ref={containerRef}
                className="relative h-full w-full cursor-grab active:cursor-grabbing"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <canvas ref={canvasRef} width={800} height={600} className="h-full w-full select-none" />
                {!isFocused && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center bg-surface-primary/15 pb-6">
                    <span className="flex items-center gap-2 rounded-full border border-border bg-surface-secondary/90 px-3.5 py-1.5 text-[11px] font-medium text-secondary backdrop-blur-sm">
                      <MousePointer2 size={13} className="text-brand" /> Click to interact · scroll to zoom · drag to pan
                    </span>
                  </div>
                )}
                <div className="absolute right-4 top-4 z-20 flex flex-col gap-2">
                  <button onClick={() => { setZoom(z => Math.min(10, z * 1.5)); }} title="Zoom in" aria-label="Zoom in" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><ZoomIn size={14} /></button>
                  <button onClick={() => { setZoom(z => Math.max(0.1, z * 0.7)); }} title="Zoom out" aria-label="Zoom out" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><ZoomOut size={14} /></button>
                  <button onClick={() => { setZoom(0.8); setPan({ x: 0, y: 0 }); }} title="Reset view" aria-label="Reset view" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><RefreshCw size={14} /></button>
                  <button onClick={expand} title="Distribute network" aria-label="Distribute network" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-secondary text-secondary transition-colors hover:border-border-hover hover:text-white"><Maximize2 size={14} /></button>
                </div>

                {/* Agent search — find an agent by name or ID, then jump to it. */}
                <div
                  className="absolute left-4 top-4 z-20 w-[248px]"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur(); }
                        else if (e.key === 'Enter' && matches.length > 0) focusOnNode(matches[0].id);
                      }}
                      placeholder="Search agents…"
                      aria-label="Search agents by name or ID"
                      className="w-full rounded-lg border border-border bg-surface-secondary/95 py-2 pl-9 pr-8 text-sm text-white shadow-sm backdrop-blur-sm transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery('')}
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-tertiary transition-colors hover:text-white"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {query && (
                    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface-secondary/95 shadow-lg backdrop-blur-sm">
                      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
                        <span>{matches.length === 0 ? 'No matches' : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}</span>
                        <span className="tabular-nums">of {graphData.nodes.length}</span>
                      </div>
                      {matches.length > 0 && (
                        <ul className="custom-scrollbar max-h-[260px] overflow-y-auto py-1">
                          {matches.slice(0, 8).map((m: any) => {
                            const dot = (m.risk || 0) > 70 ? 'bg-status-error' : (m.risk || 0) > 40 ? 'bg-status-warning' : 'bg-status-success';
                            return (
                              <li key={m.id}>
                                <button
                                  onClick={() => focusOnNode(m.id)}
                                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-tertiary ${selectedAgentId === m.id ? 'bg-surface-tertiary' : ''}`}
                                >
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-white">{m.name}</span>
                                    <span className="block truncate font-mono text-[10px] text-tertiary">{String(m.id).substring(0, 24)}</span>
                                  </span>
                                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-tertiary">{(m.risk || 0).toFixed(0)}%</span>
                                </button>
                              </li>
                            );
                          })}
                          {matches.length > 8 && (
                            <li className="px-3 py-1.5 text-center text-[10px] text-tertiary">
                              +{matches.length - 8} more — refine your search
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                {/* Risk legend — decodes the node status colors (paired with text per AA). */}
                <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-lg border border-border bg-surface-secondary/80 px-3 py-1.5 backdrop-blur-sm">
                  {([
                    ['bg-status-success', 'Healthy'],
                    ['bg-status-warning', 'Elevated'],
                    ['bg-status-error', 'Critical'],
                  ] as const).map(([dot, label]) => (
                    <span key={label} className="flex items-center gap-1.5 text-[10px] font-medium text-secondary">
                      <span className={`h-2 w-2 rounded-full ${dot}`} /> {label}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Inspector */}
          <div className="h-full w-full shrink-0 lg:w-[400px]">
            <Card hover={false} className="flex h-full flex-col overflow-hidden">
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <Search size={14} className="shrink-0 text-tertiary" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Inspector</span>
                </div>
              </CardHeader>
              <CardContent className="relative flex flex-1 flex-col min-h-0">
                {inspectedAction && <ActionDetailOverlay action={inspectedAction} onClose={() => setInspectedAction(null)} />}

                {selectedLink ? (
                  <LinkInspectorPanel
                    link={selectedLink}
                    context={linkContext}
                    onClose={() => setSelectedLink(null)}
                  />
                ) : selectedAgent ? (
                  <div className="flex flex-1 flex-col min-h-0 space-y-5">
                    <div className="shrink-0">
                      <h3 className="mb-0.5 text-lg font-semibold text-white">{selectedAgent.name}</h3>
                      <code className="font-mono text-[10px] text-tertiary">{selectedAgent.id.substring(0, 12)}…</code>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant={(selectedAgent.risk || 0) > 40 ? 'warning' : 'success'} size="xs" className="tabular-nums">
                          Risk {(selectedAgent.risk || 0).toFixed(0)}%
                        </Badge>
                      </div>
                    </div>

                    <div className="shrink-0 space-y-3">
                      <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary"><Zap size={12} className="text-tertiary" /> Performance</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-border bg-surface-tertiary p-3">
                          <StatCompact label="Actions" value={selectedAgent.actions || 0} />
                        </div>
                        <div className="rounded-xl border border-border bg-surface-tertiary p-3">
                          <StatCompact label="Cost" value={fmtCost(selectedAgent.cost)} color="text-info" />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col min-h-0 space-y-3 overflow-hidden">
                      <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary"><History size={12} className="text-tertiary" /> Latest decisions</h4>
                      <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                        {agentContext.loading ? (
                          <div className="py-8 text-center text-[11px] text-tertiary">Loading decisions…</div>
                        ) : agentContext.actions.length > 0 ? (
                          agentContext.actions.map((action: any, i: number) => (
                            <button
                              key={i}
                              onClick={() => setInspectedAction(action)}
                              className="group/action flex w-full flex-col gap-2 rounded-xl border border-border bg-surface-tertiary p-3 text-left transition-colors hover:border-border-hover hover:bg-surface-elevated"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="max-w-[150px] truncate text-[12px] font-semibold text-white">{action.action_type}</span>
                                <Badge
                                  variant={action.status === 'completed' ? 'success' : action.status === 'failed' ? 'error' : 'warning'}
                                  size="xs"
                                  className="uppercase"
                                >
                                  {action.status}
                                </Badge>
                              </div>
                              <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-tertiary">
                                <span className="flex items-center gap-1.5"><Target size={10} /> {action.risk_score || 0}% risk</span>
                                <span className="flex items-center gap-1.5">{formatTimestamp(action.timestamp_start)} <ChevronRight size={10} className="transition-transform group-hover/action:translate-x-0.5" /></span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <EmptyState
                            icon={History}
                            title="No recent decisions"
                            description="This agent has no governed decisions recorded yet."
                          />
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 border-t border-border pt-5">
                      <button onClick={() => router.push(`/decisions?agent_id=${selectedAgent.id}`)} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[11px] font-semibold text-white transition-colors hover:bg-brand-hover">View agent decisions <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center">
                    <EmptyState
                      icon={Search}
                      title="No agent selected"
                      description="Select a node or connection in the network to inspect its governed activity and decision history."
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ROW 2: STATS ROW */}
        <div className="grid grid-cols-1 gap-4 pb-12 md:grid-cols-3">
          <Card hover={false}><CardContent className="flex items-center justify-center py-4"><StatCompact label="Connections" value={graphData.links.length} /></CardContent></Card>
          <Card hover={false}><CardContent className="flex items-center justify-center py-4"><StatCompact label="Total actions" value={graphData.nodes.reduce((s: number, n: any) => s + (Number(n.actions) || 0), 0)} /></CardContent></Card>
          <Card hover={false}><CardContent className="flex items-center justify-center py-4"><StatCompact label="Total cost" value={fmtCost(graphData.nodes.reduce((s: number, n: any) => s + (Number(n.cost) || 0), 0))} color="text-info" /></CardContent></Card>
        </div>
      </div>
    </PageLayout>
  );
}

// Trace a rounded-rectangle path for the focused-node label chip. (Avoids
// relying on the still-uneven ctx.roundRect support across target browsers.)
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// Convert a `#rrggbb` token value into an rgba string at the given alpha so the
// canvas can dim brand/status colors without hardcoding new hex literals.
function withAlpha(hex: string, alpha: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const hex6 = m?.[1];
  if (!hex6) return hex;
  const int = parseInt(hex6, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
