# DashClaw in the Claude app — connect guide

Get the **30 governance tools** (`dashclaw_guard`, `dashclaw_record`, …) into the Claude consumer app (web chat / Claude Desktop / Cowork) as a **custom connector**. You paste one URL and authorize once — **no API key in the UI, no env var, no ZIP, no plugin upload.** Claude's connector flow requires OAuth, and your deployed DashClaw instance is now its own OAuth server.

## TL;DR
1. Deploy your DashClaw instance and make sure you can log in to it.
2. Claude → **Settings → Connectors → Add custom connector**.
3. Paste `https://YOUR-INSTANCE.vercel.app/api/mcp`.
4. Click **Connect** → log in to DashClaw → **Authorize** → done.

Works on Free/Pro/Max/Team/Enterprise (Free is capped at one custom connector).

---

## 1. Prerequisites

- A **deployed** DashClaw instance (e.g. `https://my-dashclaw.vercel.app`). Confirm it's up:
  ```bash
  curl.exe https://YOUR-INSTANCE.vercel.app/api/health     # → "status":"healthy"
  ```
- A **login on that instance**. The connector authorizes against your DashClaw session (the account you use at `/login`), not an API key. If you've never logged in, open `https://YOUR-INSTANCE.vercel.app/login` once first.
- Use your instance's **public production domain** (the `*.vercel.app` alias or your custom domain) — not a per-deployment preview URL (those sit behind Vercel deployment protection).

## 2. Add the connector

In Claude:

**Settings → Connectors → Add custom connector** → paste:

```
https://YOUR-INSTANCE.vercel.app/api/mcp
```

→ **Connect**.

What happens next is automatic OAuth (you don't configure any of it):
1. Claude discovers `/.well-known/oauth-protected-resource` and registers itself (Dynamic Client Registration).
2. You're redirected to your DashClaw **login**, then a **consent screen** ("Authorize Claude").
3. Click **Authorize** → you're sent back to Claude with the connection live.

The 30 governance tools now show under the connector, scoped to your workspace and attributed to agent **`claude-desktop`**.

## 3. Test it

In a new chat:

```
Using DashClaw, list my active governance policies and the available capabilities.
```

Returns your policies + capabilities → you're done. Then try the core loop:

```
I'm about to deploy a schema migration to the production billing DB (risk ~70, goal: ship the billing schema). Use DashClaw to guard this action, give me the decision and reasoning, then record it to the audit trail.
```

Check your instance's **`/decisions`** (filter agent `claude-desktop`) to see the governed actions land.

## 4. Remove any old `.mcpb` extension / plugin

If you previously installed the `.mcpb` extension or a uploaded plugin named `dashclaw`, **uninstall it** (Settings → Extensions / Plugins). It collides on the name and the bundled-Node stdio server crash-loops. The URL connector replaces it.

---

## Troubleshooting

- **"Couldn't register with DashClaw's sign-in service" (DCR fails).** You're almost certainly pointed at a protection-walled URL. Use the **public production domain**, and confirm discovery is consistent:
  ```bash
  curl.exe https://YOUR-INSTANCE.vercel.app/.well-known/oauth-protected-resource
  # "resource" and "authorization_servers" must both be your public domain, not a *-<hash>-*.vercel.app preview URL
  ```
- **The Authorize button does nothing.** Reload the consent tab (it must be served by the current deploy) and click again. If it persists, open DevTools → Console; a CSP `form-action` error means the page is stale — reconnect from Claude.
- **Tools appear but calls return errors / HTML.** Re-run the health check; confirm the instance is up. (A past bug where the proxy called the protection-walled deployment URL and got an HTML SSO page is fixed — the callback uses the public production domain.)
- **Tools don't appear at all.** The connection didn't finish OAuth — remove the connector and re-add it by URL.
- **Auth errors right after a deploy or pull.** Usually the instance DB is behind the code — run `npm run db:migrate` against that instance, then reconnect.
- **Never point the connector at the demo deployment** (e.g. `dashclaw.io`). Demo mode rejects writes (`403`) — use your own instance.

## Other integration paths (not the consumer connector)

- **Claude Code / Cowork (stdio via npx):** `claude_desktop_config.json` with `command: npx @dashclaw/mcp-server` + `DASHCLAW_URL`/`DASHCLAW_API_KEY`. Runs on system Node (works in Code/Cowork). See `mcp-server/README.md`.
- **Managed Agents (Streamable HTTP + x-api-key):** `{ type: "url", url: ".../api/mcp", headers: { "x-api-key": "oc_live_…" } }`. The `x-api-key` path is unchanged and coexists with OAuth.
- **DashClaw skills (governance protocol + platform intelligence):** install via the marketplace — Customize → Plugins → Add marketplace → `github: ucsandman/DashClaw`.
