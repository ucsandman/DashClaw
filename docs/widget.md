# DashClaw status widget (`/widget`)

A tiny, glanceable agent cockpit — a status light, not a dashboard. Open it in a
small always-on-top window and you can tell at a glance whether your agents are
calm, busy, blocked, or need you, plus the last few governed actions.

It is a **compact web route**, not a native desktop app (yet). It is built to be
wrapped by a native always-on-top shell later (see [Follow-up](#follow-up-native-shell)).

## What it is

- Route: `/widget` (chrome-free — no sidebar/app shell), ~320–340px wide, dark.
- Data: one composed endpoint, `GET /api/widget/summary`, refreshed every 30s
  and on live realtime events (it reuses the dashboard's existing SSE stream, so
  it opens no extra connection).
- Read-only. DashClaw is a governance runtime; the widget only *observes*. It
  never approves, runs, or changes anything — open the full dashboard for that.

## How to open it

1. Start DashClaw (or use your deployed instance).
2. Sign in, then navigate to `/widget` (e.g. `http://localhost:3000/widget`).
   It is auth-gated like every other dashboard page; signed-out visits redirect
   to `/login`.

### Always-on-top

The widget is designed to float. Two zero-install options:

**Browser app-mode window** (a frameless, single-purpose window):

```
# Chrome
chrome --app=http://localhost:3000/widget --window-size=360,640

# Edge
msedge --app=http://localhost:3000/widget --window-size=360,640
```

**Keep it on top** with an OS utility:

- **Windows**: [PowerToys → Always On Top](https://learn.microsoft.com/windows/powertoys/always-on-top) (default hotkey `Win + Ctrl + T` over the focused window).
- **macOS**: a window manager (Rectangle Pro, Amethyst, etc.) or a Fluid/again-style site-specific browser.
- **Linux**: most window managers expose "Always on Top" in the window title-bar menu.

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

## Follow-up: native shell

A native always-on-top shell (Tauri or Electron) wrapping `/widget` is **not**
built in this pass — the repo has no native tooling, and a web route plus the
app-mode instructions above cover the need with zero new dependencies. When a
native shell is wanted, point a frameless ~340px-wide, always-on-top window at
`/widget`; the route is built to embed cleanly (own bare layout, no app chrome,
single composed data endpoint).
