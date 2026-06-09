import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// The /connect page is now a framework-agnostic runbook. The previous
// HostedProvisionSection (inline workspace-token UX) was removed when
// the hosted-trial pathway was deprecated; assertions about that
// section are gone with it.
vi.mock('@/components/PublicNavbar', () => ({ default: () => null }));
vi.mock('@/components/PublicFooter', () => ({ default: () => null }));

import ConnectPage from '@/connect/page.jsx';

// ConnectPage is an async server component (Next 16 awaits searchParams).
// Await it before rendering. No ?hosted= => the full runbook.
async function renderPage() {
  const element = await ConnectPage({ searchParams: Promise.resolve({}) });
  return renderToString(element);
}

describe('/connect runbook', () => {
  it('does NOT contain multi-step wizard markers', async () => {
    const html = await renderPage();
    // "Step 1 of N" / "Step 2 of N" wizard framing
    expect(html).not.toMatch(/step\s*\d+\s*of\s*\d+/i);
    // The old "Golden path" wizard banner must not return
    expect(html).not.toMatch(/Golden path/i);
  });

  it('exposes the canonical runbook surfaces and proof artifacts', async () => {
    const html = await renderPage();
    // 1. SDK or hooks install command is present somewhere on the page
    expect(html).toMatch(/npm install|pip install|cp hooks/i);
    // 2. The DASHCLAW_API_KEY env var name is the canonical token reference
    expect(html).toMatch(/DASHCLAW_API_KEY/);
    // 3. At least one approval surface (Discord, Telegram, Mobile PWA, CLI, Dashboard) is mentioned
    expect(html).toMatch(/discord|telegram|mobile pwa|approvals/i);
    // 4. The verify command is present
    expect(html).toMatch(/dashclaw doctor/);
    // 5. Proof artifacts point users to the durable records they should see
    expect(html).toMatch(/\/decisions/);
    expect(html).toMatch(/\/approvals/);
    expect(html).toMatch(/\/api\/setup\/live-proof/);
  });
});
