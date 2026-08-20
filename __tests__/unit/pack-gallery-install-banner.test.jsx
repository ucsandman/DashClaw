import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The pack-install banner has to be honest about what an install actually did.
 *
 * Three lies it used to tell: it said nothing about the rules landing in
 * Watch; then it said ALL of them landed in Watch and "none of them can
 * interrupt", which is exactly false for catastrophe-only (every line opts
 * into the Short List); and it rendered every skipped line as "already
 * present" — including lines the hard ten-line cap DROPPED, which is not a
 * no-op the operator can ignore.
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
  it('says the watched rules cannot interrupt', async () => {
    await install({ imported: 2, skipped: 0, skipped_names: [], watched: 2, short_listed: 0, dormant: 0 });

    expect(await screen.findByText(/2 in Watch — they record and feed calibration; none can interrupt until you promote them\./)).toBeTruthy();
    expect(screen.queryByText(/Short List — these CAN interrupt/)).toBeNull();
  });

  // catastrophe-only: every line carries short_list: true, so it skips the
  // Watch demotion entirely. A banner counting off `imported` claimed four
  // rules that block a `DROP TABLE` "cannot interrupt".
  it('says out loud when the installed rules CAN interrupt', async () => {
    await install({ imported: 4, skipped: 0, skipped_names: [], watched: 0, short_listed: 4, dormant: 0 });

    expect(await screen.findByText(/4 on the Short List — these CAN interrupt\./)).toBeTruthy();
    expect(screen.queryByText(/in Watch/)).toBeNull();
  });

  it('renders both buckets when a pack splits across them', async () => {
    await install({ imported: 3, skipped: 0, skipped_names: [], watched: 2, short_listed: 1, dormant: 0 });

    expect(await screen.findByText(/2 in Watch/)).toBeTruthy();
    expect(screen.getByText(/1 on the Short List — these CAN interrupt\./)).toBeTruthy();
  });

  it('names the dormant installs separately', async () => {
    await install({ imported: 1, skipped: 0, skipped_names: [], watched: 1, short_listed: 0, dormant: 1 });

    expect(await screen.findByText(/1 installed dormant/)).toBeTruthy();
    expect(screen.getByText(/turn them on from the Short List/)).toBeTruthy();
  });

  it('separates cap drops from name collisions', async () => {
    await install({
      imported: 0,
      skipped: 3,
      skipped_names: ['Already here', 'Analyst role (short_list_full)', 'Second gate (short_list_full)'],
      watched: 0,
      short_listed: 0,
      dormant: 0,
    });

    // The two the cap turned away are DROPPED, not "already present".
    expect(await screen.findByText(/2 dropped — the Short List is full \(10 of 10\)\./)).toBeTruthy();
    expect(screen.getByText(/1 already present, skipped\./)).toBeTruthy();
  });

  it('reads a payload with no skipped_names without inventing cap drops', async () => {
    await install({ imported: 1, skipped: 1 });

    expect(await screen.findByText(/1 already present, skipped\./)).toBeTruthy();
    expect(screen.queryByText(/dropped/)).toBeNull();
  });
});
