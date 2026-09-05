---
source-of-truth: true
owner: DevEx Lead
last-verified: 2026-07-05
doc-type: governance
---

# Documentation Governance

## Purpose

Define a single, explicit documentation hierarchy and update protocol to prevent drift across architecture, decisions, and onboarding docs.

## The map

[`docs/README.md`](./README.md) is the documentation index — the front door for adopters. Every user-facing doc must be reachable from it; anything not linked from its sections 1–7 is internal process material (specs, plans, handoffs, research) and is not maintained as a current reference.

## Canonical Hierarchy

When documents disagree, use this precedence order:

1. `docs/decisions/*.md` and ADR-status files in `docs/architecture/` (`enforcement-boundary.md`, `trust-and-failure-model.md`)
2. `docs/rfcs/*.md` with `Status: Approved` for active roadmap commitments
3. `PROJECT_DETAILS.md` for architecture and system behavior
4. Generated artifacts (`docs/api-inventory.md`, `docs/openapi/*.json`) for route-level facts — regenerate, never hand-edit
5. `README.md`, `QUICK-START.md`, and the guides under `docs/` (concepts, integrations, operations, troubleshooting) for onboarding and usage
6. `CLAUDE.md` / `AGENTS.md` for coding-agent handoff notes (non-canonical, but kept current)

## Architecture-governed docs (metadata header required)

- `PROJECT_DETAILS.md`
- `docs/architecture/enforcement-boundary.md` and `docs/architecture/trust-and-failure-model.md` (ADRs — change by superseding, not by editing)
- `THESIS.md` for the canonical product boundary and supported object model
- `docs/decisions/*.md` and approved RFCs
- `docs/sdk-parity.md`, `docs/sdk-reference.md`
- `docs/hosted-deployment-runbook.md`, `docs/instant-trial-vercel-setup.md`

Every architecture-governed document must begin with:

```yaml
---
source-of-truth: true|false
owner: <role-or-team>
last-verified: YYYY-MM-DD
doc-type: architecture|decision|rfc|status|governance|pointer
---
```

## Handoff / onboarding docs (keep current when workflows change)

- `README.md`, `QUICK-START.md`, `CONTRIBUTING.md`
- `docs/README.md` (the index — update it when adding or retiring any user-facing doc)
- `docs/concepts.md`, `docs/operations.md`, `docs/troubleshooting.md`
- `docs/integrations/*.md`, `docs/agent-bootstrap.md`, `docs/client-setup-guide.md`
- `CLAUDE.md`

## Update Protocol

1. Update the canonical source first using the hierarchy above.
2. If behavior changed, add or update a decision doc in `docs/decisions/` (or supersede the relevant ADR).
3. Synchronize dependent docs in the same PR — and if a doc was added, retired, or renamed, update `docs/README.md`.
4. Set `last-verified` to the merge date of the change.
5. Counts (routes, SDK methods, MCP tools, policy types) are gated by `node scripts/check-doc-counts.mjs --strict` — cite a derived number, then register the citation in that script's `COUNT_CHECKS` so it cannot rot silently.
6. Enforcement claims follow the copy rule in [`docs/architecture/enforcement-boundary.md`](./architecture/enforcement-boundary.md): say "blocks" without qualification only where enforcement is mechanical.
