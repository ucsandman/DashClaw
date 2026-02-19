'use client';

import { useState, useMemo, useCallback } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import { loadLayouts, saveLayouts, loadNamedLayouts, saveNamedLayout, deleteNamedLayout } from '../lib/dashboardLayoutState';

import RiskSignalsCard from './RiskSignalsCard';
import OpenLoopsCard from './OpenLoopsCard';
import RecentActionsCard from './RecentActionsCard';
import ProjectsCard from './ProjectsCard';
import GoalsChart from './GoalsChart';
import LearningStatsCard from './LearningStatsCard';
import FollowUpsCard from './FollowUpsCard';
import CalendarWidget from './CalendarWidget';
import IntegrationsCard from './IntegrationsCard';
import MemoryHealthCard from './MemoryHealthCard';
import InspirationCard from './InspirationCard';
import ContextCard from './ContextCard';
import TokenBudgetCard from './TokenBudgetCard';
import TokenChart from './TokenChart';
import ActivityTimeline from './ActivityTimeline';
import OnboardingChecklist from './OnboardingChecklist';
import CapabilityHighlightsCard from './CapabilityHighlightsCard';
import RecentMessagesCard from './RecentMessagesCard';
import FleetPresenceCard from './FleetPresenceCard';
import EvalScoreCard from './EvalScoreCard';
import PromptStatsCard from './PromptStatsCard';
import FeedbackCard from './FeedbackCard';
import DriftCard from './DriftCard';
import VelocityCard from './VelocityCard';

const CARD_COMPONENTS = {
  'risk-signals': RiskSignalsCard,
  'open-loops': OpenLoopsCard,
  'recent-actions': RecentActionsCard,
  'recent-messages': RecentMessagesCard,
  'fleet-presence': FleetPresenceCard,
  'projects': ProjectsCard,
  'goals': GoalsChart,
  'learning': LearningStatsCard,
  'velocity': VelocityCard,
  'follow-ups': FollowUpsCard,
  'calendar': CalendarWidget,
  'context': ContextCard,
  'token-budget': TokenBudgetCard,
  'memory-health': MemoryHealthCard,
  'token-chart': TokenChart,
  'integrations': IntegrationsCard,
  'inspiration': InspirationCard,
  'activity-timeline': ActivityTimeline,
  'eval-scores': EvalScoreCard,
  'prompt-stats': PromptStatsCard,
  'feedback': FeedbackCard,
  'drift': DriftCard,
};

const SHARED_CONSTRAINTS = { maxW: 4, maxH: 8, minW: 1, minH: 2 };

