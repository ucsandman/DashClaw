import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// "One Ledger, Many Lenses" redesign: CustomTab (which owned the import
// overlay inline) was deleted. Import now lives in the standalone ImportPanel,
// which wraps the unchanged PolicyAdvancedImportPanel and owns the same
// preview-before-commit endpoints/state CustomTab used to.
vi.mock('@/components/ui/Badge.js', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));

const { default: ImportPanel } = await import('@/policies/components/ImportPanel.jsx');

const PREVIEW = {
  preview: true,
  would_create: 2,
  would_skip: 1,
  policies: [
    { name: 'Block destructive ops', policy_type: 'block_action_type', conflict: false },
    { name: 'Require deploy approval', policy_type: 'require_approval', conflict: true, conflict_reason: 'Policy with this name already exists' },
  ],
};

function ok(body) { return { ok: true, status: 200, json: async () => body }; }

afterEach(() => { vi.unstubAllGlobals(); });

describe('ImportPanel — import preview before commit (A2)', () => {
  it('previews would_create/would_skip/conflict and only commits after an explicit confirm', async () => {
    const onImported = vi.fn();
    const fetchMock = vi.fn(async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url.startsWith('/api/policies/templates')) return ok({ templates: [] });
      if (method === 'POST' && url.startsWith('/api/policies/import')) {
        if (url.includes('preview=true')) return ok(PREVIEW);
        return ok({ imported: 2, skipped: 1, errors: [], policies: [] });
      }
      return ok({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ImportPanel open onClose={() => {}} onImported={onImported} />);

    // Preview first.
    fireEvent.click(await screen.findByRole('button', { name: /^preview$/i }));

    // The preview renders what would be created and which names conflict.
    expect(await screen.findByText('2 would be created')).toBeTruthy();
    expect(screen.getByText('1 would be skipped')).toBeTruthy();
    expect(screen.getByText('conflict')).toBeTruthy();

    // No commit (non-preview import) has fired yet.
    const commitCalls = () => fetchMock.mock.calls.filter(
      ([u, o]) => u === '/api/policies/import' && o?.method === 'POST',
    );
    expect(commitCalls()).toHaveLength(0);

    // Confirm commits exactly one import.
    fireEvent.click(screen.getByRole('button', { name: /confirm import/i }));
    await waitFor(() => expect(commitCalls()).toHaveLength(1));
    expect(onImported).toHaveBeenCalled();
  });
});
