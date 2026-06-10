# DashClaw Development Context

This file provides operational context for AI coding agents working inside the DashClaw repository.

Agents must treat this repository as a production open source infrastructure project. All modifications should prioritize stability, developer clarity, and maintainability.

DashClaw is infrastructure software. Avoid introducing complexity unless it clearly improves reliability or developer experience.

---

# Project Overview

DashClaw is a governance runtime for AI agent decisions.

It governs AI agents before they execute real world actions by introducing a policy evaluation and approval layer.

Core decision flow:

Agent intent -> policy evaluation -> approval or block -> execution -> decision evidence recorded

DashClaw acts as the decision governance layer between AI agents and external systems.

The platform allows developers and organizations to:

* intercept risky agent actions
* enforce policy checks
* require human approval
* record verifiable decision evidence
* monitor agent behavior
* detect decision drift

DashClaw enables permissioned autonomy for AI agents.

---

# Core Product Primitives

These primitives define the DashClaw architecture.

## Guard

Evaluates policies before an agent executes an action.

Example usage:

const decision = await claw.guard({
actionType: "deploy",
riskScore: 85
})

Guard responses determine whether actions are:

* allowed
* blocked
* escalated for approval

---

## Action Records

Capture what the agent attempted to do.

Includes:

* action type
* parameters
* reasoning
* execution outcome

---

## Assumptions

Tracks what the agent believed to be true when making a decision.

Used to detect decision drift and incorrect reasoning.

---

## Approvals

Allows high risk actions to pause until a human operator approves or rejects them.

---

## Evidence

Every governed decision produces verifiable evidence.

Evidence enables:

* debugging agent behavior
* compliance reporting
* post incident analysis

---

# System Architecture

DashClaw has three primary layers.

## Agent SDK

Node and Python SDKs wrap agent actions.

Responsibilities:

* send decision requests
* evaluate guard checks
* stream action events
* report outcomes

SDK requirements:

* zero dependencies
* lightweight
* framework agnostic
* stable API

Do not introduce heavy frameworks into the SDK.

---

## Control Plane

Backend services responsible for:

* policy evaluation
* decision recording
* approval workflows
* integrity signal detection
* agent monitoring

This layer must remain modular and scalable.

---

## Mission Control UI

The web interface for governing agent fleets.

Displays:

* live actions
* policy decisions
* approval queues
* integrity signals
* cost movement
* agent status

UI must prioritize operational clarity.

---

# Website Narrative

DashClaw messaging must communicate one clear idea:

Govern AI agents before they act.

AI agents generate actions from goals and context.

They do not follow deterministic code paths.

Therefore debugging alone is insufficient.

Agents require governance.

The website should emphasize:

* decision interception
* policy enforcement
* permissioned autonomy
* developer simplicity

Avoid buzzwords and marketing fluff.

Developers should understand the product within seconds.

---

# Technology Stack

Frontend

Next.js (App Router)
React
JavaScript (JSX — the repo does not use TypeScript)
TailwindCSS

Backend

Node.js services (Next.js App Router API routes)
Python tooling (zero-dependency SDK + scripts; no FastAPI or web framework)

SDK

Node.js
Python

CLI Tools

Python based utilities

---

# Repository Editing Rules

Agents must follow these rules when modifying code.

## General

* Never introduce unnecessary dependencies
* Preserve existing APIs
* Prefer minimal changes
* Avoid large refactors unless requested
* Maintain readability

---

## Frontend Rules

Use JavaScript (JSX). The repo does not use TypeScript.

Prefer functional React components.

Follow Next.js App Router conventions.

Keep components modular and reusable.

Use Tailwind utilities rather than custom CSS when possible.

Avoid large state management libraries.

---

## Backend Rules

Maintain clear service boundaries.

Avoid tightly coupling modules.

Prefer simple, readable code.

Ensure APIs remain backward compatible.

---

## SDK Rules

The SDK must remain:

* extremely lightweight
* dependency free
* easy to embed into agents

Do not introduce frameworks.

Avoid abstractions that obscure the API.

---

# Documentation Rules

Documentation should explain:

* what a feature does
* why it exists
* how developers use it

Avoid marketing language.

Favor clear examples and short explanations.

---

# Safe Editing Workflow

Before modifying code agents must:

1. Identify the relevant files
2. Analyze the surrounding architecture
3. Explain the reasoning for changes
4. Show a diff before applying modifications

Agents should not blindly rewrite files.

---

# Files Agents Should Read First

When working in this repository, review:

README.md
docs/
sdk directories
dashboard frontend code
server control plane logic

Understanding these files is required before making changes.

---

# Primary Goal

DashClaw should remain:

simple to adopt
powerful to operate
transparent in its governance model

---

# Agent-log lessons + operational gates (2026-06-05)

Behavioral rules (explain before acting, don't confirm the story I want, verify current model ids) live in the global `~/.gemini/GEMINI.md`. DashClaw-specific operational gates:

- **Before reporting done, run and read:** `npm run lint`, `npm run typecheck`, `npx vitest run` (full suite), `npx next build`. CI also gates `contracts:check`, `openapi:check`, `api:inventory:check`, `route-sql:check`, `version:check`.
- **Versions:** one shared version across `package.json`, `sdk/package.json`, `sdk-python/pyproject.toml`; bump with `npm run version:set <x.y.z>` — never hardcode (`version:check` fails the build).
- **No direct SQL in `app/api/**/route.js`** — use `app/lib/repositories/*.repository.js`.
- **Model/provider drift:** update `app/lib/providers/providerRegistry.ts` and run `npm run pricing:refresh`; never hardcode model ids/prices; verify current ids.
- **Design:** read `.impeccable.md` before any UI/copy change; never hardcode hex — use the tokens in `app/globals.css` and the Tailwind theme.
- **DashClaw MCP env:** only `DASHCLAW_URL` + `DASHCLAW_API_KEY` (+ optional `DASHCLAW_AGENT_ID`); `org_id` not needed. Maintain plugin parity (claude-code/codex/Hermes); don't cosmetically rename `.jsx`↔`.js`.

The system exists to enable safe and accountable AI agent autonomy.