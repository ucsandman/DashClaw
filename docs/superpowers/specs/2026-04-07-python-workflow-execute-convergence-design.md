# Python Workflow Execute Convergence Design

Date: 2026-04-07
Status: proposed
Owner: SDK Lead

## Goal

Bring the Python SDK into workflow-runtime parity for the existing workflow execute route so public SDK drift is caught automatically and Python users can execute workflow templates through the same governed HTTP contract the platform already ships.

## Problem

Current state:

- Node SDK exposes workflow template CRUD plus `launch`
- Python SDK exposes workflow template CRUD plus `launch`
- the API also exposes `POST /api/workflows/templates/:templateId/execute`
- Python does not currently expose an `execute_workflow_template(...)` helper
- `contracts:check` does not yet enforce Python workflow public-surface drift

This leaves a real product gap:

- the runtime route exists
- the Python SDK does not surface it
- CI cannot tell us when Python workflow surface falls behind the repo

## Scope

This design covers one narrow slice only:

1. Python workflow execute method
2. SDK contract enforcement for the Python workflow surface
3. docs and release-plan updates tied to that public-surface change

Out of scope:

- model strategy convergence
- knowledge collection convergence
- full workflow namespace redesign
- legacy Node workflow cleanup
- OpenAPI generation redesign

## Current Source Of Truth

### Existing API route

- `app/api/workflows/templates/[templateId]/execute/route.ts` (removed in the v5.0.0 cull)

Current route behavior:

- `POST /api/workflows/templates/{templateId}/execute`
- accepts a body with:
  - `variables`
  - `agent_id`
  - `declared_goal`
- returns governed workflow execution output including:
  - `success`
  - `action_id`
  - `steps`
  - `result`
  - `error`
  - `total_elapsed_ms`
  - `governed`

### Existing Python methods

- [client.py](../../../sdk-python/dashclaw/client.py)

Python already has:

- `list_workflow_templates(...)`
- `create_workflow_template(...)`
- `get_workflow_template(...)`
- `update_workflow_template(...)`
- `duplicate_workflow_template(...)`
- `launch_workflow_template(...)`

Missing:

- `execute_workflow_template(...)`

### Existing contract validator

- [check-sdk-surface.mjs](../../../scripts/lib/contracts/check-sdk-surface.mjs)
- [public-surface.json](../../../contracts/sdk/public-surface.json)
- [release-plan.json](../../../contracts/sdk/release-plan.json)

Current SDK contract enforcement only covers:

- Node capabilities
- Python capabilities
- SDK release-plan version consistency

## Recommended Approach

Implement Python workflow parity as a small extension of the contract system that already exists for Python capabilities.

This means:

1. add Python workflow required methods to the SDK contract
2. extend the SDK validator to discover and validate workflow methods in Python
3. add the missing Python execute helper
4. update the release plan and parity docs in the same change

This is preferred over a broad parity sweep because it:

- keeps risk low
- preserves domain-by-domain convergence
- gives immediate CI value
- avoids reopening namespace/design debates

## API Contract

The Python client method should map directly to the existing route:

```text
POST /api/workflows/templates/{templateId}/execute
```

Proposed Python method:

```python
execute_workflow_template(template_id, variables=None, agent_id=None, declared_goal=None)
```

Request body behavior:

- omit unset fields
- send only:
  - `variables`
  - `agent_id`
  - `declared_goal`

This matches the current route without adding Python-only semantics.

## Contract Model Change

`contracts/sdk/public-surface.json` should evolve from a single Python capability declaration to grouped Python domains.

Recommended structure:

```json
{
  "python": {
    "domains": {
      "capabilities": {
        "canonical_root": "capabilities",
        "required_methods": [
          "list_capabilities",
          "create_capability",
          "get_capability",
          "update_capability",
          "invoke_capability",
          "test_capability",
          "get_capability_health",
          "list_capability_health",
          "get_capability_history"
        ]
      },
      "workflows": {
        "canonical_root": "workflows",
        "required_methods": [
          "list_workflow_templates",
          "create_workflow_template",
          "get_workflow_template",
          "update_workflow_template",
          "duplicate_workflow_template",
          "launch_workflow_template",
          "execute_workflow_template"
        ]
      }
    }
  }
}
```

Why this structure:

- scales to future Python convergence slices
- keeps domain boundaries explicit
- avoids a flat giant required-method list

## Validator Behavior

`check-sdk-surface.mjs` should:

1. discover Python public methods from `sdk-python/dashclaw/client.py`
2. select methods by domain
3. compare discovered methods to required methods per domain
4. fail on:
   - missing required methods
   - undeclared discovered methods inside enforced domains

Recommended finding codes:

- `missing_python_sdk_method`
- `undeclared_python_sdk_method`

No new error code family is needed yet.

## Testing Strategy

### JavaScript contract tests

Extend:

- [contracts.sdk-surface.test.js](../../../__tests__/unit/contracts.sdk-surface.test.js)

Add:

- failing test when required Python workflow methods are missing
- failing test when Python workflow domain exposes undeclared methods
- passing test when workflow and capability domains both align

### Python client tests

Add a focused Python test file, similar to the capability-runtime pattern:

- `sdk-python/tests/test_python_workflows_runtime.py`

Tests should verify:

- `execute_workflow_template(...)` sends `POST /api/workflows/templates/{id}/execute`
- payload only includes explicitly provided fields
- no extra Python-only wrapper semantics are introduced

## Docs To Update

- [README.md](../../../sdk-python/README.md)
- [sdk-parity.md](../../sdk-parity.md)
- [2026-04-07-sdk-migration-matrix.md](../../planning/2026-04-07-sdk-migration-matrix.md)

Documentation should say:

- workflow execute is now available in Python
- workflow runtime parity is route-contract aligned for this slice
- release-plan was intentionally updated because public surface changed

## Release Plan Policy

Because this adds a new public Python SDK method, `contracts/sdk/release-plan.json` must change in the same PR.

Expected change:

- keep `current_version` unchanged until release
- keep or reaffirm `next_bump: "minor"`
- add `workflows` to Python `domains`
- update `reason` to mention workflow execute convergence

## Risks

### 1. Over-broad contract refactor

Risk:

- turning the Python contract shape into a big redesign

Mitigation:

- keep the change minimal
- if grouped domains cause too much churn, a small incremental shape is acceptable as long as workflows are explicit

### 2. Route semantics drift

Risk:

- Python wrapper guesses request shape instead of following the route

Mitigation:

- read the route implementation directly
- only send the fields the route already handles

### 3. Docs drift again

Risk:

- method lands without parity docs or release-plan update

Mitigation:

- make docs and release-plan part of the same TDD slice
- finish with `contracts:check` and `docs:check`

## Success Criteria

This slice is complete when:

1. Python exposes `execute_workflow_template(...)`
2. `contracts:check` fails if the Python workflow surface drifts
3. parity docs mention the workflow runtime convergence
4. targeted Python and JS tests pass
5. `npm run contracts:check` passes
6. `npm run docs:check` passes

## Recommended Next Step After This

After workflow execute convergence:

1. model strategy execution convergence
2. knowledge collection contract convergence

Keep the same pattern:

- one domain
- one contract extension
- one focused test file
- one release-plan/docs update
