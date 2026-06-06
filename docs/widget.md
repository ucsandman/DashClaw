# DashClaw status widget (`/widget`)

A tiny, glanceable agent cockpit — a status light, not a dashboard. Install it as
a standalone desktop app and you can tell at a glance whether your agents are
calm, busy, blocked, or need you, plus the last few governed actions.

It ships **with your DashClaw deployment** (e.g. Vercel) at `/widget` and installs
as a Progressive Web App (PWA) — no separate download, no build, no extra config.

## Install it (easiest)

1. Open your instance's widget: `https://<your-dashclaw-domain>/widget` (sign in
   first — it's auth-gated like every dashboard page).
2. Install it as an app:
   - Click the **Install** button in the widget header (shown when your browser
     supports install), **or**
   - Use the browser's install control: Chrome/Edge show an **install icon (⊕)**
     in the address bar → click → **Install**.
3. It opens in its own standalone window. It auto-connects to the instance you
   installed it from (same-origin session — no API key, nothing to configure).

> Supported in Chrome and Edge (desktop). Other browsers can still use the
> app-mode or bookmark approach below.

### Float it (pop out)

Click the **pop-out icon (⧉)** in the widget header to open it in a small,
minimal-chrome floating window you can park anywhere on screen. The separate ↗
icon opens the full dashboard. (Inside the floating window the pop-out icon is
hidden so you don't spawn duplicates.)

### Keep it always-on-top

Browsers can't set always-on-top from a web page, so pin the floating (or
installed) window with a one-time OS toggle. The planned native desktop app adds
a built-in always-on-top toggle (and a tray icon + native approve notifications).

- **Windows**: [PowerToys → Always On Top](https://learn.microsoft.com/windows/powertoys/always-on-top) — focus the window and press `Win + Ctrl + T`.
- **macOS**: a window manager (Rectangle Pro, Amethyst, …) "keep on top".
- **Linux**: most window managers expose "Always on Top" in the window menu.

### Alternative: app-mode launcher (no install)

Prefer a one-off frameless window instead of installing? Point a browser at your
instance in app-mode (replace the domain):

```
# Chrome
chrome --app=https://<your-dashclaw-domain>/widget --window-size=360,640

# Edge
msedge --app=https://<your-dashclaw-domain>/widget --window-size=360,640
```

Save that as a `.bat` (Windows) / `.command` (macOS) / `.sh` (Linux) launcher for
one-click open.

## What it is

- Route: `/widget` (chrome-free — no sidebar/app shell), ~340px wide, dark.
- Installable PWA: `app/widget/layout.tsx` references `public/config/widget.webmanifest`
  (`start_url: /widget`), and the page registers the shared service worker.
- Data: one composed endpoint, `GET /api/widget/summary`, refreshed every 30s and
  on live realtime events (it reuses the dashboard's existing SSE stream, so it
  opens no extra connection).
- Operator decisions only. The widget shows pending approvals with inline
  **Approve / Deny** — these are *your* human governance decisions, resolved
  through the same `/api/approvals/[actionId]` path as every other surface, and
  they clear the approval **everywhere** (dashboard, Discord, Telegram) at once.
  The buttons are admin-gated. The widget never acts AS an agent and exposes no
  agent tools — for everything else, open the full dashboard (↗ → `/mission-control`).

## Posture states

The header pill shows one overall posture. Each state pairs an icon **and** a
text label (never color alone). Precedence is highest-first:

| State | Meaning | When |
|---|---|---|
| **Offline** | The widget can't reach the server | No successful fetch recently (connection lost). Overrides everything else. |
| **Elevated** | Realized risk — something needs attention now | A red (critical) signal, a blocked action, or a high-risk action is present. |
| **Approval** | A human decision is waiting | One or more actions are `pending_approval`. |
| **Active** | Agents are working | Actions are currently running (or there are amber/minor signals). |
| **Calm** | All clear | None of the above. |

`Offline` is a client-side connection state; the other four are computed
server-side in `app/lib/widget/summary.ts` (`computeWidgetPosture`). The footer
shows the live connection separately: **Live** / **Reconnecting** / **Offline**.

## What it shows

- **Pending approvals**: each waiting action with inline Approve / Deny — decide
  without leaving your desktop; the approval then clears from every channel.
- **Metrics**: active agents (acted in the last 15m), pending approvals,
  attention signals, and recent (24h) spend.
- **Top signal**: the single most important risk signal, if any.
- **Recent log**: the last actions — each with a status icon, a short
  **sanitized** summary, the agent, the status word, and a relative time.

## Privacy

The widget never exposes secrets, prompts, agent reasoning, full message bodies,
or artifact contents. `GET /api/widget/summary` returns a whitelisted, truncated
shape only (`sanitizeRecentAction` in `app/lib/widget/summary.ts`): action id,
agent name, action type, an ≤80-char summary, status, risk score, outcome, and
timestamp. Fields like `reasoning`, `authorization_scope`, `artifacts_created`,
`side_effects`, `model`, `cost_estimate`, and raw error detail are deliberately
dropped and asserted absent in tests.

## Native shell (optional follow-up)

The PWA covers the common case (single hosted instance, zero install friction).
A native Tauri/Electron shell is only worth building if you need **multiple
instances in one app** or **built-in always-on-top** without an OS utility. The
route is built to embed cleanly: point a frameless ~340px, always-on-top window
at `/widget` with a configurable instance URL.
