import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The pack-install banner has to be honest about what an install actually did.
 *
 * Two lies it used to tell: it called every import an "imported rule" without
 * saying the rules land in Watch and cannot interrupt, and it rendered every
 * skipped line as "already present" — including lines the hard ten-line Short
 * List cap DROPPED, which is not a no-op the operator can ignore.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import PackGallery from '@/policies/packs/PackGallery';

const TEMPLATE = {
  id: 'read-only-analyst',
  name: 'Read-only Analyst',
  description: 'Analyst pack',
  recommended_for: 'analysts',
  audience: 'team',
  audience_label: 'Team',
  strictness: 'balanced',
  strictness_label: 'Balanced',
  stack_after: null,
  installed: false,
  policy_count: 2,
  policies: [
    { name: 'Read-only shape', policy_type: 'warn_action_type', rules_summary: 'warn on write', bucket: 'warn' },
    { name: 'Analyst role', policy_type: 'role_constraint', rules_summary: 'role gate', bucket: 'require_approval' },
  ],
};

function mockFetch(importBody) {
  return vi.fn(async (url, options = {}) => {
    if (String(url).startsWith('/api/policies/import')) {
      return { ok: true, status: 200, json: async () => importBody };
    }
    return { ok: true, status: 200, json: async () => ({ templates: [TEMPLATE] }) };
  });
}

async function install(importBody) {
  vi.stubGlobal('fetch', mockFetch(importBody));
  render(<PackGallery />);
  fireEvent.click(await screen.findByText('Read-only Analyst'));
  fireEvent.click(await screen.findByRole('button', { name: 'Install pack' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pack install banner', () => {
  it('says the imported rules landed in Watch and cannot interrupt', async () => {
    await install({ imported: 2, skipped: 0, skipped_names: [], watched: 2, dormant: 0 });

    expect(await screen.findByText(/Installed 2 rules in Watch\./)).toBeTruthy();
    expect(screen.getByText(/none of them can interrupt until you promote them/)).toBeTruthy();
  });

  it('names the dormant installs separately', async () => {
    await install({ imported: 1, skipped: 0, skipped_names: [], watched: 1, dormant: 1 });

    expect(await screen.findByText(/1 installed dormant/)).toBeTruthy();
    expect(screen.getByText(/turn them on from the Short List/)).toBeTruthy();
  });

  it('separates cap drops from name collisions', async () => {
    await install({
      imported: 0,
      skipped: 3,
      skipped_names: ['Already here', 'Analyst role (short_list_full)', 'Second gate (short_list_full)'],
      watched: 0,
      dormant: 0,
    });

    // The two the cap turned away are DROPPED, not "already present".
    expect(await screen.findByText(/2 dropped — the Short List is full \(10 of 10\)\./)).toBeTruthy();
    expect(screen.getByText(/1 already present, skipped/)).toBeTruthy();
  });

  it('reads a payload with no skipped_names without inventing cap drops', async () => {
    await install({ imported: 1, skipped: 1 });

    expect(await screen.findByText(/1 already present, skipped/)).toBeTruthy();
    expect(screen.queryByText(/dropped/)).toBeNull();
  });
});
