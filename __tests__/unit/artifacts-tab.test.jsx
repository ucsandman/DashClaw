import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Pins the evidence-bundle fix: the returned bundle is surfaced (was discarded)
// and failures are shown (the handler previously swallowed errors in catch {}).

// MarkdownBody lives in a .js file containing JSX (not vitest-transformable) — mock it.
vi.mock('@/messages/_components/MarkdownBody', () => ({ default: ({ content }) => <div>{content}</div> }));

const { default: ArtifactsTab } = await import('@/components/ArtifactsTab.jsx');

afterEach(() => { vi.unstubAllGlobals(); });

describe('ArtifactsTab — evidence bundle', () => {
  it('surfaces the returned bundle summary on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        // The endpoint returns a signed envelope; bundle content lives under `payload`.
        return { ok: true, status: 200, json: async () => ({ version: 'dashclaw-compliance-bundle/v1', signature: { kid: 'k1' }, payload: { action: { action_id: 'act_1' }, steps: [1, 2], artifacts: [1], generated_at: '2026-06-02T00:00:00Z' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ artifacts: [] }) };
    }));

    render(<ArtifactsTab actionId="act_1" />);
    fireEvent.click(await screen.findByRole('button', { name: /generate evidence bundle/i }));

    expect(await screen.findByText(/Evidence bundle generated — 2 steps, 1 artifact/)).toBeTruthy();
  });

  it('surfaces an error instead of silently swallowing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if ((options.method || 'GET') === 'POST') {
        return { ok: false, status: 404, json: async () => ({ error: 'action_not_found' }) };
      }
      return { ok: true, status: 200, json: async () => ({ artifacts: [] }) };
    }));

    render(<ArtifactsTab actionId="act_1" />);
    fireEvent.click(await screen.findByRole('button', { name: /generate evidence bundle/i }));

    expect(await screen.findByText('Action not found.')).toBeTruthy();
  });
});

describe('ArtifactsTab — per-row delete', () => {
  function mockWith(artifacts, onDelete) {
    return vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'DELETE') {
        if (onDelete) onDelete(String(url));
        return { ok: true, status: 200, json: async () => ({ deleted: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ artifacts }) };
    });
  }

  it('deletes an artifact and removes it from the list', async () => {
    const onDelete = vi.fn();
    vi.stubGlobal('fetch', mockWith([
      { artifact_id: 'art_1', name: 'Bundle A', artifact_type: 'evidence_bundle', created_at: null },
      { artifact_id: 'art_2', name: 'Report B', artifact_type: 'report', created_at: null },
    ], onDelete));

    render(<ArtifactsTab actionId="act_1" />);
    expect(await screen.findByText('Bundle A')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /delete bundle a/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('/api/artifacts/art_1'));
    await waitFor(() => expect(screen.queryByText('Bundle A')).toBeNull());
    expect(screen.getByText('Report B')).toBeTruthy();
  });

  it('shows an error when delete fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'DELETE') return { ok: false, status: 404, json: async () => ({ error: 'artifact_not_found' }) };
      return { ok: true, status: 200, json: async () => ({ artifacts: [{ artifact_id: 'art_1', name: 'Bundle A', artifact_type: 'report', created_at: null }] }) };
    }));

    render(<ArtifactsTab actionId="act_1" />);
    await screen.findByText('Bundle A');
    fireEvent.click(screen.getByRole('button', { name: /delete bundle a/i }));

    expect(await screen.findByText('Artifact not found.')).toBeTruthy();
  });
});
