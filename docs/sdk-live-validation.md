# SDK Live Validation

The live SDK validation suites run the Node.js and Python SDKs against a real DashClaw instance, verifying that every SDK method correctly persists and returns data through the actual API layer.

## What it does

- Calls every SDK category (actions, loops, assumptions, signals, dashboard data, handoffs, context threads, snippets, preferences, digest, security scanning, messaging, guard, webhooks, bulk sync)
- Creates real records, reads them back, and asserts field-level correctness
- Node suite also tests the `sendDirectMessage` wrapper and message type enforcement
- Python suite covers the same core categories with Python-native SDK calls

**Both suites perform real writes.** They create test records (prefixed with `sdk-live-test` / `sdk-live-test-py`) in the target instance. Run against development or staging instances, not production, unless you are comfortable with test data in your org.

### Agent signing

Both suites automatically handle agent identity signing. At startup each:

1. Generates an ephemeral RSA-2048 keypair (in-memory, not persisted)
2. Registers the public key via the SDK pairing flow
3. Approves the pairing via the admin API (using the same API key)
4. Configures the SDK client with the private key so all `createAction` calls are signed

This means **no pre-provisioned keys are needed** — both suites work against instances with `ENFORCE_AGENT_SIGNATURES=true` (the production default). The API key must have admin role for the auto-approve step.

Python signing requires the `cryptography` package (`pip install cryptography`). If it is not installed, the suite falls back to an unsigned client and warns — actions will fail if the target instance enforces signatures.

## When to run

- **Before publishing a new SDK version** — validates that the SDK and API are in sync
- **After API route changes** — catches field-mapping regressions the offline contract harness cannot detect
- **After database migrations** — confirms the persistence layer still matches SDK expectations
- **During SDK development** — quick feedback loop against a local instance

## Required environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DASHCLAW_API_KEY` | Yes | — | API key for the target instance |
| `DASHCLAW_URL` | No | `http://localhost:3000` | Base URL of the DashClaw instance |
| `DASHCLAW_AGENT_ID` | No | `sdk-live-test-agent` (Node) / `sdk-live-test-agent-py` (Python) | Agent ID for test records |

> Naming note: this internal harness reads `DASHCLAW_URL` (the same variable the MCP server uses), and the scripts genuinely read that name — this is intentional, not drift. The public onboarding surfaces (`/connect`, `/self-host`, SDK hooks) teach `DASHCLAW_BASE_URL`. If you arrived here from those docs, set `DASHCLAW_URL` for these scripts.

## Running locally

### Node SDK

Against a local instance (reads credentials from `.env.local`):

```bash
npm run sdk:live
```

Against a hosted instance:

```bash
DASHCLAW_URL=https://staging.example.com \
  DASHCLAW_API_KEY=oc_live_xxx \
  node scripts/test-sdk-live.mjs
```

### Python SDK

Against a local instance (reads credentials from `.env.local`):

```bash
npm run sdk:live:python
```

Against a hosted instance:

```bash
DASHCLAW_URL=https://staging.example.com \
  DASHCLAW_API_KEY=oc_live_xxx \
  PYTHONPATH=sdk-python \
  python scripts/test-sdk-live-python.py
```

### Both SDKs

```bash
npm run sdk:live && npm run sdk:live:python
```

## Output

Both suites print a category-by-category pass/fail report, then a summary:

- **Category-level errors** — the entire category failed (connectivity, missing endpoint, schema issue). These are not field-mapping bugs.
- **Failed assertions** — individual field-mapping or value mismatches within a category that otherwise responded.

Exit code is `0` on full pass, `1` on any failure.

## Relationship to other test suites

| Script | What it tests | Requires live instance |
|--------|--------------|----------------------|
| `npm run sdk:integration` | Node SDK request shape matches contract fixture (offline) | No |
| `npm run sdk:integration:python` | Python SDK contract fixture (offline) | No |
| `npm run sdk:live` | Node SDK + API + DB round-trip field-mapping (live) | Yes |
| `npm run sdk:live:python` | Python SDK + API + DB round-trip field-mapping (live) | Yes |

The offline suites catch SDK-side regressions without infrastructure. The live suites catch API-side and DB-side regressions that only appear when data flows through the full stack.

## CI integration

Neither suite is wired into the default PR CI pipeline because they require live credentials and a running instance. To run them in CI, use the manual GitHub Actions workflow:

```
Actions -> "SDK Live Validation" -> Run workflow
```

The workflow runs both Node and Python suites in parallel. It requires `DASHCLAW_URL` and `DASHCLAW_API_KEY` configured as repository secrets. See `.github/workflows/sdk-live.yml`.

## Python-specific notes

- **Dependency:** `cryptography` is needed for signed-agent support. Install with `pip install cryptography`. Without it, the suite runs unsigned (and will fail if the target instance enforces signatures).
- **Python version:** 3.7+ (matches the SDK requirement).
- **No pip install needed for the SDK itself** — the runner sets `PYTHONPATH` to `sdk-python/` so it imports directly from the repo.
