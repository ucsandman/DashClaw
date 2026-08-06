# DashClaw marketing site truth audit - 2026-08-06

## Scope

Compared the live marketing site at `https://www.dashclaw.io` against the current local DashClaw codebase at `C:\Projects\DashClaw`.

Checked:
- Public sitemap pages from `https://www.dashclaw.io/sitemap.xml`
- `app/*` marketing/docs source pages
- Current route inventory in `docs/api-inventory.json` / `docs/api-inventory.md`
- Generated platform guide data in `public/guides/platform-guide-data.json`
- Plugin, SDK, MCP package versions
- npm/PyPI public registry versions
- Existing docs/version/drift gates

## Verified healthy

- All 19 sitemap URLs checked returned HTTP 200.
- `/connect` now uses the canonical OpenClaw install command:
  `openclaw plugins install @dashclaw/openclaw-plugin`
- The home page claim is appropriately bounded: hard enforcement at Claude Code/Codex/Hermes hooks and the OpenClaw gateway; cooperative support for SDK/MCP/REST.
- MCP server claim is accurate in source: 17 tools and 3 resources.
- Local gates passed:
  - `npm run docs:check`
  - `npm run guide:drift:check`
  - `npm run version:sync:check`
  - `npm run api:inventory:check`
- Current API inventory is freshly verified and internally consistent:
  - `docs/api-inventory.json`: 123 routes, 172 route+method pairs
  - `docs/api-inventory.md`: last verified 2026-08-06
- App health is current:
  - `https://my-dashclaw.vercel.app/api/health` returns `version: "5.8.3"` and `mode: "live"`

## Findings

### P1 - Public package version labels overstate what users can install

Live `/docs` and `/downloads` present Node/Python SDK docs as `v5.8.3`, and `/downloads` shows generic install commands next to `Install (v5.8.3)`:

```text
npm install dashclaw
pip install dashclaw
```

Current registry truth:
- `npm view dashclaw version` -> `5.6.2`
- PyPI `dashclaw` latest -> `5.6.2`

Current repo truth:
- Root/package sync version: `5.8.3`
- `sdk/package.json`: `5.8.3`
- `sdk-python/pyproject.toml`: `5.8.3`

The changelog says non-contiguous published SDK versions are expected when SDK source did not change. That makes the local source version valid, but the public install labels misleading. A visitor running the shown commands gets `5.6.2`, not `5.8.3`.

Fix options:
- Publish Node/Python SDK `5.8.3`, or
- Change marketing labels to distinguish "platform/docs version" from "published SDK package version", or
- Remove version numbers from generic install CTAs and keep exact package versions in a registry-backed downloads table.

### P1 - OpenClaw plugin install path still depends on stale npm

Live `/connect` and `/guides/openclaw` now show the correct OpenClaw CLI install command, but npm still serves an older plugin:

- Repo `packages/openclaw-plugin/package.json`: `1.5.0`
- `npm view @dashclaw/openclaw-plugin version`: `1.2.5`

The live docs are syntactically correct, but practically stale until the package is republished. A real public install from npm will not install the repo version tested locally.

Fix:
- Publish `@dashclaw/openclaw-plugin@1.5.0` after npm 2FA, or temporarily add a visible note/pinned alternate install path for the unreleased package.

### P1 - Platform guide generated data is stale even though the route drift gate passes

`/guides/platform` renders from `public/guides/platform-guide-data.json`. That data is stale:

- `meta.generatedAt`: `2026-07-07`
- `meta.counts.total`: `421`
- Current API inventory: 123 routes / 172 route+method pairs
- Live example health response in the dataset was captured from a local `4.67.0` instance
- Dataset still describes x402-era surfaces that the v5 release ledger says were removed from this repo

The existing `scripts/check-platform-guide-drift.mjs` passes because it only validates route+method coverage for `area.kind === "api"` entries. It does not fail stale descriptive text, stale examples, stale page entries, stale plugin capability notes, or deleted non-route surfaces.

Fix:
- Regenerate `public/guides/platform-guide-data.json` and `docs/platform-guide-coverage.json` from the current v5.8.3 repo/live app.
- Extend the gate to fail on stale generated age, stale live example app version, removed route/path mentions, removed SDK method mentions, and deleted page entries.

### P1 - OpenClaw guide claims x402 spend gating that the current plugin source does not implement

Live `/guides/openclaw` says the plugin ships "x402 spend gating and token-cost attribution built in."

Current source check:
- `packages/openclaw-plugin/src/index.ts` has token attribution paths but no x402 implementation knobs or purchase-recording flow.
- `packages/openclaw-plugin/README.md` has already been purged of x402 references.
- `CHANGELOG.md` explicitly says the x402 subsystem was removed in the v5 cull and the plugin README was purged.

Fix:
- Change `/guides/openclaw` to claim token-cost attribution only.

### P2 - Plugin hook reference still documents removed x402 behavior

`packages/openclaw-plugin/src/HOOK.md` still contains an "x402 capability spend" section documenting:
- `x402CommandPatterns`
- `x402ToolNames`
- `x402Enabled`
- `recordPurchase()`
- `POST /api/x402/purchases`
- `recordX402Purchase` / `record_x402_purchase`
- `Spend -> x402`

Those claims conflict with the current plugin README and current API inventory.

Fix:
- Remove or rewrite the x402 section in `HOOK.md` to match the v5 plugin.

### P3 - `/connect` source comments are stale

`app/connect/page.tsx` has stale internal comments describing the page as "4 integration cards" and "5 framework guides." The rendered page now has five integration surfaces and more framework guides.

Fix:
- Update comments opportunistically. This is not user-facing.

## Recommended fix order

1. Remove the OpenClaw x402 claim from `/guides/openclaw`.
2. Remove the stale x402 section from `packages/openclaw-plugin/src/HOOK.md`.
3. Decide whether to publish SDK/plugin packages or soften public version labels.
4. Regenerate the platform guide dataset from current v5.8.3 truth.
5. Add a stricter stale-surface gate so deleted surfaces cannot survive in generated guide copy.

## Commands run

```powershell
npm run docs:check
npm run guide:drift:check
npm run version:sync:check
npm run api:inventory:check
npm view dashclaw version
npm view @dashclaw/openclaw-plugin version
npm view @dashclaw/mcp-server version
Invoke-WebRequest https://pypi.org/pypi/dashclaw/json
Invoke-WebRequest https://www.dashclaw.io/sitemap.xml
Invoke-WebRequest https://www.dashclaw.io/api/health
Invoke-WebRequest https://my-dashclaw.vercel.app/api/health
rg -n "x402|recordX402|record_x402|/api/x402|/spend/x402" app docs public packages sdk sdk-python scripts -S
```

