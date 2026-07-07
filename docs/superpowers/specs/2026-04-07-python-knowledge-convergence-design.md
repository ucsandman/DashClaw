# Python Knowledge Convergence Design

Date: 2026-04-07
Status: proposed
Owner: SDK Lead

## Goal

Complete the main execution-studio Python contract coverage sweep by bringing the knowledge-collection domain under explicit API and SDK contract enforcement.

## Problem

Current state:

- Node SDK exposes the full knowledge-collection surface
- Python SDK already exposes the same practical surface:
  - `list_knowledge_collections(...)`
  - `create_knowledge_collection(...)`
  - `get_knowledge_collection(...)`
  - `update_knowledge_collection(...)`
  - `list_knowledge_collection_items(...)`
  - `add_knowledge_collection_item(...)`
  - `sync_knowledge_collection(...)`
  - `search_knowledge_collection(...)`
- the API routes for knowledge sync and search exist
- but there is no `contracts/api/knowledge-collections.json`
- and Python knowledge is not yet enforced by `contracts:check`

That means:

- the runtime surface exists
- parity is real but implicit
- CI still cannot tell us when knowledge routes or Python knowledge methods drift

## Scope

This design covers:

1. an API contract file for knowledge collections
2. Python knowledge SDK contract declarations
3. validator support for the Python knowledge domain
4. focused Python route-shape tests for item add, sync, and search
5. release-plan and parity-doc updates

Out of scope:

- changing route semantics
- adding new knowledge features
- changing Node knowledge behavior
- broader docs or namespace redesign

## Current Source Of Truth

### Existing Node surface

- [dashclaw.js](../../../sdk/dashclaw.js)

Node exposes:

- `listKnowledgeCollections(...)`
- `createKnowledgeCollection(...)`
- `getKnowledgeCollection(...)`
- `updateKnowledgeCollection(...)`
- `listKnowledgeCollectionItems(...)`
- `addKnowledgeCollectionItem(...)`
- `syncKnowledgeCollection(...)`
- `searchKnowledgeCollection(...)`

### Existing Python surface

- [client.py](../../../sdk-python/dashclaw/client.py)

Python already exposes:

- `list_knowledge_collections(...)`
- `create_knowledge_collection(...)`
- `get_knowledge_collection(...)`
- `update_knowledge_collection(...)`
- `list_knowledge_collection_items(...)`
- `add_knowledge_collection_item(...)`
- `sync_knowledge_collection(...)`
- `search_knowledge_collection(...)`

### Existing runtime routes

Relevant route files include:

- `app/api/knowledge/collections/route.ts` (removed in v5)
- `app/api/knowledge/collections/[collectionId]/route.ts` (removed in v5)
- `app/api/knowledge/collections/[collectionId]/items/route.ts` (removed in v5)
- `app/api/knowledge/collections/[collectionId]/sync/route.ts` (removed in v5)
- `app/api/knowledge/collections/[collectionId]/search/route.ts` (removed in v5)

### Existing contract system

- [public-surface.json](../../../contracts/sdk/public-surface.json)
- [release-plan.json](../../../contracts/sdk/release-plan.json)
- [check-sdk-surface.mjs](../../../scripts/lib/contracts/check-sdk-surface.mjs)

Current Python domains in the contract:

- `capabilities`
- `workflows`
- `model_strategies`

Missing:

- `knowledge`

Current API contract coverage also lacks a knowledge-collections manifest.

## Recommended Approach

Add knowledge as the next explicit contract-enforced domain, using the same domain-by-domain pattern already established for:

- capabilities
- workflows
- model strategies

This slice should do two things:

1. make API route coverage explicit for knowledge collections
2. make Python SDK knowledge surface drift visible in CI

Because the Python methods already exist, the likely work is:

- contract declaration
- validator support
- route-shape confidence tests
- docs/release-plan updates

## API Contract

Add a new API contract file:

- `contracts/api/knowledge-collections.json`

Expected routes:

- `GET /api/knowledge/collections`
- `POST /api/knowledge/collections`
- `GET /api/knowledge/collections/:collectionId`
- `PATCH /api/knowledge/collections/:collectionId`
- `GET /api/knowledge/collections/:collectionId/items`
- `POST /api/knowledge/collections/:collectionId/items`
- `POST /api/knowledge/collections/:collectionId/sync`
- `POST /api/knowledge/collections/:collectionId/search`

