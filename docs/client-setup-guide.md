# Client Setup Guide

This is a thin pointer document. Client setup content is maintained on several canonical surfaces — use the one that matches what you're trying to do.

| Task | Where to look |
|---|---|
| Deploy DashClaw (Vercel + Neon or local) | [`README.md`](../README.md) · [`QUICK-START.md`](../QUICK-START.md) |
| Connect your first agent (Node / Python / MCP) | `/connect` on your running instance (rendered from [`app/connect/page.tsx`](../app/connect/page.tsx)) |
| Install and use the SDK | [`sdk/README.md`](../sdk/README.md) · Python: [`sdk-python/README.md`](../sdk-python/README.md) |
| Local auth without OAuth | [`docs/deploy-without-oauth.md`](./deploy-without-oauth.md) |
| Full SDK method reference | [`sdk/README.md`](../sdk/README.md) |
| API surface inventory | [`docs/api-inventory.md`](./api-inventory.md) |
| Runtime governance loop | [`docs/architecture/runtime-api.md`](./architecture/runtime-api.md) |

## Verification after client connection

After the client (Node or Python SDK) successfully calls your instance, you can attach a "live proof" token to the verification surface at `/settings` (historically `/setup`) so the dashboard shows the SDK path as verified.

### Python: live proof POST helper

Run this after a successful `DashClaw(...).ping()` to POST a sanitized success payload to `/api/setup/live-proof`:

```python
import json
import urllib.request

payload = {
    "validator": "python-sdk-helper",
    "tool": "python",
    "mode": "read_only",
    "summary": {"passed": 1, "failed": 0, "skipped": 0, "score": 100},
    "checks": [{"name": "Python SDK ping", "status": "pass"}],
}

req = urllib.request.Request(
    "https://your-dashclaw-instance.example.com/api/setup/live-proof",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Content-Type": "application/json",
        "x-api-key": "<api-key>",
    },
    method="POST",
)

with urllib.request.urlopen(req) as response:
    print(response.read().decode("utf-8"))
```

The `/connect` page renders this same snippet with your instance URL pre-filled — see [`app/lib/readiness/sdkCheck.mjs`](../app/lib/readiness/sdkCheck.mjs) (`getSdkCommands`).

### Node: live proof via the SDK

```bash
npm install dashclaw
node -e "const { DashClaw } = require('dashclaw'); new DashClaw({ baseUrl: '<base-url>', apiKey: '<api-key>' }).ping().then((r) => console.log(r));"
```

Capture the live proof via the `/setup` "Run test" button, or the Python live-proof snippet above.

---

*If you landed here from a "see `docs/client-setup-guide.md`" reference, the content you were looking for now lives on one of the surfaces in the table above. This file exists as a stable anchor so those references do not 404.*
