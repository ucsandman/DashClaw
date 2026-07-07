---
source-of-truth: true
owner: SDK Lead
last-verified: 2026-04-07
doc-type: rfc
---

# RFC: SDK Consolidation And Legacy Compatibility Policy

- RFC ID: RFC-2026-04-07-sdk-consolidation
- Status: Proposed
- Date: April 7, 2026

## 1. Objective

Replace the current ambiguous SDK split with one canonical SDK strategy and one compatibility path.

## 2. Problem

DashClaw currently presents an unclear SDK story:

- Node has a canonical package surface and a legacy surface.
- Python exposes a much broader surface in one client.
- some new platform capabilities were started or preserved in legacy paths,
- docs still describe the split inconsistently.

This causes:

- contributor confusion,
- AI coding agents choosing the wrong surface,
- duplicate or drifting abstractions,
- more expensive maintenance.

## 3. Decision

DashClaw will adopt this SDK policy:

### 3.1 Canonical rule

There is one canonical SDK surface for new product work.

For Node, that is the main `dashclaw` client.

For Python, the long-term goal is the same conceptual canonical surface, even if the implementation transitions more gradually.

### 3.2 Legacy rule

`dashclaw/legacy` is a compatibility layer, not a product-design surface. (now DEPRECATED — removed in v5.0.0)

It may:

- preserve old signatures,
- keep older integrations working,
- shim to the same HTTP contracts.

It must not:

- become the default target for new features,
- receive new feature-first API design,
- define the future product model.

### 3.3 Source-of-truth rule

The HTTP API contract is the source of truth.

SDKs should be generated or wrapped from the same route contracts wherever possible.

### 3.4 Migration rule

Partially-started features in legacy should be **promoted and shimmed**, not duplicated.

That means:

1. stabilize the HTTP contract,
2. implement the canonical SDK method or namespace,
3. make legacy call through to the same route,
4. document legacy as compatibility-only.

## 4. Recommended SDK Shape

The target SDK shape is namespaced by concern rather than split by historical versioning.

Illustrative example:

```javascript
dc.runtime.guard()
dc.runtime.createAction()
dc.execution.executeWorkflow()
dc.execution.capabilities.invoke()
dc.execution.capabilities.test()
dc.operator.getPendingApprovals()
dc.operator.listSessions()
dc.admin.mapCompliance()
```

The exact namespace design may evolve, but the principle is fixed:

- one canonical surface,
- organized by platform concern,
- with compatibility shims for older flat methods where needed.

## 5. Policy For New Features

Starting now:

1. New features must land in the canonical SDK surface first.
2. Legacy may receive a shim only after the canonical method exists.
3. No new feature planning should start from legacy signatures.
4. Docs must describe the canonical path first and compatibility second.

## 6. Handling Features Already Started In Legacy

When a feature already exists or has started in legacy:

### Allowed path

- Keep the route contract.
- Design the canonical SDK API around the current product model.
- Implement the canonical wrapper.
- Leave a compatibility adapter in legacy if needed.

### Not allowed

- extending the legacy-only shape as the primary interface,
- building parallel semantics in canonical and legacy surfaces,
- leaving the route contract undocumented while SDK behavior diverges.

## 7. Consolidation Strategy

Use domain-based promotion instead of random method migration.

Promote complete domains:

- execution: workflows, capabilities, model strategies, knowledge
- runtime: guard, actions, approvals, sessions
- operator: approvals, sessions, failures, health, action graph
- admin: identities, routing, compliance, billing

This keeps the canonical SDK understandable.

## 8. Python Policy

Python currently exposes a broader surface than Node.

Until convergence is complete:

- Python may remain broader,
- but new design decisions should still follow the canonical object model and HTTP contracts,
- and Python should converge toward the same platform grouping and naming policy.

Do not treat Python breadth as permission to continue product design drift.

## 9. Documentation Policy

The following documents must remain aligned:

- [README](../../../README.md)
- [SDK README](../../../sdk/README.md)
- [SDK Parity Matrix](../../sdk-parity.md)
- [SDK Migration Matrix](../../planning/2026-04-07-sdk-migration-matrix.md)

If the SDK policy changes, update these docs in the same change.

## 10. Acceptance Criteria

This RFC is considered implemented when:

1. new feature planning stops targeting legacy first,
2. docs consistently describe legacy as compatibility-only,
3. the migration matrix exists and is actively maintained,
4. at least one partially-legacy domain has been promoted and shimmed successfully.

## 11. Non-Goals

- removing legacy immediately,
- breaking existing integrations,
- fully redesigning every SDK method in one release.

## 12. Immediate Follow-On Work

1. publish the migration matrix,
2. fix README and parity docs,
3. start new execution features under the canonical SDK policy,
4. use domain-based promotion for capability and workflow surfaces first.
