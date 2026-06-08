---
name: build-dashclaw
description: Contribute to the DashClaw codebase — architecture, scaffolding, tests, CI
license: MIT
metadata:
  author: ucsandman
  version: "1.0.0"
  category: development
---

# Build DashClaw

Guide for contributing to the DashClaw codebase. Covers architecture, adding new capabilities, testing, and CI.

## Architecture Overview

DashClaw is organized into 3 tiers:

### Tier 1: Core Runtime (`app/api/`)
7 mandatory endpoints that define DashClaw's governance category:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/guard` | POST | Policy evaluation — "can I do this?" |
| `/api/actions` | POST, PATCH, GET | Action lifecycle recording |
| `/api/approvals` | POST | Human approval decisions |
| `/api/assumptions` | POST, GET | Reasoning integrity tracking |
| `/api/signals` | GET | Real-time anomaly detection |
| `/api/policies` | GET, POST | Guard policy management |
| `/api/health` | GET | System readiness |

**The 7-route boundary is CI-enforced.** Adding a new core route requires justification.

### Tier 2: Extensions (`app/(extensions)/`)
Modular operational intelligence:
- Compliance, Drift, Evaluations, Scoring, Prompts, Webhooks, Learning

### Tier 3: Archived (`app/api/_archive/`)
Legacy features from the "Agent Platform" era. Physically isolated.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ |
| Framework | Next.js 16 (App Router) |
| Database | Postgres (Neon recommended) |
| ORM | Drizzle ORM |
| Auth | NextAuth.js v4 |
| UI | React 18, Tailwind CSS 3 |
| Testing | Vitest + jsdom |
| Package Manager | npm |

## Key Conventions

### TEXT Primary Keys
All IDs are TEXT with crypto-random prefixed values:
```javascript
import { randomBytes } from 'crypto';
const id = `act_${randomBytes(16).toString('hex')}`;
```

ID prefixes: `ar_` (actions), `oc_live_`/`oc_test_` (API keys), `sp_` (scoring profiles), `pt_` (prompt templates), etc.

### Repository Pattern
**No direct SQL in route handlers.** All data access goes through repository modules:
```
app/lib/repositories/*.repository.js
```

Route handlers import from repositories, never inline SQL.

### Auth Chain
```
Request → Strip client org headers → Rate limit → Route matching
  → Public routes: pass through
  → Protected routes: x-api-key (fast path: timing-safe compare)
    → Inject org context from resolved key
```

## 12-Step Scaffold for New Capabilities

When adding a new feature to DashClaw:

1. **Migration** — Add table with TEXT PKs and crypto-random IDs
2. **Repository** — Create `app/lib/repositories/<name>.repository.js` (all SQL here)
3. **Lib module** — Create `app/lib/<name>.js` (business logic)
4. **Route handler** — Create `app/api/<name>/route.js` (imports from repository)
5. **Demo fixtures** — Add fixture data if the feature needs demo mode support
6. **Demo middleware** — Wire fixtures into demo mode if needed
7. **Node SDK method** — Add to `sdk/dashclaw.js` (camelCase)
8. **Python SDK method** — Add to `sdk-python/dashclaw/client.py` (snake_case)
9. **Docs page** — Create dashboard page or update existing docs
10. **Node README** — Add method to SDK README
11. **Python README** — Add method to Python SDK README
12. **Parity matrix** — Update `docs/sdk-parity.md` with new method counts

## Legacy SDK Promotion

The v1 SDK has 187 methods across 31 categories. When promoting to v2:

**High priority (core governance):**
- `registerOpenLoop()` + `resolveOpenLoop()` — Decision integrity
- `events()` — Real-time SSE events
- `heartbeat()` + `startHeartbeat()` — Agent telemetry

**Medium priority (analytics):**
- `getRecommendations()` + `recommendAction()` — Adaptive learning
- `getLearningVelocity()` + `getLearningCurves()` — Learning analytics
- `getSignals()` — Decision integrity signals

See `knowledge/legacy-sdk-reference.md` for the full inventory with all method signatures.

## Testing

```bash
# Run all tests (watch mode)
npm run test

# Run tests once (CI mode)
npm run test -- --run

# Run specific test file
npx vitest run app/lib/__tests__/guard.test.js
```

Tests live alongside their modules or in `__tests__/` directories.

## CI Checks

Three mandatory CI checks:

```bash
# 1. Governance boundary — enforces 7-route API limit
npm run governance:boundary:check

# 2. OpenAPI contract — detects API drift
npm run openapi:check

# 3. Tests
npm run test -- --run
```

All three must pass before merge.

## Key Files for Contributors

| File | What to Read |
|------|-------------|
| `PROJECT_DETAILS.md` | Canonical system map (source of truth) |
| `CLAUDE.md` | Contributing conventions |
| `app/lib/guard.js` | Risk scoring engine |
| `app/lib/signals.js` | Anomaly detection logic |
| `sdk/dashclaw.js` | V2 SDK implementation |
| `sdk/legacy/dashclaw-v1.js` | V1 SDK (187 methods) |
| `schema/schema.js` | Database schema (Drizzle) |
| `middleware.js` | Auth chain |
| `docs/sdk-parity.md` | SDK method parity matrix |

## Contributing Workflow

1. Read `PROJECT_DETAILS.md` and `CLAUDE.md`
2. Understand the 3-tier boundary (core vs extension vs archived)
3. Follow the 12-step scaffold if adding a new capability
4. Match existing patterns (repository pattern, TEXT PKs, etc.)
5. Run all three CI checks locally before committing
6. Keep SDK parity: if you add a Node method, add the Python equivalent
