---
source-of-truth: false
owner: maintainers
last-verified: 2026-06-01
doc-type: handoff
---

# DashClaw (v2 Governance Runtime)

DashClaw is AI agent decision infrastructure: a focused control plane for policy enforcement, decision recording, assumption tracking, and risk signals.

## Governance boundary

DashClaw is a **minimal governance runtime, not an agent platform**. We do not give agents tools to achieve goals (Calendar, Messaging, CRM); we provide the infrastructure to **govern** those goals.

- **Core runtime**: `app/api/` (governance routes).
- **Archived**: `app/api/_archive/` (legacy platform features; do not extend).

## Where to look first

Read these for depth instead of duplicating them here:

- `PROJECT_DETAILS.md` - canonical system map and boundary rules.
- `QUICK-START.md` - the 8-minute "first governed action" path.
- `docs/architecture/runtime-api.md` - the 4-step governance loop.
- `sdk/README.md` - Node SDK surface and error handling.

## Essential surfaces

- `/mission-control` - fleet posture, interventions, live decision stream.
- `/decisions` - causal-chain ledger of every governed action.
- `/setup` - readiness verification and instance health.
- `/connect` - onboarding to the first governed action.

## Tech stack

- Node 20+, Next.js 16 (App Router), Postgres (Neon recommended).
- Versions live in their manifests (`package.json`, `sdk/package.json`, `sdk-python/pyproject.toml`, `plugins/dashclaw/.claude-plugin/plugin.json`) and are injected into UI strings via `next.config.js`. **Never hardcode a version number in this file** - `npm run version:check` fails the build if you do. The platform and both SDKs (`package.json`, `sdk/package.json`, `sdk-python/pyproject.toml`) share **one version** - bump them together with `npm run version:set <x.y.z>`, enforced by `npm run version:sync:check` (the `plugin.json` bundle keeps its own version). A DEPRECATED `dashclaw/legacy` SDK subpath exists for older integrations (removed in v5.0.0; see `docs/sdk-parity.md`).

## Commands

```bash
npm run dev          # local dev server (port 3000)
npm run lint         # eslint
npm run db:migrate   # apply pending schema to local DB (auto-loads .env.local; idempotent)
```

## Verify before you commit

CLAUDE.md is advisory; CI is not. A push is its own step - run these and READ the output first:

- `npm run lint`
- `npx vitest run` - the **full** suite (targeted runs miss regressions in unrelated files)
- `npx next build` - required for any change under `app/**`
- For any changed `.ts` file (even outside `app/`), run `npm run typecheck` before pushing - vitest transpiles without type-checking and will pass; the build runs `tsc` and will not.

CI also gates `openapi:check`, `api:inventory:check`, `route-sql:check`, and `version:check`. The pre-commit hook regenerates the doc/contract/livingcode artifacts for you (see "Generated artifacts").

## Gotchas (what you can't infer from the code)

- **After pulling changes that touch `schema/schema.js` or `drizzle/*.sql`, run `npm run db:migrate`.** Otherwise your local DB stays on the old schema while middleware/routes expect new columns; the SQL fails silently, `resolveApiKey` returns null, and **every authenticated request 401s with "Invalid or missing API key."** Confusing symptom, one-command fix.
- **No direct SQL in route files.** `app/api/**/route.js` must go through repositories (`app/lib/repositories/*.repository.js`); `npm run route-sql:check` blocks any increase in per-file direct SQL. Repositories are exempt.
- **`.gitattributes` drifts silently.** living-merge install + CRLF normalization leave `.gitattributes` modified-but-unstaged, which silently blocks `git pull --rebase`, `git push`, and worktree ops. Before those, run `git status` and either `git add .gitattributes && git commit` or `git checkout -- .gitattributes` if the diff is LF/whitespace-only. Starting a session with `M .gitattributes` is the norm here, not an anomaly.
- **Documented counts drift from code.** When adding any capability that affects a cited count (route, MCP tool/resource, SDK method, guard policy, shield), grep the old count across `README.md`, `PROJECT_DETAILS.md`, `docs/`, and spec files and update it in the same commit. `scripts/check-doc-counts.mjs --strict` is authoritative — run it before committing, not just at the push gate.

## Generated artifacts - never edit by hand

`app/lib/doctor/generated/`, `public/livingcode/index.html`, and `public/downloads/dashclaw-platform-intelligence/` (plus its `.zip`/`.manifest`) are produced by `npm run livingcode:refresh`. The pre-commit hook runs it automatically when staged changes touch `app/api/`, `app/lib/`, `schema/schema.js`, `middleware.js`, or `livingcode/`, and stages the result. **Editing these by hand is pointless - the next refresh overwrites it.** Regenerate instead. (`python -m livingcode start` does a one-shot refresh and opens the `/livingcode/` dashboard.)

## Design changes

Before any UI, copy, or visual change, **read `.impeccable.md` at the repo root** - the canonical design context (users, brand, aesthetic, 4 anti-references, 7 tiebreaker principles). **Never hardcode hex values**; use the CSS tokens in `app/globals.css` and the Tailwind theme. A `UserPromptSubmit` hook (`.claude/hooks/impeccable-reminder.py`) nudges you when design keywords appear, but the rule holds either way.

## Lessons from agent-log review (2026-06-05)

DashClaw-specific gaps surfaced from my agent history (most generic rules are already enforced above or by the `.claude/hooks` guards):

- **Model/provider drift, not just version drift.** When supported models change, update `app/lib/providers/providerRegistry.ts` (and the model-strategy catalogs) and run `npm run pricing:refresh` — never hardcode model ids or prices. Verify current ids (Context7/web) before wiring them; "Opus 4.6 is out" / "Unknown model: gpt-5.3-codex" has bitten me repeatedly. Latest Opus is 4.8 (2026-06).
- **Don't cosmetically rename `.jsx`↔`.js`** (e.g. keep `app/connect/page.jsx`). It churns diffs for zero behavior change.
- **DashClaw MCP server needs only `DASHCLAW_URL` + `DASHCLAW_API_KEY`** (optionally `DASHCLAW_AGENT_ID`). `org_id` is **not** required for MCP — don't add it.
- **Maintain plugin parity across runtimes.** When you add a capability to the Claude Code plugin, mirror it for Codex and **Hermes** (`plugins/`); those parity gaps have been flagged.
- **On PR/spec reviews, trust only what you read** — don't pass an implementer's or sub-agent's "it works" through; re-verify against the actual code/tests.
- **Token/cache discipline — the whales live here.** This repo is where my biggest context burns happen (multi-hundred-turn Opus sessions at >300K context/turn). The global CLAUDE.md "Token & cache discipline" applies; in this repo especially: explore via **GitNexus queries + sub-agents** instead of broad file reads, `/clear` between unrelated tasks, route reviews/exploration to Sonnet/Haiku, and keep build/test logs out of the thread (read only the failures).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **DashClaw** (21075 symbols, 41081 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

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
