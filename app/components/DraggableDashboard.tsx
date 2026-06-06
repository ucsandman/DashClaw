'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ResponsiveGridLayout as ResponsiveGridLayoutBase, useContainerWidth } from 'react-grid-layout';

const ResponsiveGridLayout = ResponsiveGridLayoutBase as React.ComponentType<any>;
import { LayoutGrid, X, RotateCcw } from 'lucide-react';
import { loadLayouts, saveLayouts, loadNamedLayouts, saveNamedLayout, deleteNamedLayout } from '../lib/dashboardLayoutState';

import RiskSignalsCard from './RiskSignalsCard';
import OpenLoopsCard from './OpenLoopsCard';
import RecentActionsCard from './RecentActionsCard';
import ProjectsCard from './ProjectsCard';
import LearningStatsCard from './LearningStatsCard';
import IntegrationsCard from './IntegrationsCard';
import ContextCard from './ContextCard';
import ActivityTimeline from './ActivityTimeline';
import CapabilityHighlightsCard from './CapabilityHighlightsCard';
import RecentMessagesCard from './RecentMessagesCard';
import FleetPresenceCard from './FleetPresenceCard';
import EvalScoreCard from './EvalScoreCard';
import PromptStatsCard from './PromptStatsCard';
import DriftCard from './DriftCard';
import VelocityCard from './VelocityCard';
import ScoringProfileCard from './ScoringProfileCard';

const CARD_COMPONENTS: Record<string, React.ComponentType<any>> = {
  'risk-signals': RiskSignalsCard,
  'open-loops': OpenLoopsCard,
  'recent-actions': RecentActionsCard,
  'fleet-presence': FleetPresenceCard,
  'projects': ProjectsCard,
  'learning': LearningStatsCard,
  'scoring': ScoringProfileCard,
  'context': ContextCard,
  'integrations': IntegrationsCard,
  'activity-timeline': ActivityTimeline,
  'eval-scores': EvalScoreCard,
  'prompt-stats': PromptStatsCard,
  'drift': DriftCard,
};

const CARD_LABELS: Record<string, string> = {
  'risk-signals': 'Risk Signals',
  'fleet-presence': 'Fleet Presence',
  'recent-actions': 'Recent Actions',
  'open-loops': 'Open Loops',
  'activity-timeline': 'Activity Timeline',
  'eval-scores': 'Evaluations',
  'prompt-stats': 'Prompts',
  'drift': 'Drift Detection',
  'scoring': 'Scoring',
  'learning': 'Learning Stats',
  'projects': 'Systems Touched',
  'context': 'Context',
  'integrations': 'Integrations'
};

// minH is 3 rows (≈272px), not 2: at 2 rows (160px) cards clipped their content
// behind CardContent's overflow scroll, which is what made the dashboard look
// like a grid of half-collapsed boxes.
const SHARED_CONSTRAINTS = { maxW: 4, maxH: 8, minW: 1, minH: 3 };

