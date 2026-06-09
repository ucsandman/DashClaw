# Production Readiness Baseline

**Last measured:** 2026-06-08 20:47 America/New_York
**Run evidence:** `.supergoal/take-this-codebase-and-make-it-productio-EYkzo5/evidence/phase-1/`
**Baseline commit:** `39d4aab70e54dfb3a84aaacf12d74a62a096300c`

## Gate Summary

| Gate | Command | Exit | Evidence |
|---|---|---:|---|
| Git state | `git status --short --branch` | 0 | `01-git-status.log` |
| Shape summary | `python -m livingcode query summary` | 0 | `02-livingcode-summary.log` |
| Env inventory | `python -m livingcode query env` | 0 | `03-livingcode-env.log` |
| Route inventory | `python -m livingcode query routes` | 0 | `04-livingcode-routes.log` |
| Lint | `npm run lint` | 0 | `05-npm-lint.log` |
| Typecheck | `npm run typecheck` | 0 | `06-npm-typecheck.log` |
| Full unit suite | `npx vitest run` | 0 | `07-vitest-full.log` |
| Production build | `npm run build` | 0 | `08-npm-build.log` |
| Contracts | `npm run contracts:check` | 0 | `09-contracts-check.log` |
| Docs | `npm run docs:check` | 0 | `10-docs-check.log` |
| OpenAPI drift | `npm run openapi:check` | 0 | `11-openapi-check.log` |
| API inventory drift | `npm run api:inventory:check` | 0 | `12-api-inventory-check.log` |
| Route SQL guard | `npm run route-sql:check` | 0 | `13-route-sql-check.log` |
| Version hardcodes | `npm run version:check` | 0 | `14-version-check.log` |
| Version sync | `npm run version:sync:check` | 0 | `15-version-sync-check.log` |
| Script syntax | `npm run scripts:check-syntax` | 0 | `16-scripts-check-syntax.log` |
| Playwright smoke | `npm run test:smoke` | 0 | `17-test-smoke.log` |
| Production dependency audit | `npm audit --omit=dev --audit-level=moderate` | 0 | `18-npm-audit-prod.log` |
| Aggregate launch gate | `npm run production:check` | 0 | `19-production-check.log` |

`npm run production:check` now aggregates the launch gate that excludes read-only reconnaissance commands. It fails on the first red gate and preserves each underlying command's output.

## Current Shape

| Area | Baseline |
|---|---|
| Routes | 254 active, 48 archived |
| Env vars | 4 required, 140 optional, 139 marked undocumented by live scanner |
| Tables | 93 |
| API inventory | 301 documented entries in planning recon: 51 stable, 24 beta, 226 experimental |
| Smoke coverage | Playwright smoke passed against the configured public/dashboard page set |
| Production audit | `npm audit --omit=dev --audit-level=moderate` passed |

## Readiness Matrix

| Status | Finding | Owner phase | Evidence command | Launch blocker |
|---|---|---|---|---|
| Green | Core engineering gate is clean: lint, typecheck, full vitest, build, contracts, docs, OpenAPI, API inventory, route SQL, version checks, script syntax, smoke, and production audit all pass. | Phase 8 | Phase 1 command summary; re-run `npm run production:check` before launch | No |
| Yellow | Working tree started dirty with pre-existing changes across agent skills, MCP config, startup smoke, doctor CLI, package scripts, smoke pages, generated skill directories, and media artifacts. Do not revert unrelated changes; final launch review must separate run changes from pre-existing work. | Phase 8 | `git status --short --branch` | No, if scope is reviewed before handoff |
| Yellow | Live env scanner reports 139 optional vars as undocumented even though many appear in `.env.example`; this is source-of-truth classification drift. | Phase 3 | `python -m livingcode query env` | Yes for self-host trust if not reconciled |
| Yellow | API surface is large and mostly experimental, with 254 active routes and 226 experimental inventory entries in planning recon. Stable/beta/public claims need careful route and contract review. | Phases 4-5 | `python -m livingcode query routes`; `npm run api:inventory:check`; `npm run openapi:check` | No if public claims stay scoped |
| Yellow | GitNexus MCP tools are unavailable in this Codex tool set; CLI was restored through an artifact-local no-scripts install, LadybugDB repair, and absent-language parser stubs for languages not present in the repo. | Phase 1 / Phase 8 | GitNexus `status` and `impact` sample | No for this run, but document setup before commit handoff |
| Yellow | Production dependency drift exists: `dashclaw` package is behind wanted/latest 4.7.2; `postcss` has a patch update; React 19, Tailwind 4, ESLint 10, Redis 6, TypeScript 6, and React type majors are out of scope unless a later gate fails. | Phase 5 / Phase 8 | `.supergoal/.../npm-outdated.json` | No unless contract or security review requires update |
| Yellow | Playwright smoke passes, but Next.js emits a `metadataBase` fallback warning for social image URL resolution during smoke. | Phase 7 | `npm run test:smoke`; `npm run production:check` | No, but polish before public launch |

## GitNexus Gate

The required impact-analysis path is available through the artifact-local GitNexus CLI:

- `status`: indexed `C:\Projects\DashClaw`, commit `39d4aab`, up to date.
- Sample impact: `parseArgs` in `scripts/startup-smoke.mjs`, upstream, `LOW` risk, 1 direct dependent, 4 impacted symbols, no affected processes.
- Before editing any existing function, class, or method, run the same CLI impact command with the concrete symbol and file path, and report direct callers, affected processes, and risk.

## Out Of Scope For This Sweep

- Major framework migrations: React 19, Tailwind 4, ESLint 10, Redis 6, TypeScript 6, and equivalent major dependency tracks.
- SDK publication, deployment, or production infrastructure changes.
- Reverting pre-existing dirty worktree changes unrelated to this run.
- Treating every experimental route as launch-critical; public claims should lead with stable governed-agent workflows and documented setup/demo proof.
