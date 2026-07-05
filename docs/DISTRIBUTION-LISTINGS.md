# Distribution listings — runbook + submissions ledger

The repo-side prep for every public listing channel is done (roadmap v2.7);
roadmap v6.2 (2026-07-05) executed the submissions the project's own
credentials can make. Framing update per the charter's outward-acts clause
(MAINTAINER.md, amended 2026-07-05): outward acts are the **maintainer's**
wherever project credentials suffice (GitHub, PR-able registries, web
surfaces), with honest AI authorship and claims-proven-live; the venues that
require Wes's accounts are listed as **accelerants — never gates**.

## Live listings (each verified live 2026-07-05)

| Venue | State | Proof |
|---|---|---|
| npm | `@dashclaw/mcp-server` 2.0.1 (+ `dashclaw`, `@dashclaw/cli`, PyPI `dashclaw`) | `npm view @dashclaw/mcp-server version` |
| Official MCP Registry | `io.github.ucsandman/dashclaw` **active, latest 2.0.1** (published 2026-06-11 via `npm run release:mcp`) | https://registry.modelcontextprotocol.io/v0/servers?search=dashclaw |
| PulseMCP | Listed (auto-ingested from the official registry) | https://www.pulsemcp.com/servers/dashclaw |
| Claude Code plugin marketplace | The repo **is** a marketplace: `/plugin marketplace add ucsandman/DashClaw` → install `dashclaw` | `.claude-plugin/marketplace.json` |
| ClawHub | Platform-intelligence skill published | https://clawhub.ai/@dashclaw |

## Submitted by the maintainer (roadmap v6.2, 2026-07-05)

| Venue | Act | Link / state |
|---|---|---|
| punkpeye/awesome-mcp-servers (~70k★) | PR adding DashClaw to the Security section, agent-PR fast-track opt-in (🤖🤖🤖), AI authorship stated in the body | https://github.com/punkpeye/awesome-mcp-servers/pull/9313 (open) |
| Glama (glama.ai) | `mcp-server/glama.json` added (schema-verified; `maintainers: ["ucsandman"]`) + `mcp-server/Dockerfile` (build + credential-free introspection verified in Docker: `initialize` and `tools/list` answer with no env vars, 33 tools). **PR #9313's bot now requires a Glama listing + score badge to merge** — and Glama's "Add Server" flow is an authenticated web session, so the listing itself is accelerant #3 (below), now the PR's merge-blocker. [Status reply posted on the PR](https://github.com/punkpeye/awesome-mcp-servers/pull/9313#issuecomment-4885818236) with honest authorship; badge gets pushed to the PR branch once the listing exists. | **LIVE — submitted by Wes 2026-07-05 (Add Server, Server tab), approved same day.** Listing + score badge verified live at https://glama.ai/mcp/servers/ucsandman/DashClaw; badge pushed to the PR branch ([comment](https://github.com/punkpeye/awesome-mcp-servers/pull/9313#issuecomment-4885845180)); #9313 now meets both bot requirements, awaiting merge |

## Declined venues, and why (recorded per v6.2 acceptance)

| Venue | Reason |
|---|---|
| Smithery | Publishing requires an interactive web/GitHub-OAuth account session; built for HTTP-reachable/bundled servers, not a bare stdio npm package. |
| Docker MCP Registry | Requires a Dockerfile/built image; our server is stdio-over-npx — authoring a container path just to list is new work the transport doesn't need. |
| mcp.so | No submission mechanism found (auto-crawled directory; `mcp.so/server/dashclaw` = "Project not found", no PR/issue path). Nothing to act on. |
| modelcontextprotocol/servers | Community list frozen; README directs to the official registry, where we are already listed. |
| claude-plugins-official | Anthropic-curated at their discretion; no application path exists. |
| Cline MCP Marketplace | The required attestation ("I have tested that Cline can successfully set up this server") cannot be honestly checked without a Cline environment. Revisit if/when a real Cline install test is run. |
| ccplugins/awesome-claude-code-plugins | Mechanism vendors a plugin *copy* into their repo — a staleness/parity hazard for a fast-moving plugin; no external-marketplace link format exists there; low reach (~870★). |
| hesreallyhim/awesome-claude-code (~48k★) | CONTRIBUTING explicitly requires a **human** submitter via their issue form. The honesty rule forbids faking one — moved to accelerants. |

## Accelerants (Wes's accounts; never gates)

1. **Anthropic community plugin directory** — Console form at
   https://platform.claude.com/plugins/submit (individual-author path; the
   Team/Enterprise path is `claude.ai` admin settings → directory
   submissions). Paste repo URL `https://github.com/ucsandman/DashClaw`;
   run `claude plugin validate` first.
2. **hesreallyhim/awesome-claude-code** — file their issue form as yourself
   (they require a human submitter); highest-reach plugin list (~48k★).
3. **Glama listing (now the merge-blocker for awesome-mcp-servers PR
   #9313)** — sign in at https://glama.ai/mcp/servers → **Add Server**,
   submit `https://github.com/ucsandman/DashClaw`, and when it asks for a
   Dockerfile paste the contents of
   [`mcp-server/Dockerfile`](../mcp-server/Dockerfile) (verified: builds
   and answers MCP introspection with no env vars — their checks only need
   start + introspection). Once the listing at
   `glama.ai/mcp/servers/ucsandman/DashClaw` exists, tell the maintainer —
   the score badge gets pushed to the PR branch and #9313 can merge.
   (`mcp-server/glama.json` already names `ucsandman` as maintainer for
   the claim.)
4. **Anthropic Connectors Directory** (Claude custom connector) — unchanged
   from the v2.7 runbook: needs a Claude.ai **Team/Enterprise** org. The
   instance to list is `hosted.dashclaw.io`; OAuth connector + privacy
   policy are live (`https://hosted.dashclaw.io/api/mcp`,
   `https://hosted.dashclaw.io/privacy`); reviewer test account is
   self-serve via `https://hosted.dashclaw.io/connect` (Turnstile mint,
   30 days / 10,000 actions). Form wants the connector URL, privacy URL,
   the reviewer account, and 3 example prompts (e.g. "list my active
   governance policies", "guard and record this deploy action", "show my
   recent decisions").

## Keeping the official registry current

`npm run release:mcp` (idempotent) re-syncs `mcp-server/server.json`, skips
the npm publish when the version is already up, and pushes the registry
entry via `mcp-publisher` (one-time GitHub device-flow login on first run).
Run it whenever the MCP server version bumps.
**Verify:** the registry search URL above shows the same version as
`npm view @dashclaw/mcp-server version`.

## When any of this drifts

`npm view` the packages against the manifests (standing chore), and re-check
this file's claims whenever the connector, OAuth flow, plugin manifests, or
any listing above changes — it is a description of live behavior, subject to
the same documentation contract as everything else.
