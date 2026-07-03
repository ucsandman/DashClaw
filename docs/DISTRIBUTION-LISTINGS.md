# Distribution listings — submission runbook

The repo-side prep for every public listing channel is done (roadmap v2.7).
This runbook is the remaining **human** work: each channel is one action for
the maintainer. Nothing here is automated on purpose — outward-facing
publication stays a human click (MAINTAINER.md §4 spirit).

Status legend: what the repo guarantees is ready vs. the single step you take.

## 1. Claude Code plugin marketplace — already live, optional directory submission

- **Ready:** `.claude-plugin/marketplace.json` (repo root) + `plugins/dashclaw/.claude-plugin/plugin.json`
  are valid; anyone can install today with
  `/plugin marketplace add ucsandman/DashClaw` → install `dashclaw`.
- **Your step (optional, for Anthropic's curated community directory):**
  open https://clau.de/plugin-directory-submission and paste the repo URL
  `https://github.com/ucsandman/DashClaw`. That's the whole submission.

## 2. Official MCP Registry (registry.modelcontextprotocol.io)

- **Ready:** `mcp-server/server.json` + `mcp-server/package.json` agree
  (`io.github.ucsandman/dashclaw`); npm has the current version published.
  The registry lags npm whenever a release skips the registry-publish tail.
- **Your step:** from the repo root run

  ```bash
  npm run release:mcp
  ```

  It is idempotent — it re-syncs `server.json`, skips the npm publish if the
  version is already on npm, and pushes the registry entry via `mcp-publisher`
  (first run may prompt a one-time GitHub device-flow login).
- **Verify:** https://registry.modelcontextprotocol.io/v0/servers?search=io.github.ucsandman/dashclaw
  shows the same version as `npm view @dashclaw/mcp-server version`.

## 3. Anthropic Connectors Directory (Claude custom connector)

- **Ready:** the OAuth connector itself (remote Streamable HTTP + OAuth 2.1
  DCR/PKCE at `/api/mcp`) is shipped and verified end-to-end; the public
  privacy policy — an immediate-rejection item when missing — is live at
  `https://<instance>/privacy` (linked from every public page footer).
  Example prompts for the submission form can be lifted from
  `docs/CLAUDE-DESKTOP-PLUGIN.md`.
- **Prerequisites you must hold (not repo work):**
  1. A Claude.ai **Team or Enterprise** org (submission is gated on it).
  2. A **reviewer test account** on the hosted instance with sample data —
     mint a trial workspace, run one governed action so /decisions isn't
     empty, and note the credentials for the form.
- **Your step:** in Claude.ai admin settings, open the connector submission
  portal and fill the form: connector URL `https://<instance>/api/mcp`,
  privacy policy `https://<instance>/privacy`, the reviewer account, and
  3 example prompts (e.g. "list my active governance policies",
  "guard and record this deploy action", "show my recent decisions").

## When any of this drifts

`npm view` the packages against the manifests (standing chore), and re-check
this file's claims whenever the connector, OAuth flow, or plugin manifests
change — it is a description of live behavior, subject to the same
documentation contract as everything else.
