---
source-of-truth: false
owner: Product / Platform
last-verified: 2026-04-07
doc-type: planning
---

# DashClaw Agent Operating Layer Program Brief

- Date: 2026-04-07
- Status: Active planning brief
- Audience: Claude Code, Codex, contributors, product, platform engineering

## 1. One-Sentence Thesis

DashClaw is becoming the governed runtime and control plane for agent work.

## 2. Why This Exists

DashClaw already has strong governance primitives, but the product story and SDK shape still make it easy to read as "agent logging with approvals."

That is too small.

The actual opportunity is larger:

- DashClaw should be where agents invoke tools,
- where workflows execute,
- where risky actions pause for approval,
- where operators understand live state,
- where evidence and outcomes accumulate,
- and where teams manage agent operations as a system.

## 3. Primary Product Wedge

The primary commercial wedge is the **governed capability gateway**.

Why this wedge wins:

- agents need tools,
- tool use is where risk and spend concentrate,
- enterprises want auth, policy, approval, and audit at that chokepoint,
- once tool invocation goes through DashClaw, higher-level workflow and operator value compounds naturally.

## 4. Target Customer

DashClaw should optimize first for teams that are already serious enough to run agents against real systems:

- product and engineering teams deploying internal agent workflows,
- AI startups building customer-facing agent systems,
- platform teams that need policy, approvals, and auditability,
- operators who need to supervise agent work without reading raw logs.

## 5. Product Spine

When making product or implementation decisions, use this platform spine:

### Trust Layer

- guard
- approvals
- policy
- evidence
- identity

### Execution Layer

- capabilities
- workflows
- model strategies

### Operator Layer

- sessions
- failures
- approvals queue
- drift
- health

### Data Layer

- knowledge collections
- artifacts
- outcomes
- lessons

### Admin Layer

- routing
- compliance
- billing
- org configuration

## 6. The Near-Term Goal

Over the next 90 days, DashClaw should become obviously credible in three areas:

1. governed capability invocation,
2. workflow execution for real work,
3. unified operator supervision.

If these three become strong, the broader platform story becomes believable.

## 7. What Good Looks Like

At the end of the next major build cycle, a new user should be able to say:

- "I can register a tool and run it through DashClaw."
- "I can run a multi-step workflow and see where it failed."
- "I can approve, inspect, and recover agent work from one operator surface."
- "I understand which SDK I am supposed to use and why."

## 8. Explicit Non-Goals Right Now

Do not prioritize these ahead of the runtime spine:

- adding more isolated admin surfaces,
- broadening compliance features without stronger evidence plumbing,
- building more peripheral memory or preference systems,
- expanding the legacy SDK surface,
- launching a marketplace before the capability runtime is strong.

## 9. Decision Rules For Claude Code

When there is ambiguity, apply these rules:

1. Prefer deepening capability runtime, workflow runtime, or operator clarity over adding brand-new feature categories.
2. Prefer designs that make DashClaw the execution chokepoint.
3. Prefer durable object models and consistent nouns over convenience aliases.
4. Prefer canonical SDK improvements over legacy additions.
5. Prefer features that produce visible operator value and measurable usage.

## 10. Canonical Language

Use this language consistently:

- Say "governed runtime and control plane" instead of only "observability" or "decision infrastructure."
- Say "capability gateway" for governed tool invocation.
- Say "workflow runtime" for execution, not just "templates."
- Say "operator cockpit" for the unified live supervision surface.
- Say "compatibility layer" for legacy SDK behavior.

## 11. Relationship To The Roadmap

This brief sets the product direction.

The execution sequence is defined in:

- [Agent Operating Layer Roadmap](./2026-04-07-agent-operating-layer-roadmap.md)
- [SDK Consolidation RFC](../plans/archive/2026-04-07-sdk-consolidation.md)
- [SDK Migration Matrix](./2026-04-07-sdk-migration-matrix.md)
- [Platform Object Model](../architecture/platform-object-model.md)
