import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// P15: the learning page must contain ZERO permanently-dead surfaces. The old
// page had three fed by a `lessons` table that exists in no migration and has
// no write path: the "Lessons Learned" tile, the "Patterns Found" tile, and a
// Distilled Lessons card that could only ever render its empty state. Lessons
// are now LIVE consolidation (learning_recommendations + drift alerts), the
// dead tiles are replaced by real stats, and the Add Lesson modal (which
// silently wrote a *decision*) is gone.

vi.mock('next/link', () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }));
vi.mock('@/components/PageLayout', () => ({ default: ({ children, actions }) => <div>{actions}{children}</div> }));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title, action }) => <div>{title}{action}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: ({ title }) => <div>{title}</div> }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));

const { default: LearningDashboard } = await import('@/learning/page.jsx');

const LESSON = {
  action_type: 'deploy',
  confidence: 88,
  success_rate: 91,
  sample_size: 23,
  guidance: 'deploy-bot succeeds when changes stay reversible.',
  hints: { risk_cap: 60, prefer_reversible: true },
};

function mockFetch({ q = { value: null } } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/api/learning/recommendations/metrics')) {
      return { ok: true, json: async () => ({ metrics: [], summary: {} }) };
    }
    if (u.startsWith('/api/learning/recommendations')) {
      return { ok: true, json: async () => ({ recommendations: [
        { id: 'rec1', agent_id: 'deploy-bot', action_type: 'deploy', confidence: 88, sample_size: 23, active: true },
        { id: 'rec2', agent_id: 'deploy-bot', action_type: 'cleanup', confidence: 60, sample_size: 8, active: false },
      ] }) };
    }
    if (u.startsWith('/api/learning/suggestions')) return { ok: true, json: async () => ({ suggestions: [] }) };
    if (u.startsWith('/api/learning/code-signals')) return { ok: true, json: async () => ({ findings: [], period: '30d' }) };
    if (u.startsWith('/api/learning')) {
      q.value = new URL(u, 'http://test').searchParams.get('q');
      return {
        ok: true,
        json: async () => ({
          decisions: [{ id: 1, decision: 'use neon', outcome: 'success', timestamp: '2026-06-10' }],
          lessons: [LESSON],
          drift_warnings: [{ metric: 'risk_score', severity: 'critical', direction: 'increasing' }],
          stats: { totalDecisions: 1, totalLessons: 1, successRate: 100, totalWithOutcome: 1 },
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('learning page — honest surface', () => {
  it('renders no permanently-dead tiles and shows real consolidated lessons', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<LearningDashboard />);

    // Real lesson content renders from the consolidation shape.
    expect(await screen.findByText('deploy-bot succeeds when changes stay reversible.')).toBeTruthy();
    expect(screen.getByText('23 samples')).toBeTruthy();
    expect(screen.getByText('risk cap 60')).toBeTruthy();
    expect(screen.getByText('prefer reversible')).toBeTruthy();
    // Drift warning chip from the same consolidation payload.
    expect(screen.getByText(/risk score increasing/)).toBeTruthy();

    // The dead tiles are gone; their replacements are fed by real data.
    expect(screen.queryByText('Lessons Learned')).toBeNull();
    expect(screen.queryByText('Patterns Found')).toBeNull();
    expect(screen.getByText('Active Recommendations')).toBeTruthy();

    // The Add Lesson modal (which wrote a *decision*) no longer exists.
    expect(screen.queryByText('Add Lesson')).toBeNull();
    // The Pattern Summary panel grouping on a never-persisted column is gone.
    expect(screen.queryByText('Decision Categories')).toBeNull();
  });

  it('exposes the server-side decision search (q) the repository already supported', async () => {
    const q = { value: null };
    vi.stubGlobal('fetch', mockFetch({ q }));
    render(<LearningDashboard />);
    const input = await screen.findByPlaceholderText(/Search the full decision history/);
    fireEvent.change(input, { target: { value: 'cache' } });
    await waitFor(() => expect(q.value).toBe('cache'));
  });
});
