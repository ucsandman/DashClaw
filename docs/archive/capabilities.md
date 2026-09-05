# DashClaw Capability Classification

> **HISTORICAL (archived 2026-09-05).** This superseded taxonomy describes the
> pre-v5 agent-platform direction. Its tier assignments are incomplete and its
> folder conventions never matched the shipped codebase. It is preserved as
> decision history, not current architecture. See the canonical [product
> thesis](../../THESIS.md) and [system map](../../PROJECT_DETAILS.md).

This document defines the DashClaw product taxonomy. DashClaw is organized into a focused governance runtime with modular extensions.

---

## Tier 1: Core Runtime (`app/(core)`)
**Rule:** Participates directly in the lifecycle of a governed decision.

| Capability | SDK Golden Path | API Namespace | UI Surface |
|------------|-----------------|---------------|------------|
| **Policy Engine** | `guard()` | `/api/guard` | Policies |
| **Action Recording** | `createAction()` | `/api/actions` | Decisions |
| **Approval Gating** | `waitForApproval()` | `/api/approvals` | Approvals |
| **Assumption Ledger** | `recordAssumption()` | `/api/assumptions` | Decisions |
| **Risk Signals** | `getSignals()` | `/api/signals` | Approvals |
| **Fleet Health** | -- | `/api/health` | Approvals |

---

## Tier 2: Extensions (`app/(extensions)`)
**Rule:** Modular operational intelligence. Not required for core governance.

| Extension | Focus | API Namespace |
|-----------|-------|---------------|
| **Compliance** | Audit evidence and SOC 2 reporting | `/api/compliance` |
| **Drift** | Detection of reasoning and metric drift | `/api/drift` |
| **Evaluations** | LLM-as-judge accuracy scoring | `/api/evaluations` |
| **Prompts** | Versioning and governance of agent prompts | `/api/prompts` |
| **Scoring** | Multi-dimensional risk profiles | `/api/scoring` |
| **Webhooks** | Event-driven notifications | `/api/webhooks` |

---

## Tier 3: Archived (`app/(archive)`)
**Rule:** Historical features from the "Agent Platform" era. Physically isolated to prevent bloat.

- **Messaging:** Agent-to-agent communication.
- **Workspace:** Calendar, Goals, Relationships, and Task lists.
- **Orchestration:** Swarm mapping, Workflow SOPs, and Routing.
- **Intelligence:** Learning loops and Memory maintenance.

---

## The Category Test

1. **Does it block an agent?** &rarr; **CORE**
2. **Does it record a decision?** &rarr; **CORE**
3. **Does it analyze decisions?** &rarr; **EXTENSION**
4. **Does it help agents "work"?** &rarr; **ARCHIVED**
