---
source-of-truth: true
owner: Platform PM
last-verified: 2026-04-07
doc-type: architecture
---

# Platform Object Model

## Purpose

This document defines the canonical nouns and relationships for DashClaw.

Use these objects consistently in:

- product language,
- route design,
- SDK design,
- dashboard UX,
- internal planning,
- AI-assisted implementation.

## Core Objects

## 1. Agent

An actor that performs governed work.

Examples:

- coding agent,
- deploy agent,
- research agent,
- support agent.

An agent may:

- create sessions,
- create actions,
- invoke capabilities,
- execute workflows,
- emit messages,
- produce artifacts.

## 2. Session

A bounded operating window for an agent.

A session tracks:

- workspace or environment,
- branch or target system context,
- current status,
- blocked reason,
- lifecycle events.

An agent can have many sessions over time.

## 3. Action

The canonical unit of governed work.

Every meaningful operation should be represented as an action.

An action has:

- type,
- goal,
- status,
- risk,
- timing,
- inputs and outputs,
- linked evidence.

Actions may be:

- top-level,
- child actions of a workflow,
- approval-gated,
- capability-backed,
- linked to artifacts and messages.

## 4. Approval

A human decision attached to an action.

An approval is not a separate unit of work. It is a governance event that changes whether an action may proceed.

Approvals record:

- decision,
- approver,
- reason,
- timestamp.

## 5. Capability

A registered callable power that an agent may use.

Examples:

- external HTTP API,
- internal service endpoint,
- webhook-backed action,
- future marketplace integration.

A capability defines:

- contract,
- auth requirements,
- risk level,
- approval requirement,
- health,
- invocation behavior.

## 6. Workflow

A reusable multi-step execution definition.

A workflow composes:

- steps,
- variables,
- linked capabilities,
- linked knowledge,
- linked model strategy,
- linked policy context.

A workflow definition is reusable.
A workflow run is a governed execution instance.

## 7. Model Strategy

A reusable policy for model/provider execution.

A model strategy defines:

- primary provider/model,
- fallback chain,
- budget and retry behavior,
- provider allow/deny constraints,
- runtime preferences.

It is execution policy, not business logic.

## 8. Knowledge Collection

A governed retrieval corpus.

A knowledge collection contains:

- sources,
- items,
- chunks,
- searchable embedded content,
- metadata about ingestion.

It is shared data used by workflows, capabilities, and agents.

## 9. Artifact

A first-class output or evidence object produced by work.

Examples:

- report,
- patch,
- transcript,
- file,
- structured JSON result,
- evidence bundle.

Artifacts should be durable, referenceable, and linked to the actions or workflow steps that produced them.

## 10. Outcome

The result state of an action or workflow run.

Outcome answers:

- did it succeed,
- what did it produce,
- what failed,
- what changed,
- what evidence exists.

Outcome is result data, not the object that stores every related thing.

## 11. Evidence

The set of records that explain and justify what happened.

Evidence may include:

- guard decisions,
- approvals,
- assumptions,
- action history,
- artifacts,
- messages,
- policy matches,
- execution graph relationships.

Evidence is what makes DashClaw inspectable and auditable.

## Object Relationships

Use these relationships as canonical:

- an `agent` creates many `sessions`
- an `agent` creates many `actions`
- a `session` contains many `actions`
- an `action` may require one `approval`
- an `action` may invoke one `capability`
- an `action` may belong to one `workflow run`
- a `workflow` contains many `steps`
- a `workflow run` creates many child `actions`
- a `workflow` may use one `model strategy`
- a `workflow` may use many `knowledge collections`
- an `action` or `workflow run` may produce many `artifacts`
- an `outcome` summarizes the result of an `action` or `workflow run`
- `evidence` is composed from linked records across these objects

## Layer Mapping

Map the objects to the platform layers like this:

### Trust Layer

- action
- approval
- evidence
- identity

### Execution Layer

- capability
- workflow
- model strategy

### Operator Layer

- session
- action
- workflow run
- health and drift signals

### Data Layer

- knowledge collection
- artifact
- outcome

## Design Implications

Use these rules when adding features:

1. New execution features should usually attach to `capability`, `workflow`, `action`, or `artifact` first.
2. New operator views should organize around `session`, `action`, `workflow run`, and `capability health`.
3. Do not create overlapping nouns when an existing core object fits.
4. If a feature produces output that matters later, model it as an `artifact`.
5. If a feature influences whether work is allowed, attach it to `action`, `approval`, or `policy/evidence` semantics.

## Naming Guidance

Prefer these names:

- `workflow run` over "workflow launch result"
- `capability invocation` over generic "tool call" in platform internals
- `artifact` over "attachment" when the object is a durable work product
- `operator cockpit` over separate ad hoc dashboard names for the same live-ops role

## Related Documents

- [Agent Operating Layer Program Brief](../planning/2026-04-07-agent-operating-layer-program-brief.md)
- [Agent Operating Layer Roadmap](../planning/2026-04-07-agent-operating-layer-roadmap.md)
- [SDK Consolidation RFC](../plans/archive/2026-04-07-sdk-consolidation.md)
