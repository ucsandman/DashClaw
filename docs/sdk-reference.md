---
source-of-truth: false
status: redirect
last-verified: 2026-07-10
doc-type: pointer
---

# DashClaw SDK Reference

> This file is a pointer, not a reference. The canonical SDK reference
> document moved to **[`sdk/README.md`](../sdk/README.md)** during the
> 2026-04-11 docs sync pass. The previous standalone reference drifted
> out of date with the actual SDK surface (it documented 45 methods while
> the v2 SDK had grown to 87) and was retired to prevent two sources of
> truth.

## Where to go

| Looking for | Canonical location |
|---|---|
| Full v2 method catalogue (31 methods) + canonical HITL flow + error handling + Execution Studio usage | **[`sdk/README.md`](../sdk/README.md)** |
| Domain-level parity between Node v2 / Node legacy / Python | **[`docs/sdk-parity.md`](./sdk-parity.md)** |
| Per-domain method inventory and system architecture | **[`PROJECT_DETAILS.md`](../PROJECT_DETAILS.md)** |
| Runtime governance loop (HTTP API shape) | **[`docs/architecture/runtime-api.md`](./architecture/runtime-api.md)** |
| Legacy v1 method surface (pairing, compliance, webhooks, drift, etc.) | **[`docs/sdk-parity.md`](./sdk-parity.md)** → Legacy Node section |
| Published npm package | [`npm install dashclaw`](https://www.npmjs.com/package/dashclaw) |

The historical content of this file is preserved at
[`docs/archive/sdk-reference-2026-04-11.md`](./archive/sdk-reference-2026-04-11.md)
for anyone tracing old links. Do not treat it as current — it was drifting
for months before being retired.

## Why this moved

`sdk/README.md` is the markdown served to the website `/docs` page via
`/api/docs/raw` and the **Copy as Markdown** button, so it is already the
most user-facing reference surface. Keeping a second reference document
in `docs/` that had to be manually synced turned out to produce drift
every time a new SDK method shipped. Single source of truth wins.
