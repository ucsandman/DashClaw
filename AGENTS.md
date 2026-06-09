## Tooling Note

The previous `desloppify` integration and mandatory pre-push rule have been disabled.

Reason:

- the external tool is currently unstable in this environment,
- it should not block normal development or commits until it is repaired and reintroduced intentionally.

## Design Context

Before any UI, design, copy, or marketing/visual change, **read `.impeccable.md` at the repo root first**. It is the canonical design context: users, brand personality, aesthetic direction, 4 anti-references, and the 7 tiebreaker principles (evidence over decoration; brand orange as signal not noise; calm under pressure; token-first; developer-reader first; WCAG 2.1 AA floor; four anti-references guardrail). Never hardcode hex values — use the CSS tokens in `app/globals.css` and the Tailwind theme extension.

<!-- gitnexus:start -->
# GitNexus - Code Intelligence

This project is indexed by GitNexus as **DashClaw** (4346 symbols, 12924 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol - callers, callees, which execution flows it participates in - use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` - find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` - see all callers, callees, and process participation
3. `READ gitnexus://repo/DashClaw/process/{processName}` - trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` - see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview - graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace - use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK - direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED - indirect deps | Should test |
| d=3 | MAY NEED TESTING - transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/DashClaw/context` | Codebase overview, check index freshness |
| `gitnexus://repo/DashClaw/clusters` | All functional areas |
| `gitnexus://repo/DashClaw/processes` | All execution flows |
| `gitnexus://repo/DashClaw/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->

## DashClaw essentials + agent-log lessons (2026-06-05, for Codex)

The global `~/.codex/AGENTS.md` covers core behavior; these are DashClaw-specific and not otherwise in this file:

- **Before "done", run and READ:** `npm run lint && npm run typecheck && npx vitest run && npx next build` (full vitest — targeted runs miss cross-file regressions). CI also gates `contracts:check`, `openapi:check`, `api:inventory:check`, `route-sql:check`, `version:check`, `version:sync:check`.
- **One shared version** across `package.json`, `sdk/package.json`, `sdk-python/pyproject.toml` — bump with `npm run version:set <x.y.z>`; never hardcode a version (`version:check` fails the build). The version number advances on every ship; **republish the SDKs (`npm run release:sdks`) only when the SDK source actually changed** — a platform-only release bumps the number but leaves npm/PyPI at the last SDK release.
- **No direct SQL in `app/api/**/route.js`** — go through `app/lib/repositories/*.repository.js` (`route-sql:check` blocks regressions).
- **Model/provider drift:** update `app/lib/providers/providerRegistry.js` and run `npm run pricing:refresh`; verify current model ids before wiring (`gpt-5.x-codex` ids drift and crash the bot).
- **DashClaw MCP env:** only `DASHCLAW_URL` + `DASHCLAW_API_KEY` (+ optional `DASHCLAW_AGENT_ID`); `org_id` is not needed for MCP.
- **Plugin parity:** mirror new capabilities across claude-code / codex / Hermes plugins. Don't cosmetically rename `.jsx`↔`.js`.
- Design changes: read `.impeccable.md` first (see Design Context above).

<!-- REPOWISE_AGENTS:START — Do not edit below this line. Auto-generated by Repowise. -->
## Repowise Codebase Context For DashClaw

This repository is indexed by Repowise. Use the Repowise MCP tools for codebase orientation, discovery, implementation context, modification risk, design rationale, and cleanup planning. MCP data reflects the last index run; verify against source files before editing.

Last indexed: 2026-06-09 (commit 2c1e7c5c). Confidence: 100%.
### Architecture
repo is an agent-governance documentation and tooling monorepo that ingests repository content (source files, contracts, and policy/rules definitions), transforms it through governance-aware analysis and indexing, and outputs generated agent-ready artifacts—LLM-facing SDKs, an MCP server interface, and example governed agent workflows.
### Key Modules
| Module | Purpose | Owner |
|--------|---------|-------|
| `app` | The **app** module is the **front-end application-layer entry** of repowise’s… | - |
| `__tests__/unit` | The __tests__/unit module is the unit-testing subsystem in repowise’s larger… | - |
| `app/components` | The app/components module is the UI component layer of repowise’s web… | - |
| `app/lib` | The app/lib module is the core service layer for repowise’s indexing/guarding… | - |
| `application` | The **Application (top-level)** subsystem is the entry-stage web/SDK… | - |
| `app/api/_archive` | The **api/_archive** module is the **archival API layer** in repowise’s larger… | - |
| `scripts` | The **scripts** module is the **application-layer orchestration toolkit** for… | - |
| `.claude` | The **.claude module** is a **repository intelligence and command-safety… | - |
| `sdk-python` | The **sdk-python (Application)** module is the **application-layer… | - |
| `examples` | The **examples** module is the entry-stage “application-layer” showcase in… | - |
### Entry Points
- `scripts/_db.mjs`
- `app/lib/notification-adapters/index.ts`
- `mcp-server/lib/server.js`
- `scripts/_load-env.mjs`
- `scripts/living-merge/manifest.ts`
- `app/lib/claude-code/rules/index.ts`
- `scripts/lib/run-pre-commit-checks.mjs`
- `livingcode/__main__.py`
- `scripts/lib/startup-smoke.mjs`
- `scripts/lib/contracts/load-contracts.mjs`
### Risk Hotspots
| File | Churn | 90d Commits | Owner |
|------|-------|-------------|-------|
| `app/lib/doctor/generated/shape.json` | 100.0th percentile | 65 | Wes Sander |
| `app/lib/doctor/generated/last-snapshot.json` | 99.9th percentile | 65 | Wes Sander |
| `public/livingcode/index.html` | 99.9th percentile | 68 | Wes Sander |
| `app/lib/readiness.mjs` | 99.8th percentile | 10 | Wes Sander |
| `hooks/dashclaw_agent_intel/behavior_recorder.py` | 99.8th percentile | 6 | Wes Sander |

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
