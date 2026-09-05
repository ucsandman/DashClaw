## Tooling Note

The previous `desloppify` integration and mandatory pre-push rule have been disabled.

Reason:

- the external tool is currently unstable in this environment,
- it should not block normal development or commits until it is repaired and reintroduced intentionally.

## Design Context

Before any UI, design, copy, or marketing/visual change, **read `.impeccable.md` at the repo root first**. It is the canonical design context: users, brand personality, aesthetic direction, 4 anti-references, and the 7 tiebreaker principles (evidence over decoration; brand orange as signal not noise; calm under pressure; token-first; developer-reader first; WCAG 2.1 AA floor; four anti-references guardrail). Never hardcode hex values — use the CSS tokens in `app/globals.css` and the Tailwind theme extension.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **DashClaw** (32131 symbols, 63068 relationships, 786 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/DashClaw/context` | Codebase overview, check index freshness |
| `gitnexus://repo/DashClaw/clusters` | All functional areas |
| `gitnexus://repo/DashClaw/processes` | All execution flows |
| `gitnexus://repo/DashClaw/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## DashClaw essentials + agent-log lessons (2026-06-05, for Codex)

The global `~/.codex/AGENTS.md` covers core behavior; these are DashClaw-specific and not otherwise in this file:

- **Before "done", run and READ:** `npm run lint && npm run typecheck && npx vitest run && npx next build` (full vitest — targeted runs miss cross-file regressions). CI also gates `contracts:check`, `openapi:check`, `api:inventory:check`, `route-sql:check`, `version:check`, `version:sync:check`.
- **One shared version** across `package.json`, `sdk/package.json`, `sdk-python/pyproject.toml` — bump with `npm run version:set <x.y.z>`; never hardcode a version (`version:check` fails the build). The version number advances on every ship; **republish the SDKs (`npm run release:sdks`) only when the SDK source actually changed** — a platform-only release bumps the number but leaves npm/PyPI at the last SDK release.
- **No direct SQL in `app/api/**/route.js`** — go through `app/lib/repositories/*.repository.js` (`route-sql:check` blocks regressions).
- **Model/provider drift:** update `app/lib/providers/providerRegistry.ts` and run `npm run pricing:refresh`; verify current model ids before wiring (`gpt-5.x-codex` ids drift and crash the bot).
- **DashClaw MCP env:** only `DASHCLAW_URL` + `DASHCLAW_API_KEY` (+ optional `DASHCLAW_AGENT_ID`); `org_id` is not needed for MCP.
- **Plugin parity:** mirror new capabilities across claude-code / codex / Hermes plugins. Don't cosmetically rename `.jsx`↔`.js`.
- Design changes: read `.impeccable.md` first (see Design Context above).

<!-- REPOWISE_AGENTS:START — Do not edit below this line. Auto-generated by Repowise. -->
## Repowise Codebase Context For DashClaw

This repository is indexed by Repowise. Use the Repowise MCP tools for codebase orientation, discovery, implementation context, modification risk, design rationale, and cleanup planning. MCP data reflects the last index run; verify against source files before editing.

Last indexed: 2026-09-05 (commit 010defdc). Confidence: 100%.
### Architecture
This repository is an agent-governance and documentation platform end-to-end: it ingests code and policy inputs (source files, contracts, and governance/policy configuration), runs an indexing + analysis pipeline (AST/code parsing, dependency/policy checks, and tool-backed MCP operations), and produces governed agent artifacts (SDKs, an MCP server with tools, and example agent workflows) plus developer-facing outputs (web/UI-ready modules and generated documentation surfaces).
### Key Modules
| Module | Purpose | Owner |
|--------|---------|-------|
| `app` | The **app** module is the **React/Next.js front-end layer of repowise’s… | - |
| `__tests__/unit` | The __tests__/unit module is the unit-testing stage of repowise’s generation… | - |
| `app/components` | The **app/components** module is the **UI composition layer** in repowise’s web… | - |
| `app/lib` | The app/lib module is a Core Service Layer support layer in repowise’s backend… | - |
| `application` | The **Application (top-level)** module is the entry-stage orchestration layer… | - |
| `app/api/_archive` | The **api/_archive** module is the **archival API layer** in repowise’s larger… | - |
| `scripts` | The **scripts** module is the **application-layer orchestration toolkit** for… | - |
| `.claude` | The **.claude module** is a **repository intelligence and command-safety… | - |
| `sdk-python` | The **sdk-python (Application)** module is the **application-layer… | - |
| `examples` | The **examples** module is the entry-stage “application-layer” showcase in… | - |
### Entry Points
- `scripts/_db.mjs`
- `mcp-server/server.json`
- `app/lib/notification-adapters/index.ts`
- `scripts/_load-env.mjs`
- `app/lib/demo/demoMiddleware.actions.ts`
- `app/lib/plain-language/index.ts`
- `scripts/living-merge/manifest.ts`
- `app/lib/demo/demoMiddleware.sessions.ts`
- `scripts/lib/run-pre-commit-checks.mjs`
- `livingcode/__main__.py`
### Risk Hotspots
| File | Churn | 90d Commits | Owner |
|------|-------|-------------|-------|
| `public/guides/platform-guide-data.json` | 100.0th percentile | 59 | Wes Sander |
| `mcp-server/lib/routes-inventory.generated.json` | 100.0th percentile | 34 | Wes Sander |
| `docs/maintainer-log.md` | 99.9th percentile | 117 | Wes Sander |
| `app/lib/doctor/generated/last-snapshot.json` | 99.9th percentile | 71 | Wes Sander |
| `app/lib/doctor/generated/shape.json` | 99.9th percentile | 71 | Wes Sander |

### Repowise MCP Workflow

- Overview: call `get_overview()` at the start of an unfamiliar task to orient on architecture, modules, entry points, and tech stack.
- Search: call `search_codebase(query="...")` when locating where a concept, symbol, feature, or behavior is implemented.
- Context: call `get_context(targets=["path/or/symbol", "..."])` for enriched docs, ownership, decisions, callers, and related files before relying on raw source alone.
- Risk: call `get_risk(targets=["path/to/file.py"])` before modifying shared utilities, public APIs, hotspots, high-coupling modules, or files with unknown dependents.
- Why: call `get_why(query="...")` before architectural changes or when the user asks why code is structured a certain way.
- Dead code: call `get_dead_code(safe_only=true)` before cleanup or removal work; treat lower-confidence findings as candidates to investigate.
- Connections: call `get_dependency_path(source="...", target="...")` when tracing how modules connect.
- Diagrams: call `get_architecture_diagram(scope="...")` when a visual structure would clarify the change.

### Commands
- Build: `npm run build`
- Test: `npm run test`
- Lint: `npm run lint`
- Dev: `npm run dev`
- Typecheck: `npm run typecheck`

<!-- REPOWISE_AGENTS:END -->

<!-- >>> dashclaw start — managed block, do not edit by hand -->

## DashClaw Governance Protocol

You are governed by DashClaw. Before any non-trivial action, follow this
protocol so a human reviewer (and the audit log) can trust your work.

### Session start

1. Call `dashclaw_session_start` via the `dashclaw` MCP server with your
   agent id (`codex`) and a one-sentence workspace description. This
   groups all your actions for tracking in Approvals.
2. Read the `dashclaw://policies` MCP resource and call the
   `dashclaw_capabilities_list` tool to learn what rules govern you and
   what capabilities are registered. Treat unknown action types as
   high-risk by default.

### Before each risky action

Call `dashclaw_guard` with the action you intend to take. You will get
back one of four decisions:

- `allow` — proceed; call `dashclaw_record` afterward with the outcome.
- `warn` — proceed with caution; include the warning context in your
  `dashclaw_record` call.
- `block` — stop. Report the block reason to the user and do not attempt
  the action through another path.
- `require_approval` — call `dashclaw_wait_for_approval` and wait. Don't
  poll faster than the tool already does.

Risky actions include: shell commands that write or delete, file edits
outside the project root, network requests, package installs, deploys,
and any external API call you have not used in this session before.

The PreToolUse hook installed by `dashclaw install codex` will guard
Bash, Edit, Write, and MultiEdit automatically. The guidance above is
still required for tool calls that fall outside that matcher (MCP tool
invocations, agent-internal capabilities) so DashClaw's audit trail
covers them too.

### After each action

Call `dashclaw_record` with the action id (from `dashclaw_guard` or from
a PostToolUse-emitted breadcrumb) and the outcome (`success`,
`failure`, or `partial`). This is what makes the decision replayable.

### This instance

DashClaw: https://my-dashclaw.vercel.app

<!-- <<< dashclaw end -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