// Default layout positions EVERY card in CARD_COMPONENTS. The grid renders all
// registered cards (filtered only by hiddenTiles), so any card omitted here is
// auto-placed by react-grid-layout at a tiny default size and looks clipped —
// the reason projects/learning/integrations appeared cramped. Heights are sized
// to the content each card actually renders so nothing is cut off out of the box.
const DEFAULT_LAYOUTS = {
  lg: [
    // Fleet + decision ledger
    { i: 'fleet-presence',    x: 0, y: 0,  w: 2, h: 5, ...SHARED_CONSTRAINTS },
    { i: 'recent-actions',    x: 2, y: 0,  w: 2, h: 5, ...SHARED_CONSTRAINTS },

    // Integrity signals + open loops
    { i: 'risk-signals',      x: 0, y: 5,  w: 2, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'open-loops',        x: 2, y: 5,  w: 2, h: 4, ...SHARED_CONSTRAINTS },

    // Timeline (dense, scrolls internally) + context
    { i: 'activity-timeline', x: 0, y: 9,  w: 3, h: 6, ...SHARED_CONSTRAINTS, minW: 2 },
    { i: 'context',           x: 3, y: 9,  w: 1, h: 6, ...SHARED_CONSTRAINTS },

    // Systems + integrations
    { i: 'projects',          x: 0, y: 15, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'integrations',      x: 2, y: 15, w: 2, h: 3, ...SHARED_CONSTRAINTS },

    // Quality/observability tiles
    { i: 'eval-scores',       x: 0, y: 18, w: 2, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'learning',          x: 2, y: 18, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'scoring',           x: 3, y: 18, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'drift',             x: 2, y: 22, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'prompt-stats',      x: 3, y: 22, w: 1, h: 4, ...SHARED_CONSTRAINTS },
  ],
  md: [
    { i: 'fleet-presence',    x: 0, y: 0,  w: 2, h: 5, ...SHARED_CONSTRAINTS },
    { i: 'recent-actions',    x: 0, y: 5,  w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'risk-signals',      x: 1, y: 5,  w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'activity-timeline', x: 0, y: 9,  w: 2, h: 6, ...SHARED_CONSTRAINTS, minW: 2 },
    { i: 'open-loops',        x: 0, y: 15, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'context',           x: 1, y: 15, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'projects',          x: 0, y: 19, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'integrations',      x: 0, y: 22, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'eval-scores',       x: 0, y: 25, w: 2, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'learning',          x: 0, y: 29, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'scoring',           x: 1, y: 29, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'drift',             x: 0, y: 32, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'prompt-stats',      x: 1, y: 32, w: 1, h: 3, ...SHARED_CONSTRAINTS },
  ],
  sm: [
    { i: 'fleet-presence',    x: 0, y: 0,  w: 1, h: 5, ...SHARED_CONSTRAINTS },
    { i: 'recent-actions',    x: 0, y: 5,  w: 1, h: 5, ...SHARED_CONSTRAINTS },
    { i: 'risk-signals',      x: 0, y: 10, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'open-loops',        x: 0, y: 14, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'activity-timeline', x: 0, y: 18, w: 1, h: 6, ...SHARED_CONSTRAINTS },
    { i: 'context',           x: 0, y: 24, w: 1, h: 5, ...SHARED_CONSTRAINTS },
    { i: 'projects',          x: 0, y: 29, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'integrations',      x: 0, y: 32, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'eval-scores',       x: 0, y: 35, w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'learning',          x: 0, y: 39, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'scoring',           x: 0, y: 42, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'drift',             x: 0, y: 45, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'prompt-stats',      x: 0, y: 48, w: 1, h: 3, ...SHARED_CONSTRAINTS },
  ],
};

