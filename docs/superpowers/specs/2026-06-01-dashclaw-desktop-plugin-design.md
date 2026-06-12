# DashClaw on Claude Desktop — Plugin + OAuth Connector Design Spec

**Date:** 2026-06-01
**Status:** Leg 2 (OAuth) IMPLEMENTED as of 2026-06-02 — full PKCE S256 authorization server at `app/api/oauth/{authorize,token,register}/route.js` + `app/api/oauth/metadata/*` discovery routes + `/api/mcp` `401`/`WWW-Authenticate` challenge in `middleware.js`. Leg 1 (`.mcpb` packaging + `marketplace.json`) still pending. The "only new engineering is OAuth / to-build OAuth" framing below is historical — do not re-scope it as unbuilt.
**Author:** Wes + Claude

## Overview

The Claude consumer app (web chat, the Chat tab in Claude Desktop, and **Cowork** — the agentic desktop mode) shipped a plugin system on **2026-01-30** ("Cowork plugins"). A plugin bundles **Skills + Connectors + sub-agents (+ hooks/commands)** and uses the **identical `.claude-plugin/plugin.json` format as Claude Code** — Anthropic's own knowledge-work plugins install in both Cowork and Claude Code unchanged.

DashClaw already ships most of what a Desktop plugin needs: the `plugins/dashclaw/` tree (a `.claude-plugin/plugin.json`, the `dashclaw-governance` + `dashclaw-platform-intelligence` skills) and a working **remote MCP endpoint at `/api/mcp`** (Streamable HTTP, JSON-RPC 2.0, 32 tools + 6 resources). This spec adds the Claude consumer app as a **fourth distribution target** (alongside Claude Code, Codex, Hermes) in two legs:

- **Leg 1 — dogfood now:** package the existing stdio server as a one-click local connector (`.mcpb`) and add a `marketplace.json` so the existing plugin (the two skills) installs into the app's Customize → Plugins from the GitHub repo. Zero backend change; usable in your own Desktop this week.
- **Leg 2 — public-ready:** add an **OAuth 2.0** authorization layer to `/api/mcp` so DashClaw becomes a paste-the-URL remote connector that works on **every** surface (web chat, Desktop, mobile, Cowork) and is Connectors-Directory-submittable.

### Why

The Desktop surface is the broadest reach DashClaw has — it puts governance one "Add connector" click from any Claude user, and it reuses assets we already own. The two skills carry over for free; the MCP endpoint already exists. The only genuinely new engineering is the OAuth layer (Leg 2), and even that has a foundation: DashClaw already runs **NextAuth** (`app/api/auth/[...nextauth]/route.js`, `app/api/auth/local/route.js`, `/login`) for the dashboard, which supplies the human-login + consent step an OAuth authorization server needs.

### What this is NOT

This stays inside DashClaw's governance boundary: *we govern goals; we do not give agents goal-tools.* The plugin therefore ships **zero third-party connectors** (no Slack/HubSpot/Gmail). It is the **inverse of the Sales plugin**: one *governance* connector + two governance skills that supervise whatever else the user has already connected. This is also not an agent-platform feature — the connector is a governance client, not a capability runtime.

### Verified constraints (the facts that shape the design)

All confirmed against official Anthropic docs (citations at end):

