# Decision: Hosted paid tier. Self-hosted stays free, complete, forever. (2026-08-09)

**Status:** Decided by the owner, 2026-08-09. Supersedes, in part, the
"Open source, no paid tier" item locked 2026-05-14 in
[2026-04-11-product-direction.md](./2026-04-11-product-direction.md).
This record exists because reversing a locked decision should be loud and
dated, which is the same standard DashClaw holds its users' agents to.

## What is decided

1. **The software keeps the 2026-05-14 promise.** Self-hosted DashClaw is
   free, MIT licensed, and genuinely complete. Every governance capability
   the project ships runs in the free self-hosted plane. That does not
   change, and this record renews the commitment rather than weakening it.

2. **The hosted service becomes paid.** hosted.dashclaw.io, the control
   plane we operate, gains paid plans. Running infrastructure for other
   people has real costs and real obligations (uptime, backups, upgrades,
   support), and charging for that is not the thing the 2026-05-14
   retraction rejected. What was rejected then was paywalling the product
   itself behind an apologetic funnel. That rejection stands.

3. **The gating principle: capacity and operations, never safety.**
   No tier, free or paid, ever lacks a governance capability. Paid tiers
   gate how much we run for you and how long we keep it:
   seats, governed-action ceilings, retention windows, dedicated rate
   limits, and support. If a change would make a safety feature
   paid-only, the change is wrong.

## Planned shape (ceilings provisional until metering exists)

| Plane | Price | What it is |
| --- | --- | --- |
| Self-hosted | Free forever | The complete governance plane. MIT. No account with us needed. |
| Hosted trial | Free, 30 days | The existing anonymous trial workspace, unchanged. |
| Hosted Indie | ~$49/mo | We run it for you: managed realtime, upgrades, backups. 2 seats, monthly governed-action ceiling, 30-day retention, email support. |
| Hosted Team | ~$199/mo | 10 seats, higher ceilings, 90-day retention, org-scoped rate limits, priority support. |

Ceilings and final prices are set only after a per-org metering rollup
exists and has been run against real hosted usage. Pricing before
measuring would be guessing, and this project does not ship guesses as
numbers.

## Build order this implies

Accounts before billing (you cannot bill an anonymous trial cookie).
Metering before price finalization. Entitlement enforcement restored at
the capacity seams only, per the gating principle above, replacing the
dead `requireTier()` no-op shim. Checkout and the customer portal come
last, after the things they depend on are true.

## What this explicitly does not change

- The MIT license and the complete self-hosted plane.
- The hosted trial's existence and its current shape.
- No telemetry requirements, no feature keys, no calling home from
  self-hosted installs.
- The docs' honesty standard: the pricing page that eventually returns
  must say plainly that self-hosting is free and complete, and what the
  hosted fee actually buys.