const PRESET_LAYOUTS: Record<string, any> = {
  'Operations Focus': {
    lg: [
      { i: 'fleet-presence',    x: 0, y: 0,  w: 2, h: 4, ...SHARED_CONSTRAINTS },
      { i: 'risk-signals',      x: 0, y: 4,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'open-loops',        x: 2, y: 3,  w: 2, h: 4, ...SHARED_CONSTRAINTS },
      { i: 'activity-timeline', x: 0, y: 7,  w: 3, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'drift',             x: 3, y: 7,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'scoring',           x: 3, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
    ],
  },
  'Analytics Focus': {
    lg: [
      { i: 'activity-timeline', x: 0, y: 0,  w: 3, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'eval-scores',       x: 3, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'drift',             x: 3, y: 2,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'scoring',           x: 0, y: 4,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'learning',          x: 1, y: 4,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'prompt-stats',      x: 2, y: 4,  w: 2, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'fleet-presence',    x: 0, y: 6,  w: 2, h: 4, ...SHARED_CONSTRAINTS },
      { i: 'risk-signals',      x: 2, y: 6,  w: 2, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 8,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
    ],
  },
  'Compact Overview': {
    lg: [
      { i: 'fleet-presence',    x: 0, y: 0,  w: 2, h: 4, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'risk-signals',      x: 3, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'open-loops',        x: 2, y: 2,  w: 2, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'activity-timeline', x: 0, y: 4,  w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'context',           x: 2, y: 4,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'integrations',      x: 3, y: 4,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    ],
  },
  'Developer': {
    lg: [
      { i: 'integrations',      x: 0, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'context',           x: 2, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'prompt-stats',      x: 0, y: 3,  w: 2, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 3,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'activity-timeline', x: 0, y: 5,  w: 2, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'fleet-presence',    x: 2, y: 6,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'risk-signals',      x: 0, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'open-loops',        x: 1, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'drift',             x: 2, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'eval-scores',       x: 3, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
    ],
  },
};

const BREAKPOINTS = { lg: 1200, md: 768, sm: 0 };
const COLS = { lg: 4, md: 2, sm: 1 };
const ROW_HEIGHT = 80;

export { PRESET_LAYOUTS };

interface DraggableDashboardProps {
  activePreset?: string | null;
  onPresetApplied?: (() => void) | null;
}

export default function DraggableDashboard({ activePreset, onPresetApplied }: DraggableDashboardProps) {
  const { width, mounted, containerRef } = useContainerWidth({ measureBeforeMount: true });
  const [layoutKey, setLayoutKey] = useState(0);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  const [hiddenTiles, setHiddenTiles] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    const saved = localStorage.getItem('dashclaw_hidden_tiles');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('dashclaw_hidden_tiles', JSON.stringify(hiddenTiles));
  }, [hiddenTiles]);

  const initialLayouts = useMemo(() => {
    let layouts: any = DEFAULT_LAYOUTS;
    if (activePreset && PRESET_LAYOUTS[activePreset]) {
      layouts = PRESET_LAYOUTS[activePreset];
    } else {
      const saved = loadLayouts();
      if (saved) layouts = saved;
    }

    // Filter out hidden tiles from the layouts
    const filtered: Record<string, any[]> = {};
    Object.keys(layouts).forEach(bp => {
      filtered[bp] = layouts[bp].filter((item: any) => !hiddenTiles.includes(item.i));
    });
    return filtered;
  }, [activePreset, hiddenTiles]);

  const handleLayoutChange = useCallback((_currentLayout: any, allLayouts: any) => {
    saveLayouts(allLayouts);
  }, []);

  const toggleTileVisibility = (id: string) => {
    setHiddenTiles(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const resetToDefault = () => {
    setHiddenTiles([]);
  };

  const isMobile = width < 768;

  return (
    <div className="space-y-6">
      <div className="flex justify-end items-start">
        <button
          onClick={() => setIsCustomizeOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-secondary hover:text-secondary bg-surface-tertiary border border-border rounded-lg transition-colors ml-4 shrink-0"
        >
          <LayoutGrid size={14} />
          Customize
        </button>
      </div>

      <CapabilityHighlightsCard />

      {/* Draggable grid */}
      <div ref={containerRef as React.RefObject<HTMLDivElement>}>
        {mounted ? (
          <ResponsiveGridLayout
            key={`grid-${layoutKey}-${activePreset || 'custom'}`}
            layouts={initialLayouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            width={width}
            containerPadding={[0, 0]}
            margin={[16, 16]}
            compactType="vertical"
            useCSSTransforms={true}
            resizeHandles={['se']}
            isDraggable={!isMobile}
            isResizable={!isMobile}
            draggableCancel="a, button, input, textarea, select"
            onLayoutChange={handleLayoutChange}
          >
            {Object.entries(CARD_COMPONENTS)
              .filter(([key]) => !hiddenTiles.includes(key))
              .map(([key, Component]) => (
                <div key={key} className="h-full">
                  <Component />
                </div>
              ))}
          </ResponsiveGridLayout>
        ) : null}
      </div>

      {/* Customize Modal */}
      {isCustomizeOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsCustomizeOpen(false)}
        >
          <div
            className="bg-surface-primary border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Customize Dashboard</h2>
                <p className="text-sm text-secondary mt-1">Choose which tiles appear on your dashboard</p>
              </div>
              <button
                onClick={() => setIsCustomizeOpen(false)}
                className="p-2 text-tertiary hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.keys(CARD_COMPONENTS).map(id => {
                  const isVisible = !hiddenTiles.includes(id);
                  const label = CARD_LABELS[id] || id;

                  return (
                    <div
                      key={id}
                      onClick={() => toggleTileVisibility(id)}
                      className={`group p-3 rounded-xl border cursor-pointer transition-all ${
                        isVisible
                          ? 'bg-brand/5 border-brand/20 hover:border-brand/40'
                          : 'bg-surface-secondary border-white/5 opacity-50 hover:opacity-80 hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${isVisible ? 'text-white' : 'text-secondary'}`}>
                          {label}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider font-bold">
                            {isVisible ? (
                              <span className="text-brand">Visible</span>
                            ) : (
                              <span className="text-disabled">Hidden</span>
                            )}
                          </span>
                          <div className={`w-2 h-2 rounded-full ${isVisible ? 'bg-brand shadow-[0_0_8px_rgba(0,255,153,0.5)]' : 'bg-elevated'}`} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-6 border-t border-white/5 flex justify-between items-center bg-white/[0.02]">
              <button
                onClick={resetToDefault}
                className="text-xs text-tertiary hover:text-secondary transition-colors flex items-center gap-1.5"
              >
                <RotateCcw size={12} />
                Reset to Default
              </button>
              <button
                onClick={() => setIsCustomizeOpen(false)}
                className="px-6 py-2 bg-brand text-black font-semibold rounded-lg hover:bg-brand-hover transition-colors text-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
