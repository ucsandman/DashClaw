# Livingcode Subsystem

Date: 2026-04-10
Status: Active
Owner: DashClaw internal infrastructure

## Purpose

`livingcode/` is DashClaw's internal codebase self-monitoring subsystem.

It is not a customer-facing product surface. It is the organism layer that inspects DashClaw's own repository, records structured health snapshots, proposes maintenance work, and produces review verdicts without autonomously changing code.

In plain terms, `livingcode` helps DashClaw watch itself.

## Core stance

The subsystem is intentionally conservative.

It can:
- sense repository health
- compare current state against standards and baselines
- generate backlog items
- produce review verdicts
- maintain runtime state in `.organism/`

It cannot:
- autonomously modify code
- autonomously modify `organism.json`
- autonomously modify `.organism/`
- act as a build or refactor engine

That boundary is explicit in `organism.json` and is central to the design.

## Main components

### 1. `organism.json`
DashClaw's self-identity and ruleset.

It defines:
- identity and purpose
- growth zone and forbidden zone
- quality standards
- CI gates
- lifecycle config

Important rule:
- `modifying organism.json or .organism/ autonomously` is in the forbidden zone

### 2. `livingcode/`
The Python framework that runs the organism loop.

Key modules:
- `collectors/` — sensing inputs
- `immune/` — checks and verdict generation
- `planner/` — work-item generation and backlog persistence
- `orchestrator/` — full lifecycle execution and safety systems
- `heartbeat/` — lightweight and full heartbeat modes
- `state.py` — filesystem operations for `.organism/`
- `types.py` — dataclasses for reports, checks, work items, and cycle results
- `__main__.py` — CLI entrypoint

### 3. `.organism/`
Runtime state directory at the repo root.

Current important contents:
- `state-reports/` — raw sensing snapshots
- `backlog/` — proposed work items
- `cycle-history/` — completed cycle records
- `heartbeats/` — quick heartbeat snapshots
- `baselines.json` — current baseline metrics
- `cycle-counter.json` — monotonic cycle count
- `consecutive-failures.json` — failure streak tracker

Treat this as organism-owned state, not hand-edited documentation.

## Lifecycle model

The organism runs a supervised lifecycle:

1. **SENSE**
   - Runs all collectors
   - Produces a unified `StateReport`
   - Writes a timestamped report to `.organism/state-reports/`

2. **PLAN**
   - Converts sensing results into structured work items
   - Writes backlog items to `.organism/backlog/`

3. **REVIEW**
   - Runs immune-system checks against baselines and quality rules
   - Produces a verdict such as `merge`, `fix_required`, or `needs_discussion`

4. **REFLECT**
   - Updates baselines
   - records cycle history
   - tracks failures / pause conditions / locks

There is deliberately **no BUILD phase** in the current subsystem.

## Collectors

`livingcode` currently uses five collectors:

1. `git_stats`
   - commit velocity
   - branch health
   - contributor concentration
   - bus factor

2. `test_health`
   - JS and Python test counts
   - pass/fail status
   - test-file ratio
   - untested route discovery

3. `code_quality`
   - oversized files
   - largest files
   - lint status
   - TODO/FIXME count
   - archive size

4. `dependency_health`
   - dependency counts
   - outdated packages
   - npm audit exposure
   - Python dependency surface

5. `ci_health`
   - CI pass rate
   - recent runs
   - failure reason
   - workflow gate awareness

Collector failures are isolated so one bad collector does not destroy the whole sensing pass.

## Immune system

The immune layer turns raw sensing into judgment.

Responsibilities:
- compare current metrics to baselines
- check hard safety expectations
- distinguish warnings from blocking problems
- generate a review recommendation

The current role of the immune system is review, not enforcement of code edits.

## Safety systems

The orchestrator includes safety controls to prevent runaway behavior:
- kill switch
- cycle lock
- consecutive failure tracking
- paused state after repeated failure

This is important because the subsystem is allowed to observe frequently and persist state, but it is not allowed to self-escalate into uncontrolled action.

## CLI surface

The supported command surface is Python-based:

- `python -m livingcode sense`
- `python -m livingcode plan`
- `python -m livingcode review`
- `python -m livingcode cycle`
- `python -m livingcode heartbeat --mode quick|full`
- `python -m livingcode status`
- `python -m livingcode query [routes|archived-routes|env|tables|summary|all]` — query the codebase shape
- `python -m livingcode snapshot` — save the current shape snapshot to `.organism/`
- `python -m livingcode diff` — diff the current shape vs the last snapshot
- `python -m livingcode emit [skill|shape-json|doctor-checks|mcp-tools|dashboard] [--output <path>]` — generate derivative artifacts
- `python -m livingcode start [--no-open]` — sense + snapshot + refresh + open the dashboard

`--path` can be supplied before or after the subcommand.

Example:

```powershell
python -m livingcode sense --path C:\Projects\DashClaw
```

## What the subsystem is for

Good uses:
- seeing current repo health quickly
- spotting structural drift
- tracking repeated debt signals
- generating maintenance backlog candidates
- identifying low-risk documentation and test opportunities
- creating a durable state trail for later governance

Bad uses:
- automatic refactors
- file deletion
- archive cleanup without review
- changing core runtime files autonomously
- mixing foreign organism report formats into this subsystem without validation

## Relationship to governed maintenance

`livingcode` is the sensing and planning layer for a future governed maintenance loop.

The intended higher-order pattern is:

1. organism senses and proposes
2. MoltFire interprets and classifies work
3. DashClaw governance decides what is allowed
4. Claude Code or another executor performs only approved bounded work
5. organism measures the result afterward

That means `livingcode` should remain cleanly separable from the executor layer. It should produce signal, not hidden mutation.

## Current practical reading of the subsystem

As of the active organism stream:
- the subsystem is healthy operationally
- the main recurring structural pressure is oversized files and backlog debt
- backlog items like subsystem documentation, TODO triage, and narrow isolated tests are the safest first maintenance targets
- large file splits, archive cleanup, and core governance/runtime edits should remain outside autonomous scope

## References

- `organism.json`
- `livingcode/__main__.py`
- `livingcode/sensing.py`
- `livingcode/state.py`
- `livingcode/orchestrator/cycle.py`
- `docs/architecture/capabilities.md`
- `docs/superpowers/specs/2026-04-07-livingcode-organism-design.md`