1. **Connector auth is OAuth-or-authless only.** Static API keys, custom headers, and URL tokens are **explicitly prohibited** for custom connectors: *"Tokens or API keys passed in the connector URL … are not supported."* Supported: **OAuth** (`oauth_dcr`, `oauth_cimd`, `oauth_anthropic_creds`), **authless**, or `custom_connection` (email `mcp-review@anthropic.com`). → DashClaw's current static `x-api-key` works for the Managed Agents API but **cannot** be added via the consumer "Add custom connector" UI. This is the entire reason Leg 2 exists.
2. **OAuth specifics:** PKCE `S256` mandatory on every authorization request; authorization-server metadata discovery (RFC 8414 / OIDC); auth detected via `401` + `WWW-Authenticate`; `/token` must accept `application/x-www-form-urlencoded`; hosted callback is `https://claude.ai/api/mcp/auth_callback`. DCR (RFC 7591) is required *unless* you support CIMD.
3. **Transport:** Streamable HTTP required. ✅ already implemented.
4. **Plans & surfaces:** custom connectors work on Free/Pro/Max/Team/Enterprise (**Free = 1 connector**). Plugins are paid-plan features; sub-agents and hooks run **only in Cowork** (paid), not plain chat. **Caveat:** plugin-SCOPE hooks (`hooks/hooks.json`) do **not** load in Cowork (it spawns with `--setting-sources user`; anthropics/claude-code #27398) — only user-scope `~/.claude/settings.json` hooks load, so DashClaw cannot rely on its plugin-bundled hooks firing there.
5. **Plugin format** = `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, same as Claude Code; personal marketplaces are added via Customize → Plugins → "+" → Add marketplace (GitHub repo / git URL).

## Background: the three primitives and where DashClaw already sits

| Primitive | What it is | DashClaw status |
|---|---|---|
| **Skill** | `SKILL.md` folder, same format everywhere | ✅ two skills ship today |
| **Connector (remote)** | Cloud MCP server, URL + **OAuth** | ⚠️ endpoint exists (`/api/mcp`); needs OAuth (Leg 2) |
| **Connector (local)** | `.mcpb` bundle, one-click install | ➕ Leg 1 packages the existing stdio server |
| **Plugin** | bundle of the above (+ marketplace.json) | ⚠️ `plugin.json` exists; needs `marketplace.json` (Leg 1) |

## Leg 1 — Dogfood now (local connector + personal marketplace)

Goal: be governing your own Claude Desktop within the week, no backend change.

### 1a. `.mcpb` bundle of the existing stdio server

The stdio entry (`mcp-server/bin/dashclaw-mcp.js`) already reads `DASHCLAW_URL`, `DASHCLAW_API_KEY`, `DASHCLAW_AGENT_ID`. Wrap it in an `.mcpb` whose `user_config` collects those at install time and injects them into the server env. Build with `@anthropic-ai/mcpb` (`mcpb init` / `mcpb pack`); user installs by double-clicking the `.mcpb`.

**New file — `mcp-server/mcpb/manifest.json`** (verified schema; `manifest_version` `0.3`):

```json
{
  "manifest_version": "0.3",
  "name": "dashclaw",
  "version": "<read from mcp-server/package.json at build time>",
  "description": "Govern agents with guard checks, approvals, and audit trails.",
  "author": { "name": "DashClaw" },
  "server": {
    "type": "node",
    "entry_point": "bin/dashclaw-mcp.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/bin/dashclaw-mcp.js"],
      "env": {
        "DASHCLAW_URL": "${user_config.dashclaw_url}",
        "DASHCLAW_API_KEY": "${user_config.dashclaw_api_key}",
        "DASHCLAW_AGENT_ID": "${user_config.dashclaw_agent_id}"
      }
    }
  },
  "user_config": {
    "dashclaw_url": {
      "type": "string", "title": "DashClaw instance URL",
      "description": "e.g. https://your-dashclaw.vercel.app",
      "required": true
    },
    "dashclaw_api_key": {
      "type": "string", "title": "API key",
      "description": "oc_live_ key from your DashClaw instance",
      "required": true, "sensitive": true
    },
    "dashclaw_agent_id": {
      "type": "string", "title": "Agent ID",
      "description": "Name shown on /fleet and /decisions",
      "required": false, "default": "claude-desktop"
    }
  }
}
```

**New file — `scripts/build-mcpb.mjs`:** stages `mcp-server/` (code + production deps) + the manifest into a temp dir, runs `mcpb pack`, emits `dist/dashclaw.mcpb`. Keeps the bundle reproducible and CI-checkable. (The `version` is read from `mcp-server/package.json` — never hardcode, per the repo's version:check rule.) The manifest itself is **generated by `scripts/lib/build-mcpb-manifest.mjs`** at build time — there is no checked-in `mcp-server/mcpb/manifest.json`; the JSON above is illustrative shape only.

### 1b. `marketplace.json` so the plugin installs via Customize → Plugins

**New file — `.claude-plugin/marketplace.json`** (repo root; verified schema). `dashclaw` is not a reserved marketplace name.

```json
{
  "name": "dashclaw",
  "owner": { "name": "DashClaw", "email": "team@dashclaw.io" },
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [
    {
      "name": "dashclaw",
      "source": "dashclaw",
      "description": "DashClaw governance, integration, and platform intelligence: guard checks, approvals, audit trails.",
      "category": "Developer Tools",
      "tags": ["governance", "mcp", "agent-safety", "approval"]
    }
  ]
}
```

Users add it under Customize → Plugins → "+" → Add marketplace → `github: ucsandman/DashClaw` (public repo). Installing the `dashclaw` plugin surfaces both skills. **Caveat:** GitHub-sync supports relative/`github`/`url`/`git-subdir` sources only (no `npm`/`pip`) — fine here.

### 1c. Open verification (do not assume)

Whether the consumer plugin surface honors a plugin's `.mcp.json` **stdio** (`command: npx`) connector is **not officially documented** (research flagged "unknown which `plugin.json` fields Desktop honors"). So Leg 1 treats the **`.mcpb`** as the *certain* local-connector path and the plugin-`.mcp.json`-stdio route as a "try it, confirm in Cowork" item — not a guarantee. The skills install regardless.

### Leg 1 deliverables

- `mcp-server/mcpb/manifest.json`, `scripts/build-mcpb.mjs`, `dist/dashclaw.mcpb` (gitignored build artifact), `.claude-plugin/marketplace.json`.
- Docs: a "Install in Claude Desktop" section (README + `app/docs`), per the SDK Documentation Checklist.

### Leg 1 verification

1. `node scripts/build-mcpb.mjs` produces `dist/dashclaw.mcpb`; double-click installs; install UI prompts for URL/key/agent-id.
2. In Desktop, a `dashclaw_guard` call returns a decision against your instance; the session shows on `/fleet`.
3. Adding the GitHub marketplace lists the `dashclaw` plugin; installing it shows both skills under Customize → Skills.

## Leg 2 — OAuth 2.0 connector (public-ready, every surface)

Goal: anyone adds `https://<instance>/api/mcp` as a custom connector, authorizes once, and uses the 26 governance tools — on web chat, Desktop, mobile, and Cowork.