This lets `contracts:check` fail if the route surface drifts.

## SDK Contract Shape

Extend Python `domains` in [public-surface.json](../../../contracts/sdk/public-surface.json) with:

```json
"knowledge": {
  "canonical_root": "knowledge",
  "required_methods": [
    "list_knowledge_collections",
    "create_knowledge_collection",
    "get_knowledge_collection",
    "update_knowledge_collection",
    "list_knowledge_collection_items",
    "add_knowledge_collection_item",
    "sync_knowledge_collection",
    "search_knowledge_collection"
  ]
}
```

## Validator Behavior

Extend the Python domain selector in [check-sdk-surface.mjs](../../../scripts/lib/contracts/check-sdk-surface.mjs) to recognize the `knowledge` domain.

Suggested selector behavior:

- match methods containing `knowledge_collection`
- plus `search_knowledge_collection`
- plus `sync_knowledge_collection`

Keep the validator behavior unchanged otherwise:

- `missing_python_sdk_method`
- `undeclared_python_sdk_method`

## Testing Strategy

### JavaScript contract tests

Extend:

- [contracts.sdk-surface.test.js](../../../__tests__/unit/contracts.sdk-surface.test.js)

Add:

- failing test when required Python knowledge methods are missing
- failing test when discovered Python knowledge methods are undeclared
- passing case where all current Python execution-studio domains align

### Python route-shape test

Add:

- `sdk-python/tests/test_python_knowledge_runtime.py`

Verify these existing methods against their route shapes:

1. `add_knowledge_collection_item(...)`

Expected:

- method: `POST`
- path: `/api/knowledge/collections/<id>/items`
- JSON body includes the item payload only

2. `sync_knowledge_collection(...)`

Expected:

- method: `POST`
- path: `/api/knowledge/collections/<id>/sync`
- JSON body is `{}`

3. `search_knowledge_collection(...)`

Expected:

- method: `POST`
- path: `/api/knowledge/collections/<id>/search`
- JSON body includes:
  - `query`
  - `limit`

These are confidence tests, not new features.

## Docs To Update

- [sdk-python/README.md](../../../sdk-python/README.md)
- [sdk-parity.md](../../sdk-parity.md)
- [2026-04-07-sdk-migration-matrix.md](../../planning/2026-04-07-sdk-migration-matrix.md)
- optionally [docs/contracts/README.md](../../contracts/README.md) to mention the new API contract file

Docs should say:

- Python knowledge is now contract-enforced
- knowledge routes are now explicitly declared in the API contract layer

## Release Plan

Because this changes the enforced public Python SDK contract, [release-plan.json](../../../contracts/sdk/release-plan.json) must update in the same slice:

- add `knowledge` to Python `domains`
- update the reason to mention knowledge convergence
- keep `current_version` unchanged
- keep `next_bump: "minor"`

## Risks

### 1. Selector under-match or over-match

Risk:

- the knowledge selector misses a valid method or captures an unrelated one

Mitigation:

- keep the selector narrow
- use exact required-method declarations as the true boundary

### 2. API contract file misses a route

Risk:

- contract coverage gives a false sense of completeness

Mitigation:

- derive the route list directly from `app/api/knowledge/collections/**`
- verify with `contracts:check`

### 3. README drift

Risk:

- runtime methods exist but docs still imply a partial or metadata-only surface

Mitigation:

- update the Python README in the same slice
- finish with `docs:check`

## Success Criteria

This slice is complete when:

1. knowledge collections have an API contract file
2. Python `knowledge` is declared in the SDK contract
3. `contracts:check` fails if knowledge routes or Python knowledge methods drift
4. focused JS contract tests pass
5. focused Python runtime-route tests pass
6. parity docs and release-plan are updated
7. `npm run contracts:check` passes
8. `npm run docs:check` passes

## Recommended Next Step After This

After knowledge convergence, the main execution-studio Python contract sweep is effectively complete.

The next likely themes would be:

1. admin/operator-heavy domains such as identities or routing
2. a `contracts:sync` helper for low-risk scaffolding and autofix
