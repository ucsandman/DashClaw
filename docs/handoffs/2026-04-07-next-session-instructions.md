# Next Session Instructions

This file is meant for the next Claude Code or Codex session.

## Start Here

1. Read:
   - [session-state.md](./2026-04-07-session-state.md)
   - [watchouts.md](./2026-04-07-watchouts.md)
2. Run:

```bash
npm run contracts:check
npm run docs:check
```

3. Confirm current branch tip and recent SDK contract files before editing anything.

## Recommended First Task

Continue Python SDK convergence by domain.

Recommended order:

1. workflows
2. model strategies
3. knowledge collections

Do not try to converge all three in one pass.

## How To Approach Each Domain

For each domain:

1. inspect the route contracts already in `contracts/api/`
2. inspect Node canonical surface
3. inspect current Python client methods
4. add or extend SDK contract coverage
5. add failing tests first
6. implement the smallest missing Python methods
7. update `contracts/sdk/release-plan.json` if public surface changed
8. update parity docs in the same change
9. rerun `contracts:check` and `docs:check`

## Minimum Quality Bar

Do not claim success unless these are green:

```bash
npm run contracts:check
npm run docs:check
```

If the change touches Python SDK behavior, also run targeted Python tests.

If the change touches JS contract validation, run targeted Vitest contract tests.

## Good Candidate Files For Workflow Slice

- `contracts/api/workflows-templates.json` (removed in the v5.0.0 cull)
- [public-surface.json](../../contracts/sdk/public-surface.json)
- [check-sdk-surface.mjs](../../scripts/lib/contracts/check-sdk-surface.mjs)
- [client.py](../../sdk-python/dashclaw/client.py)
- [sdk-parity.md](../sdk-parity.md)

## Commit Discipline

Prefer one domain per commit.

Good examples:

- `feat: converge python sdk workflows surface`
- `feat: converge python sdk model strategy surface`
- `feat: converge python sdk knowledge surface`

## Product Judgment To Preserve

Optimize for:

- explicit contracts
- route-contract parity
- CI-detectable drift
- small, explainable slices

Do not optimize for:

- big parity sweeps
- adding new product concepts
- duplicating Node naming in Python when Python already has stable `snake_case`

## If Something Fails Unexpectedly

First question:

- is this a real product bug, or a sandbox / process / environment issue?

Recent examples:

- Vitest can throw Windows sandbox `spawn EPERM` and still pass fine outside sandbox
- Python `unittest` can fail in-sandbox with access errors unrelated to repo correctness

If that happens:

- rerun with escalation if needed
- do not confuse harness issues with repo regressions