### The minimal authorization server

DashClaw becomes a small OAuth 2.1 authorization server in front of the existing MCP resource. New route handlers (Next.js App Router):

| Endpoint | Spec | Purpose |
|---|---|---|
| `app/.well-known/oauth-protected-resource/route.js` | RFC 9728 | Resource metadata; points Claude at the AS. Served for `/api/mcp`. |
| `app/.well-known/oauth-authorization-server/route.js` | RFC 8414 | AS metadata: `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported`, scopes. |
| `app/api/oauth/register/route.js` | RFC 7591 (DCR) | Anthropic dynamically registers a client. **Recommended path.** |
| `app/api/oauth/authorize/route.js` | OAuth 2.1 + PKCE | Requires a logged-in DashClaw user (reuse NextAuth session; redirect to `/login` if absent) → consent screen → issues auth code bound to {workspace, PKCE challenge, redirect_uri}. |
| `app/api/oauth/token/route.js` | OAuth 2.1 | `application/x-www-form-urlencoded`; verifies PKCE `S256`; exchanges code → access token (+ refresh token). |

**Change to `app/api/mcp/route.js`:** when the request has no valid `Authorization: Bearer` (and no legacy `x-api-key`), return **`401` + `WWW-Authenticate`** pointing to the protected-resource metadata. When a valid Bearer is present, resolve it → workspace and proceed. **The existing `x-api-key` path is kept** for Managed Agents back-compat.

### Token + identity model

- **Access token:** opaque, DB-backed, resolving to a workspace — mirrors the current `oc_live_` resolution so middleware changes are minimal. (Alternative: signed JWT verified via the existing JWKS infra at `app/api/integrity/jwks` — stateless but heavier; deferred unless we want it.) Middleware accepts `Authorization: Bearer <token>` in addition to `x-api-key`.
- **Workspace identity:** comes from the NextAuth user who authorized during `/authorize` — so each connected user maps to a real workspace, server-side. This **replaces the static `--agent-id` flag** and closes the "actions mis-attributed to a static `agent_id`" gap noted in project memory: identity is the OAuth connection, not a launch arg. A human-readable `agent_id` (default `claude-desktop`, or derived from MCP `clientInfo.name` as the stdio server already does) is still recorded for dashboard readability.
- **Refresh tokens + revocation:** standard refresh grant; a "Connected apps" view (operator can revoke a connection) — reuses existing dashboard surfaces.

### Directory-readiness (only if we pursue listing)

The Connectors Directory review wants **read vs write tools split** and **tool annotations** (`title`, `readOnlyHint`/`destructiveHint`). DashClaw's tools already cleave naturally: read (`dashclaw_guard`, `dashclaw_policies_list`, `dashclaw_capabilities_list`, `dashclaw_wait_for_approval`, the `_list`/`_query`/`resources`) vs write (`dashclaw_record`, `dashclaw_invoke`, `dashclaw_session_*`, `dashclaw_loop_*`, `dashclaw_secret_mark_rotated`). Add OAuth scopes `governance:read` / `governance:write` and annotate destructive tools. **This is prep, not required for self-hosted distribution.**

### Leg 2 verification

