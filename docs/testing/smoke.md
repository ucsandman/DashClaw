---
owner: Platform
last-verified: 2026-04-13
doc-type: guide
---

# UI Smoke Sweep

`npm run test:smoke` loads every dashboard page through a headless Chromium and asserts the page renders cleanly — no console errors, no Next.js fatal-error overlay, no client error boundaries, no 5xx, no uncaught exceptions. It's the systematic replacement for "click around the app for an hour before shipping."

Runs in **~25 seconds** against a dedicated demo-mode dev server. Finds zero-state bugs, hydration issues, stale fetches, broken imports, and crashes-on-mount.

## One-time setup

Installed as devDependencies — no separate install step beyond `npm install`:

```bash
npm install                             # installs @playwright/test
npx playwright install chromium         # downloads the Chromium headless shell (~110 MB)
```

## Running

```bash
# Full sweep against a freshly-booted demo-mode server on port 3099
npm run test:smoke

# Watch the browser navigate (useful for debugging a single failure)
npm run test:smoke -- --headed

# Run one test
npm run test:smoke -- --grep "Approvals"

# Point at an already-running target (staging, prod, etc.)
PW_BASE_URL=https://stage.example.com npm run test:smoke
```

Outputs:
- **Pass summary** in the terminal (`28 passed, 4 failed`)
- **HTML report** at `playwright-report/index.html` (`npx playwright show-report` to open)
- **Screenshot + video + trace** on every failure at `test-results/<test-name>/`
- **`error-context.md`** per failure with the page snapshot and error details — optimized for handing to an AI agent to triage

## What it checks, per page

1. **Status < 500** — server didn't crash on the route
2. **No Next.js fatal-error overlay** — looking for "Unhandled Runtime Error", "Build Error", "Server Error", "Module Not Found" text inside `<nextjs-portal>`
3. **No client error boundary** — "Application error:" text anywhere on page
4. **No `pageerror`** — uncaught throw from client code (window.onerror)
5. **No unexpected console errors** — filtered through `KNOWN_CONSOLE_NOISE` in `tests/smoke/dashboard.spec.js`

### Why demo mode?

The suite runs against `DASHCLAW_MODE=demo` + `NEXT_PUBLIC_DASHCLAW_MODE=demo` on port 3099. Demo mode gives every dashboard page fixture data to render, so it's reproducible on a fresh clone with no DB and no secrets. Writes return 403 by design; reads return fixture data.

The smoke cookie flips the mode but doesn't grant a real org-scoped session, so some protected fetches return 401/403 — those are filtered as expected noise. The page should still render gracefully; if it crashes on the failed fetch, `pageerror` or the fatal-overlay check still fires.

## Adding a page

Edit `tests/smoke/pages.js` — drop a new entry into the right group:

```js
export const GOVERN_PAGES = [
  // ...
  { path: '/new-thing', label: 'New thing' },
];
```

Re-run `npm run test:smoke`. If the page needs dynamic params (e.g. `/agents/[agentId]`), seed the demo fixture with a known ID and use it as the path.

## Adding a noise filter

If the suite fails with a console error that isn't a real bug, decide carefully:
- **Is it a real user-facing issue in prod?** → fix the app
- **Is it truly noise that will never matter?** → add a regex to `KNOWN_CONSOLE_NOISE` with a **one-line comment** explaining why

Keep that list short. Every entry is a place a real bug could hide.

## Parallel tool — Vercel Agent Browser

Use `agent-browser` for AI-driven flow testing, not for this deterministic smoke sweep. See [docs/testing/agent-browser.md](./agent-browser.md).

| | Smoke (Playwright) | Flow (Agent Browser) |
|---|---|---|
| Question answered | "does every page render?" | "does the approval flow work end-to-end?" |
| Who decides what to do | test code | Claude, driving intelligently |
| Cost per test | ~0 (no AI tokens) | ~1,400 tokens per 6 assertions |
| Runs in CI | yes | no — on-demand only |

## Current known failures

None — the suite is green as of 2026-04-13 (32/32). Four bugs found on first run have all been fixed:

| Page | Root cause | Fix |
|---|---|---|
| `/identities` | Demo middleware crashed on `fixtures.pairings.filter(...)` because pairings aren't in the fixture export. | `middleware.js` — guard with `Array.isArray(...)` fallback. |
| `/mission-control` + `/demo` | `GET /api/actions/costs` was swallowed by the `/api/actions/[actionId]` catch-all in demo middleware, treated as an unknown action ID, returned 404. | `middleware.js` — explicit handler for `/api/actions/costs` before the catch-all. |
| `/prompts` | Template list rendered `<button>` inside `<button>` — HTML spec violation emitted by React as a console error. | `app/prompts/page.js` — outer element converted to `<div role="button" tabIndex={0}>` with `onKeyDown` for Enter/Space so keyboard a11y is preserved. |

If `npm run test:smoke` fails again, add the new findings here and the same fix-and-remove loop applies.
