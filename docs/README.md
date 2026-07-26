# DashClaw Documentation

DashClaw is a governance runtime for AI agents. It sits between an agent's intent and the real world: it evaluates policy before risky actions run, routes human approval where required, records every decision as replayable evidence, and tracks terminal outcomes so a retried agent never silently double-executes.

This page is the index for everything in `docs/` and the doc files at the repo root. It is ordered the way people actually adopt a governance tool: **understand it, try it, connect an agent, operate the fleet, then look things up.**

> **Reading this on GitHub?** The same core material is rendered at [dashclaw.io/docs](https://dashclaw.io/docs), and an interactive explainer (guard simulator, policy playground) lives at [dashclaw.io/explain](https://dashclaw.io/explain/).

---

## 1. Understand

| Read | What it gives you |
|---|---|
| [Concepts: how DashClaw works](./concepts.md) | The mental model in one page — the four primitives, the governance loop, decision types, risk scoring, and what "block" really means on each surface. Start here. |
| [Enforcement boundary (ADR)](./architecture/enforcement-boundary.md) | The honest per-surface table of where blocks are **mechanical** (hooks, gateway plugins, server-executed capabilities) vs **cooperative** (SDK/MCP/chat callers honor the decision). Every enforcement claim in this repo defers to this file. |
| [Trust and failure model (ADR)](./architecture/trust-and-failure-model.md) | What DashClaw trusts, what it verifies, and what happens during an outage. Read this before you rely on DashClaw for anything consequential. |
| [Governance core theory](./architecture/governance-core-theory.md) | The mathematical foundation under the runtime: the calibrated interruption controller (distribution-free error bound + anytime-valid alarms, with proof sketches), the decision lattice, the charter invariants as temporal properties, and honest verdicts on what machinery does and doesn't pay for itself. |
| [PROJECT_DETAILS.md](../PROJECT_DETAILS.md) | The full system map: every UI surface, route tier, and SDK domain. The best-maintained single reference in the repo. |

## 2. Try it

Three doors, pick one:

| You want | Do this | Time |
|---|---|---|
| Proof with zero install | Open [hosted.dashclaw.io/connect](https://hosted.dashclaw.io/connect), mint a trial workspace, send a governed action from the browser | ~3 min |
| A local demo (Docker) | `npx dashclaw-demo` — a simulated high-risk deploy is blocked and Decision Replay opens | ~1 min |
| Your own instance | `npx dashclaw up` (local) or the Vercel + Neon deploy button in the [README](../README.md#deploy) | ~8 min |

The full walkthrough is [QUICK-START.md](../QUICK-START.md). There is also a second, deeper demo — the seeded "Market Intelligence Briefing" workflow in [DEMO.md](../DEMO.md) — which exercises capabilities, policies, knowledge collections, and the workflow engine on a running instance.

## 3. Connect your agent

Every path lands on the same governance primitives, ledger, and approval queue.

| Your agent runs on | Guide |
|---|---|
| Claude Code | [Claude Code integration](./integrations/claude-code.md) — hooks govern every tool call; no SDK code in your agent |
| Any MCP host (Claude Desktop, Managed Agents, Codex, custom) | [MCP integration](./integrations/mcp.md) — stdio server or Streamable HTTP at `/api/mcp` |
| Node.js (custom agent, LangGraph, OpenAI Agents SDK) | [SDK instrumentation golden path](./agent-bootstrap.md) + [Node SDK reference](../sdk/README.md) |
| Python (LangChain, CrewAI, AutoGen, custom) | [SDK instrumentation golden path](./agent-bootstrap.md) + [Python SDK reference](../sdk-python/README.md) |
| Hermes Agent / OpenClaw | Plugin install commands in the [README integration table](../README.md#choose-your-integration-path) |
| Anything that speaks HTTP | [Runtime API contract](./architecture/runtime-api.md) — the 4-endpoint governance loop |

Working end-to-end examples for each runtime live in [`examples/`](../examples/README.md).

## 4. Operate

You connected an agent. Now you are the operator.

| Read | What it covers |
|---|---|
| [Operating DashClaw](./operations.md) | The operator's day: policies, approvals across five surfaces, the decisions ledger, posture, the emergency halt, and doctor. |
| [Policy modes](./policy-modes.md) | Named policy packs (Claude Code starter, SOC 2 alignment, Enterprise Strict…) that compile to guard policies. |
| [Telegram approvals](./telegram-setup.md) | Inline Approve/Reject buttons in an admin chat. |
| [Troubleshooting](./troubleshooting.md) | The errors you will actually see (`503 SCHEMA_NOT_INITIALIZED`, `410 APPROVAL_EXPIRED`, the two-action-id footgun) and their fixes. |

## 5. Deploy and secure

| Read | What it covers |
|---|---|
| [Deploy without OAuth](./deploy-without-oauth.md) | Vercel + Neon in under 10 minutes with password auth only. |
| [OIDC login setup](./OIDC_SETUP.md) | Dashboard sign-in via Authentik/Keycloak. This is **human** login — for cryptographic *agent* identity see the next row. |
| [Agent identity](./agent-identity.md) | JWKS-verified agent JWTs: signature verification, replay protection, action binding. |
| [Security guide](./SECURITY.md) | Operator-facing security model, ASVS mapping, hardening changelog, coordinated disclosure. |
| [Guard enforcement contract](./guard-enforcement-contract.md) | Fail-closed degradation, evaluation deadlines, unavailable-instance policy, idempotency, org kill switch. |
| [Hosted deployment runbook](./hosted-deployment-runbook.md) | Operator-only: running a public trial-minting instance (Turnstile, cleanup crons). Most self-hosters never need this. |

## 6. Reference

| Surface | Canonical reference |
|---|---|
| HTTP API — the core loop | [Runtime API contract](./architecture/runtime-api.md) |
| HTTP API — all routes with maturity tier | [API inventory](./api-inventory.md) (generated; **122 routes**: 38 stable, 17 beta, 67 experimental) |
| HTTP API — pinned stable contract | [OpenAPI spec](./openapi/critical-stable.openapi.json) ([about](./openapi/README.md)) — covers the stable tier only; beta/experimental routes have no OpenAPI coverage by design |
| Node SDK (`dashclaw` on npm) | [`sdk/README.md`](../sdk/README.md) — the canonical method catalogue |
| Python SDK (`dashclaw` on PyPI) | [`sdk-python/README.md`](../sdk-python/README.md) — broader surface, snake_case, framework integrations |
| Node ↔ Python parity | [SDK parity matrix](./sdk-parity.md) (maintainer-grade detail) |
| MCP server (`@dashclaw/mcp-server`) | [`mcp-server/README.md`](../mcp-server/README.md) — all **17 governance MCP tools**, 4 resources, config |
| CLI (`@dashclaw/cli`) | [`cli/README.md`](../cli/README.md) — every command, incl. `up`, `install claude`, approvals, `halt`, doctor |
| Durable outcomes | [Durable execution finality](./architecture/durable-execution-finality.md) — the five-state machine and the sweep |
| Object glossary | [Platform object model](./architecture/platform-object-model.md) |
| Environment variables | [`.env.example`](../.env.example) — annotated, always current |

Build against **stable** routes. Experimental routes can change without notice; the tier of every route is in the API inventory.

## 7. Project

- [Changelog](../CHANGELOG.md) — release history (near-daily).
- [Contributing](../CONTRIBUTING.md) — dev setup, gates, PR process.
- [MAINTAINER.md](../MAINTAINER.md) — this project is maintained by an AI under a human-held charter; these are the five invariants the maintainer cannot change.
- [Maintainer log](./maintainer-log.md) — every maintainer decision, on the record.
- [Documentation governance](./documentation-governance.md) — which doc wins when two disagree.

---

## What the rest of this directory is

`docs/` also holds the project's working paper trail. These directories are **internal process artifacts, not product documentation** — they describe how the project was built, not how to use it. They are kept public on purpose (the maintainer works in the open), but nothing in them is maintained as a current reference:

| Directory | What it is |
|---|---|
| `docs/superpowers/` | Historical feature specs and implementation plans, dated. Point-in-time; superseded by shipped code. |
| `docs/rfcs/`, `docs/decisions/` | RFCs and decision records. Decisions outrank other docs when they conflict (see [documentation governance](./documentation-governance.md)). |
| `docs/planning/`, `docs/internal/`, `docs/research/` | Strategy notes, program briefs, competitive research. |
| `docs/handoffs/`, `docs/lessons/`, `docs/releases/` | Session handoffs, retrospective notes, release closeouts. |
| `docs/archive/` | Retired documents kept for link stability. |
| `docs/ops/`, `docs/operator/`, `docs/smoke-tests/`, `docs/testing/`, `docs/integrity/`, `docs/contracts/`, `docs/repositories/`, `docs/prompts/`, `docs/media/` | Maintainer runbooks, test harnesses, and generated assets. |

A handful of internal files also sit at the `docs/` root for historical reasons (`maintainer-log.md`, `monetization-plan.md`, `DISTRIBUTION-LISTINGS.md`, `FAILED_SWARM_LOG.md`, `FULL_CONTEXT.md`, `absorbed-projects.md`, `living-merge.md`, `sdk-live-validation.md`, `ANALYTICS-ROLLOUT.md`, and the security audit templates). If a file is not linked from sections 1–7 above, treat it as internal.
