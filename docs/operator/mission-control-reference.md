# Global Status Bar Reference

What every badge and counter on the global status bar means. This is the "what am I looking at" companion to [Fleet Management](./fleet-management.md).

> The richer Mission Control dashboard (Command Strip, Signal Quadrants, the dedicated `/security` page) was retired in the v5.0.0 cull. Approvals (`/approvals`) is now a focused queue for pending approvals; the status bar below is the surviving always-on summary, and the full per-signal breakdown lives on [`/decisions`](/decisions).

## System Posture

A single tri-state summary of fleet risk, shown in the global status bar. It is a roll-up of the active risk signals — not an alarm.

| Posture | When | Color |
|---|---|---|
| **Nominal** | No active signals | success (green) |
| **Elevated** | ≥1 amber (warning) signal active | warning (amber) |
| **Critical** | ≥1 red (critical) signal active | error (red) |

> Elevated is a *health* read, not a panic state — it means the governance layer is doing its job and surfacing something worth a glance. The bar is intentionally calm and does not pulse.

## Status bar — "N active governance signals"

The right side of the global status bar counts the signals currently active (after operator dismissals). It is a **link** — click it to open [`/decisions`](/decisions) for the per-signal breakdown: signal type, severity, the agent involved, detail, and the related action's post-mortem. The left side shows the same counts split out:

- **N Critical** — red signals (e.g. failure loops, repeated blocks).
- **N Elevated** — amber signals (e.g. autonomy/velocity spikes, stale branches).
- **All clear** — no active signals.

## Drilling in

Every signal is clickable. From `/decisions`, selecting a signal opens a detail panel with its type, severity, the agent, the human-readable detail, and a link to the related action's full decision post-mortem (the replay).
