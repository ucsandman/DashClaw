import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';

vi.mock('@/components/PublicNavbar', () => ({ default: () => null }));
vi.mock('@/components/PublicFooter', () => ({ default: () => null }));

import ConnectPage from '@/connect/page';

afterEach(() => {
  cleanup();
});

/**
 * The ?hosted=<orgId> variant is a stripped Add-to-Claude screen for trial
 * users: the keyless OAuth custom connector is the hero (connector-first),
 * the full SDK/CLI/key runbook collapses under an "Advanced" disclosure, and
 * there is a link to Mission Control. With no ?hosted=, the page must render
 * exactly the existing full guide.
 */
describe('/connect hosted trial variant', () => {
  it('hosted: connector hero is first, keyless, with Advanced disclosure + Mission Control link', async () => {
    const ui = await ConnectPage({ searchParams: Promise.resolve({ hosted: 'org_x' }) });
    const { container } = render(ui);

    const text = container.textContent ?? '';

    // The OAuth custom connector is present (its /api/mcp endpoint copy).
    expect(text).toContain('/api/mcp');

    // Connector-first: the connector endpoint appears in the DOM BEFORE the
    // "Get your API key" Step 1 content (which now lives under the disclosure).
    const connectorIdx = text.indexOf('/api/mcp');
    const apiKeyIdx = text.indexOf('Get your API key');
    expect(connectorIdx).toBeGreaterThanOrEqual(0);
    expect(apiKeyIdx).toBeGreaterThan(connectorIdx);

    // An "Advanced (SDK / CLI)" disclosure exists.
    expect(container.querySelector('details')).toBeTruthy();
    expect(text).toMatch(/Advanced/i);

    // A link to the Approvals inbox is present.
    expect(container.querySelector('a[href="/approvals"]')).toBeTruthy();

    // The hero itself is keyless: no oc_live_ example key in the hero region.
    const hero = container.querySelector('[aria-label="Keyless connector"]');
    expect(hero).toBeTruthy();
    expect(within(hero).queryByText(/oc_live_/)).toBeNull();
    expect(hero.textContent).not.toContain('oc_live_');
  });

  it('not hosted: renders the full guide unchanged (Step 1 at top, no hosted hero)', async () => {
    const ui = await ConnectPage({ searchParams: Promise.resolve({}) });
    const { container } = render(ui);

    const text = container.textContent ?? '';

    // Full guide: the "Get your API key" Step 1 is present.
    expect(text).toContain('Get your API key');

    // No hosted-only affordances.
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('[aria-label="Keyless connector"]')).toBeNull();
    expect(container.querySelector('a[href="/approvals"]')).toBeNull();
  });
});