const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'risk-signals',      x: 0, y: 0,  w: 2, h: 2, ...SHARED_CONSTRAINTS },
    { i: 'open-loops',        x: 2, y: 0,  w: 2, h: 2, ...SHARED_CONSTRAINTS },
    { i: 'recent-actions',    x: 0, y: 2,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'activity-timeline', x: 2, y: 2,  w: 2, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
    { i: 'projects',          x: 0, y: 5,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'goals',             x: 0, y: 8,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'learning',          x: 1, y: 8,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'follow-ups',        x: 2, y: 6,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'calendar',          x: 3, y: 6,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'context',           x: 0, y: 11, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'token-budget',      x: 2, y: 9,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'memory-health',     x: 3, y: 9,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'token-chart',       x: 0, y: 14, w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
    { i: 'integrations',      x: 2, y: 12, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'inspiration',       x: 3, y: 12, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'recent-messages',   x: 2, y: 15, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'fleet-presence',    x: 0, y: 17, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'eval-scores',       x: 0, y: 20, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'prompt-stats',      x: 2, y: 18, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'feedback',          x: 4, y: 20, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'drift',             x: 0, y: 23, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'velocity',          x: 2, y: 23, w: 2, h: 3, ...SHARED_CONSTRAINTS },
  ],
  md: [
    { i: 'risk-signals',      x: 0, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
    { i: 'open-loops',        x: 1, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
    { i: 'recent-actions',    x: 0, y: 2,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'projects',          x: 1, y: 2,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'activity-timeline', x: 0, y: 5,  w: 2, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
    { i: 'goals',             x: 0, y: 9,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'learning',          x: 1, y: 9,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'follow-ups',        x: 0, y: 12, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'calendar',          x: 1, y: 12, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'context',           x: 0, y: 15, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'token-budget',      x: 0, y: 18, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'memory-health',     x: 1, y: 18, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'token-chart',       x: 0, y: 21, w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
    { i: 'integrations',      x: 0, y: 24, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'inspiration',       x: 1, y: 24, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'recent-messages',   x: 0, y: 27, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'fleet-presence',    x: 0, y: 30, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'eval-scores',       x: 0, y: 33, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'prompt-stats',      x: 0, y: 36, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'feedback',          x: 0, y: 39, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'drift',             x: 0, y: 42, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'velocity',          x: 0, y: 45, w: 2, h: 3, ...SHARED_CONSTRAINTS },
  ],
  sm: [
    { i: 'risk-signals',      x: 0, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
    { i: 'open-loops',        x: 0, y: 2,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
    { i: 'recent-actions',    x: 0, y: 4,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'activity-timeline', x: 0, y: 7,  w: 1, h: 4, ...SHARED_CONSTRAINTS },
    { i: 'projects',          x: 0, y: 11, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'goals',             x: 0, y: 14, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'learning',          x: 0, y: 17, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'follow-ups',        x: 0, y: 20, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'calendar',          x: 0, y: 23, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'context',           x: 0, y: 26, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'token-budget',      x: 0, y: 29, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'memory-health',     x: 0, y: 32, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'token-chart',       x: 0, y: 35, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'integrations',      x: 0, y: 38, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'inspiration',       x: 0, y: 41, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'recent-messages',   x: 0, y: 44, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'fleet-presence',    x: 0, y: 47, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'eval-scores',       x: 0, y: 50, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'prompt-stats',      x: 0, y: 53, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'feedback',          x: 0, y: 56, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'drift',             x: 0, y: 59, w: 1, h: 3, ...SHARED_CONSTRAINTS },
    { i: 'velocity',          x: 0, y: 62, w: 1, h: 3, ...SHARED_CONSTRAINTS },
  ],
};

const PRESET_LAYOUTS = {
  'Operations Focus': {
    lg: [
      { i: 'risk-signals',      x: 0, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'follow-ups',        x: 0, y: 3,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'open-loops',        x: 2, y: 3,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'activity-timeline', x: 0, y: 6,  w: 2, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'projects',          x: 2, y: 6,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'goals',             x: 0, y: 10, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'learning',          x: 1, y: 10, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'calendar',          x: 2, y: 9,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'context',           x: 3, y: 9,  w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'token-budget',      x: 0, y: 13, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'memory-health',     x: 1, y: 13, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'token-chart',       x: 2, y: 12, w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'integrations',      x: 0, y: 16, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'inspiration',       x: 1, y: 16, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'recent-messages',   x: 2, y: 15, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    ],
  },
  'Analytics Focus': {
    lg: [
      { i: 'token-chart',       x: 0, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'activity-timeline', x: 2, y: 0,  w: 2, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'goals',             x: 0, y: 3,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'learning',          x: 0, y: 6,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'token-budget',      x: 2, y: 4,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'risk-signals',      x: 0, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'open-loops',        x: 1, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 7,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'projects',          x: 0, y: 11, w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'follow-ups',        x: 2, y: 10, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'calendar',          x: 3, y: 10, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'context',           x: 0, y: 14, w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'memory-health',     x: 2, y: 13, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'integrations',      x: 3, y: 13, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'inspiration',       x: 0, y: 17, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'recent-messages',   x: 1, y: 17, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    ],
  },
  'Compact Overview': {
    lg: [
      { i: 'risk-signals',      x: 0, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'open-loops',        x: 1, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'follow-ups',        x: 3, y: 0,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'goals',             x: 0, y: 2,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'learning',          x: 1, y: 2,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'token-budget',      x: 2, y: 2,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'memory-health',     x: 3, y: 2,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'projects',          x: 0, y: 4,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'calendar',          x: 1, y: 4,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'integrations',      x: 2, y: 4,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'context',           x: 3, y: 4,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'activity-timeline', x: 0, y: 6,  w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'token-chart',       x: 2, y: 6,  w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'inspiration',       x: 0, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'recent-messages',   x: 1, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
    ],
  },
  'Developer': {
    lg: [
      { i: 'integrations',      x: 0, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'context',           x: 2, y: 0,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'memory-health',     x: 0, y: 3,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'recent-actions',    x: 2, y: 3,  w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'token-chart',       x: 0, y: 6,  w: 2, h: 3, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'activity-timeline', x: 2, y: 6,  w: 2, h: 4, ...SHARED_CONSTRAINTS, minW: 2 },
      { i: 'risk-signals',      x: 0, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'open-loops',        x: 1, y: 9,  w: 1, h: 2, ...SHARED_CONSTRAINTS },
      { i: 'projects',          x: 0, y: 11, w: 2, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'goals',             x: 2, y: 10, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'learning',          x: 3, y: 10, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'follow-ups',        x: 0, y: 14, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'calendar',          x: 1, y: 14, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'token-budget',      x: 2, y: 13, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'inspiration',       x: 3, y: 13, w: 1, h: 3, ...SHARED_CONSTRAINTS },
      { i: 'recent-messages',   x: 0, y: 17, w: 2, h: 3, ...SHARED_CONSTRAINTS },
    ],
  },
};

const BREAKPOINTS = { lg: 1200, md: 768, sm: 0 };
const COLS = { lg: 4, md: 2, sm: 1 };
const ROW_HEIGHT = 80;

export { PRESET_LAYOUTS };

export default function DraggableDashboard({ activePreset, onPresetApplied }) {
  const { width, mounted, containerRef } = useContainerWidth({ measureBeforeMount: true });
  const [layoutKey, setLayoutKey] = useState(0);

  const initialLayouts = useMemo(() => {
    if (activePreset && PRESET_LAYOUTS[activePreset]) {
      return PRESET_LAYOUTS[activePreset];
    }
    const saved = loadLayouts();
    return saved || DEFAULT_LAYOUTS;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, activePreset]);

  const handleLayoutChange = useCallback((_currentLayout, allLayouts) => {
    saveLayouts(allLayouts);
  }, []);

  const isMobile = width < 768;

  return (
    <div className="space-y-6">
      {/* Full-width sections above grid */}
      <OnboardingChecklist />
      <CapabilityHighlightsCard />

      {/* Draggable grid */}
      <div ref={containerRef}>
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
            {Object.entries(CARD_COMPONENTS).map(([key, Component]) => (
              <div key={key} className="h-full">
                <Component />
              </div>
            ))}
          </ResponsiveGridLayout>
        ) : null}
      </div>
    </div>
  );
}