1. **MCP Inspector / "Add custom connector":** paste `https://<instance>/api/mcp` → 401+`WWW-Authenticate` triggers the OAuth dance → login + consent → tools list + a `dashclaw_guard` call succeed.
2. Unauthorized request returns a spec-correct `401`; metadata docs validate against RFC 8414/9728.
3. `npx vitest run` (full suite) + `npx next build` green; new tests for the OAuth endpoints, PKCE verification, and Bearer resolution.

## Distribution summary

1. **Self-host (Primary, no Anthropic involvement):** users add the instance URL → OAuth. No review.
2. **Personal/GitHub marketplace (Leg 1b):** the skills plugin, added by GitHub URL.
3. **Connectors Directory (optional, later):** free submission, real review bar, **plus** governance-specific risk — review rejects descriptions that "instruct Claude to call software the user didn't request," which a tool whose purpose is to *gate other tools* could trip. **Self-hosting sidesteps it.** Decide after Legs 1–2 land.

## Caveats / non-goals (decided consciously)

- **Advisory vs enforced.** On plain chat surfaces DashClaw governance is **advisory** (a cooperating Claude follows the skill's guard/record/wait protocol). Hard enforcement via hooks is **confirmed only in Claude Code (CLI)**. Cowork runs the CLI in a local Linux VM, so a `PreToolUse` deny *could* hard-block in principle — but it's **UNVERIFIED**: plugin-bundled hooks don't load in Cowork (it spawns with `--setting-sources user`; anthropics/claude-code #27398), only user-scope `~/.claude/settings.json` hooks load, and the network-allowlisted ARM64 VM makes an HTTP guard hook **fail-open** unless the instance domain is allowlisted. Treat Cowork hard enforcement as possible-but-unverified, **not shipped**. Plain web/Desktop chat has **no hooks** (advisory via connector + skill). The connector still delivers real audit trails + approval prompts everywhere; we are not claiming hard blocks on web chat.
- **Free-tier reach.** Custom connectors: Free = 1. Plugins: paid plans. We don't gate our own value on Free.
- **No third-party connectors bundled** (governance boundary).

## Decisions (locked 2026-06-01)

1. **OAuth client model:** **DCR** (RFC 7591) now. CIMD deferred (add later only if useful).
2. **Token format:** **Opaque, DB-backed**, resolving to a workspace — reuses the existing api-key resolution path; minimal middleware change. (JWT-via-JWKS rejected for now.)
3. **Legacy `x-api-key` on `/api/mcp`:** **Kept** — Managed Agents depends on it. New Bearer path is additive.
4. **`.mcpb` `DASHCLAW_URL` default:** **Blank** — the open-source bundle prompts the user for their own instance.
5. **Connectors Directory listing:** **Deferred** — ship self-hosted (OAuth) first; revisit after Legs 1–2 land, weighing the gates-other-tools review risk.

## Build sequence (high level; writing-plans will detail)

1. Leg 1a `.mcpb` (manifest + build script) → install + smoke test.
2. Leg 1b `marketplace.json` + docs → GitHub-marketplace install test.
3. Leg 2 AS endpoints + metadata (DCR, authorize, token, well-known).
4. Leg 2 `/api/mcp` 401+Bearer + middleware Bearer resolution + token store (schema/migration).
5. Tests (PKCE, Bearer, OAuth happy/again paths) + `next build` + docs/inventory regen.
6. (Optional) directory-readiness: read/write scopes + tool annotations.

Auth-touching work (steps 3–4) lands behind the existing migration discipline (`npm run db:migrate` after the token-store schema change) and gets its own review before merge.

## Citations

- Connector auth (the ban on static keys/headers/URL tokens; OAuth/authless/custom_connection; PKCE S256; DCR/CIMD; callback): https://claude.com/docs/connectors/building/authentication
- Building remote MCP servers (Streamable HTTP; callback URL): https://claude.com/docs/connectors/building
- Custom connectors, plans, Free=1: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- `.mcpb` manifest + `user_config` + CLI + install: https://claude.com/docs/connectors/building/mcpb and https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
- Plugins in the Claude apps (surfaces; hooks/sub-agents Cowork-only; personal marketplaces): https://support.claude.com/en/articles/13837440-use-plugins-in-claude
- Plugin manifest + marketplace.json schema (shared with Claude Code): https://code.claude.com/docs/en/plugins-reference and https://code.claude.com/docs/en/plugin-marketplaces
- Cowork plugins launch (2026-01-30; same format as Claude Code): https://claude.com/blog/cowork-plugins and https://github.com/anthropics/knowledge-work-plugins
- Skills "build once, use everywhere": https://claude.com/blog/skills and https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Connectors Directory review criteria (read/write split; external-instruction rejection): https://claude.com/docs/connectors/building/submission and https://claude.com/docs/connectors/building/review-criteria
