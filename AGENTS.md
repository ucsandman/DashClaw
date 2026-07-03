## Tooling Note

The previous `desloppify` integration and mandatory pre-push rule have been disabled.

Reason:

- the external tool is currently unstable in this environment,
- it should not block normal development or commits until it is repaired and reintroduced intentionally.

## Design Context

Before any UI, design, copy, or marketing/visual change, **read `.impeccable.md` at the repo root first**. It is the canonical design context: users, brand personality, aesthetic direction, 4 anti-references, and the 7 tiebreaker principles (evidence over decoration; brand orange as signal not noise; calm under pressure; token-first; developer-reader first; WCAG 2.1 AA floor; four anti-references guardrail). Never hardcode hex values — use the CSS tokens in `app/globals.css` and the Tailwind theme extension.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **DashClaw** (25838 symbols, 51848 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/DashClaw/context` | Codebase overview, check index freshness |
| `gitnexus://repo/DashClaw/clusters` | All functional areas |
| `gitnexus://repo/DashClaw/processes` | All execution flows |
| `gitnexus://repo/DashClaw/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

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

Last indexed: 2026-07-03 (commit ec534cfe). Confidence: 100%.
### Architecture
This repository is a governed codebase documentation and agent platform: it ingests a target repository (source files, configs, and optional contracts), traverses and parses content into structured representations (ASTs/metadata), analyzes relationships and policies, and then generates LLM-synthesised wiki/artifact outputs served via an MCP server and a web UI, with supporting SDKs and example governed agents. ---
**Purpose:** ensure generated documentation and agent actions comply with configured constraints and contract requirements. **Purpose:** provide a consistent way to fetch repository content, store intermediate representations, and retrieve generated artifacts. **Purpose:** detect and correct issues in ingestion/normalization so downstream parsing and wiki generation remain stable.
### Key Modules
| Module | Purpose | Owner |
|--------|---------|-------|
| `app` | The **app** module is the **public-facing application-layer front door** for… | - |
| `__tests__/unit` | The __tests__/unit module is the unit-testing entry stage of repowise’s quality… | - |
| `app/components` | The app/components module is the UI component layer of repowise’s web… | - |
| `app/lib` | The app/lib module is the core service-layer “brain” of repowise’s policy… | - |
| `application` | The **Application (top-level)** module is the entry-stage web application layer… | - |
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
- `scripts/living-merge/manifest.ts`
- `mcp-server/test/helpers.ts`
- `app/lib/claude-code/rules/index.ts`
- `scripts/lib/run-pre-commit-checks.mjs`
- `mcp-server/src/launch/index.ts`
- `livingcode/__main__.py`
### Risk Hotspots
| File | Churn | 90d Commits | Owner |
|------|-------|-------------|-------|
| `package-lock.json` | 100.0th percentile | 72 | Wes Sander |
| `app/lib/guard.ts` | 100.0th percentile | 22 | Wes Sander |
| `app/lib/doctor/generated/last-snapshot.json` | 99.9th percentile | 66 | Wes Sander |
| `app/lib/doctor/generated/shape.json` | 99.9th percentile | 66 | Wes Sander |
| `public/livingcode/index.html` | 99.8th percentile | 69 | Wes Sander |

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
