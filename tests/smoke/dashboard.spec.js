// tests/smoke/dashboard.spec.js
//
// Visits every page in tests/smoke/pages.js and asserts:
//   1. HTTP status < 500                 (server didn't crash)
//   2. No Next.js dev-mode error overlay (route handler didn't throw)
//   3. No "Application error" boundary   (client component didn't throw)
//   4. No uncaught console errors        (not whitelisted as known noise)
//   5. No uncaught page errors           (window.onerror)
//
// The goal is "does every page RENDER cleanly in demo mode" — not functional
// testing. That catches the zero-state, hydration, and import-time bugs that
// normally only surface when a human clicks through.
//
// Console-error whitelist is intentionally narrow. If you add an entry here,
// add a comment explaining why the noise is not a real bug.

import { test, expect } from '@playwright/test';
import { ALL_PAGES } from './pages.js';

// Regex patterns for console errors we know are not bugs. Keep this list
// short — every entry is a reason a real bug could slip through.
const KNOWN_CONSOLE_NOISE = [
  // Next.js dev-mode HMR disconnect during the shared server's reload
  /\[HMR\].*Disconnected/i,
  // Chromium autofill probing on login forms — harmless, emits from DOM
  /Autofill\.(enable|setAddresses)/i,
  // DevTools extension warnings in some Chromium builds
  /chrome-extension:/i,
  // favicon.ico 404 on demo mode — cosmetic
  /Failed to load resource.*favicon/i,
  // Demo-mode expected 4xx on dashboard fetches. The smoke cookie flips the
  // mode but doesn't grant an org-scoped session, so protected reads 401/403.
  // The PAGE should render gracefully (empty state) — if it crashes, the
  // pageerror / fatal-overlay checks still catch it. This noise filter only
  // silences the fetch-layer log, not the app-layer exception.
  /Failed to load resource.*status of (401|403)/i,
];

function isFatalConsoleError(message) {
  return !KNOWN_CONSOLE_NOISE.some((re) => re.test(message));
}

for (const page of ALL_PAGES) {
  test(`${page.path} — ${page.label}`, async ({ page: pw }) => {
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];

    pw.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    pw.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    // Capture URL + status for any response that crossed the 4xx/5xx threshold
    // so failure messages tell us exactly which fetch broke, not just "500".
    pw.on('response', (res) => {
      if (res.status() >= 400) {
        failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });

    const response = await pw.goto(page.path, { waitUntil: 'domcontentloaded' });
    // `/demo` 302-redirects to the public live-demo anchor; other routes return 200.
    // Any 5xx means the server threw.
    const status = response?.status() ?? 0;
    expect(
      status,
      `${page.path} returned ${status}${response?.url() ? ` (final url ${response.url()})` : ''}`,
    ).toBeLessThan(500);

    // Give client components time to hydrate and fire any runtime errors.
    await pw.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      // Some pages (SSE streams, long-polling) never hit "idle". Fall through —
      // the assertions below still run.
    });

    // Next.js 16 <nextjs-portal> hosts BOTH the minor dev-indicator badge and
    // the fatal error dialog. We only fail on the fatal-error version — look
    // inside the portal for the error dialog's distinctive heading text.
    const fatalErrorTitles = await pw
      .locator('nextjs-portal')
      .getByText(/Unhandled Runtime Error|Build Error|Server Error|Module Not Found/i)
      .count();
    expect(fatalErrorTitles, `Next.js fatal error overlay visible on ${page.path}`).toBe(0);

    // Client component error boundary from next/error
    const appError = await pw.getByText(/Application error:/i).count();
    expect(appError, `Application error boundary rendered on ${page.path}`).toBe(0);

    // Server error boundary text
    const serverError = await pw.getByText(/Something went wrong/i).first().isVisible().catch(() => false);
    expect(serverError, `Server error boundary rendered on ${page.path}`).toBeFalsy();

    // pageerror = window.onerror = uncaught throw from client code. Always a bug.
    expect(
      pageErrors,
      `Uncaught page error on ${page.path}:\n${pageErrors.join('\n')}`,
    ).toEqual([]);

    // Console errors filtered through the known-noise list. Append the
    // captured failed-request URLs so failure messages name the exact broken
    // fetch instead of the generic "Failed to load resource: 500".
    const fatal = consoleErrors.filter(isFatalConsoleError);
    const failedUrls = failedRequests.length
      ? `\n  Failed requests:\n    ${failedRequests.join('\n    ')}`
      : '';
    expect(
      fatal,
      `Unexpected console errors on ${page.path}:\n  ${fatal.join('\n  ')}${failedUrls}`,
    ).toEqual([]);
  });
}
