---
source-of-truth: false
owner: API Governance Lead
last-verified: 2026-02-13
doc-type: architecture
---

# API Inventory

- Source: `app/api/**/route.js`
- Artifact: `docs/api-inventory.json`
- Maturity levels: `stable`, `beta`, `experimental`

## Summary

- Total routes: `134`
- Stable routes: `44`
- Beta routes: `16`
- Experimental routes: `74`

## Routes

| Path | Methods | Maturity | Rule Prefix | File |
|---|---|---|---|---|
| `/api/actions` | `DELETE, GET, POST` | `stable` | `/api/actions` | `app/api/actions/route.js` |
| `/api/actions/assumptions` | `GET, POST` | `stable` | `/api/actions` | `app/api/actions/assumptions/route.js` |
| `/api/actions/assumptions/{assumptionId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/assumptions/[assumptionId]/route.js` |
| `/api/actions/loops` | `GET, POST` | `stable` | `/api/actions` | `app/api/actions/loops/route.js` |
| `/api/actions/loops/{loopId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/loops/[loopId]/route.js` |
| `/api/actions/signals` | `GET` | `stable` | `/api/actions` | `app/api/actions/signals/route.js` |
| `/api/actions/{actionId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/[actionId]/route.js` |
| `/api/actions/{actionId}/approve` | `POST` | `stable` | `/api/actions` | `app/api/actions/[actionId]/approve/route.js` |
| `/api/actions/{actionId}/trace` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/trace/route.js` |
| `/api/activity` | `GET` | `beta` | `/api/activity` | `app/api/activity/route.js` |
| `/api/agent-schedules` | `GET, POST` | `experimental` | `(default)` | `app/api/agent-schedules/route.js` |
| `/api/agents` | `GET` | `experimental` | `/api/agents` | `app/api/agents/route.js` |
| `/api/agents/connections` | `GET, POST` | `experimental` | `/api/agents` | `app/api/agents/connections/route.js` |
| `/api/agents/heartbeat` | `POST` | `experimental` | `/api/agents` | `app/api/agents/heartbeat/route.js` |
| `/api/auth/config` | `GET` | `beta` | `/api/auth` | `app/api/auth/config/route.js` |
| `/api/bounties` | `GET` | `experimental` | `/api/bounties` | `app/api/bounties/route.js` |
| `/api/bug-hunter` | `GET, POST` | `experimental` | `(default)` | `app/api/bug-hunter/route.js` |
| `/api/calendar` | `GET, POST` | `experimental` | `/api/calendar` | `app/api/calendar/route.js` |
| `/api/compliance/evidence` | `GET` | `experimental` | `(default)` | `app/api/compliance/evidence/route.js` |
| `/api/compliance/exports` | `GET, POST` | `experimental` | `(default)` | `app/api/compliance/exports/route.js` |
| `/api/compliance/exports/{exportId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/compliance/exports/[exportId]/route.js` |
| `/api/compliance/exports/{exportId}/download` | `GET` | `experimental` | `(default)` | `app/api/compliance/exports/[exportId]/download/route.js` |
| `/api/compliance/frameworks` | `GET` | `experimental` | `(default)` | `app/api/compliance/frameworks/route.js` |
| `/api/compliance/gaps` | `GET` | `experimental` | `(default)` | `app/api/compliance/gaps/route.js` |
| `/api/compliance/map` | `GET` | `experimental` | `(default)` | `app/api/compliance/map/route.js` |
| `/api/compliance/report` | `GET` | `experimental` | `(default)` | `app/api/compliance/report/route.js` |
| `/api/compliance/schedules` | `GET, POST` | `experimental` | `(default)` | `app/api/compliance/schedules/route.js` |
| `/api/compliance/schedules/{scheduleId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/compliance/schedules/[scheduleId]/route.js` |
| `/api/compliance/trends` | `GET` | `experimental` | `(default)` | `app/api/compliance/trends/route.js` |
| `/api/content` | `GET, POST` | `experimental` | `/api/content` | `app/api/content/route.js` |
| `/api/context/points` | `GET, POST` | `stable` | `/api/context` | `app/api/context/points/route.js` |
| `/api/context/threads` | `GET, POST` | `stable` | `/api/context` | `app/api/context/threads/route.js` |
| `/api/context/threads/{threadId}` | `GET, PATCH` | `stable` | `/api/context` | `app/api/context/threads/[threadId]/route.js` |
| `/api/context/threads/{threadId}/entries` | `POST` | `stable` | `/api/context` | `app/api/context/threads/[threadId]/entries/route.js` |
| `/api/cron/learning-episodes-backfill` | `GET` | `beta` | `/api/cron` | `app/api/cron/learning-episodes-backfill/route.js` |
| `/api/cron/learning-recommendations` | `GET` | `beta` | `/api/cron` | `app/api/cron/learning-recommendations/route.js` |
| `/api/cron/memory-maintenance` | `GET` | `beta` | `/api/cron` | `app/api/cron/memory-maintenance/route.js` |
| `/api/cron/routing-maintenance` | `POST` | `beta` | `/api/cron` | `app/api/cron/routing-maintenance/route.js` |
| `/api/cron/signals` | `GET` | `beta` | `/api/cron` | `app/api/cron/signals/route.js` |
| `/api/digest` | `GET` | `experimental` | `(default)` | `app/api/digest/route.js` |
| `/api/docs/raw` | `GET` | `beta` | `/api/docs` | `app/api/docs/raw/route.js` |
| `/api/drift/alerts` | `GET, POST` | `experimental` | `(default)` | `app/api/drift/alerts/route.js` |
| `/api/drift/alerts/{alertId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/drift/alerts/[alertId]/route.js` |
| `/api/drift/metrics` | `GET` | `experimental` | `(default)` | `app/api/drift/metrics/route.js` |
| `/api/drift/snapshots` | `GET` | `experimental` | `(default)` | `app/api/drift/snapshots/route.js` |
| `/api/drift/stats` | `GET` | `experimental` | `(default)` | `app/api/drift/stats/route.js` |
| `/api/evaluations` | `GET, POST` | `experimental` | `(default)` | `app/api/evaluations/route.js` |
| `/api/evaluations/runs` | `GET, POST` | `experimental` | `(default)` | `app/api/evaluations/runs/route.js` |
| `/api/evaluations/runs/{runId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/evaluations/runs/[runId]/route.js` |
| `/api/evaluations/scorers` | `GET, POST` | `experimental` | `(default)` | `app/api/evaluations/scorers/route.js` |
| `/api/evaluations/scorers/{scorerId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/evaluations/scorers/[scorerId]/route.js` |
| `/api/evaluations/stats` | `GET` | `experimental` | `(default)` | `app/api/evaluations/stats/route.js` |
| `/api/feedback` | `GET, POST` | `experimental` | `(default)` | `app/api/feedback/route.js` |
| `/api/feedback/stats` | `GET` | `experimental` | `(default)` | `app/api/feedback/stats/route.js` |
| `/api/feedback/{feedbackId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/feedback/[feedbackId]/route.js` |
| `/api/goals` | `GET, POST` | `experimental` | `(default)` | `app/api/goals/route.js` |
| `/api/guard` | `GET, POST` | `stable` | `/api/guard` | `app/api/guard/route.js` |
| `/api/handoffs` | `GET, POST` | `stable` | `/api/handoffs` | `app/api/handoffs/route.js` |
| `/api/health` | `GET` | `stable` | `/api/health` | `app/api/health/route.js` |
| `/api/identities` | `GET, POST` | `experimental` | `/api/identities` | `app/api/identities/route.js` |
| `/api/inspiration` | `GET, POST` | `experimental` | `/api/inspiration` | `app/api/inspiration/route.js` |
| `/api/invite/{token}` | `GET, POST` | `stable` | `/api/invite` | `app/api/invite/[token]/route.js` |
| `/api/keys` | `DELETE, GET, POST` | `stable` | `/api/keys` | `app/api/keys/route.js` |
| `/api/learning` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/route.js` |
| `/api/learning/analytics/curves` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/analytics/curves/route.js` |
| `/api/learning/analytics/maturity` | `GET` | `experimental` | `/api/learning` | `app/api/learning/analytics/maturity/route.js` |
| `/api/learning/analytics/summary` | `GET` | `experimental` | `/api/learning` | `app/api/learning/analytics/summary/route.js` |
| `/api/learning/analytics/velocity` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/analytics/velocity/route.js` |
| `/api/learning/recommendations` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/recommendations/route.js` |
| `/api/learning/recommendations/events` | `POST` | `experimental` | `/api/learning` | `app/api/learning/recommendations/events/route.js` |
| `/api/learning/recommendations/metrics` | `GET` | `experimental` | `/api/learning` | `app/api/learning/recommendations/metrics/route.js` |
| `/api/learning/recommendations/{recommendationId}` | `PATCH` | `experimental` | `/api/learning` | `app/api/learning/recommendations/[recommendationId]/route.js` |
| `/api/memory` | `GET, POST` | `stable` | `/api/memory` | `app/api/memory/route.js` |
| `/api/messages` | `GET, PATCH, POST` | `stable` | `/api/messages` | `app/api/messages/route.js` |
| `/api/messages/attachments` | `GET` | `stable` | `/api/messages` | `app/api/messages/attachments/route.js` |
| `/api/messages/docs` | `GET, POST` | `stable` | `/api/messages` | `app/api/messages/docs/route.js` |
| `/api/messages/threads` | `GET, PATCH, POST` | `stable` | `/api/messages` | `app/api/messages/threads/route.js` |
| `/api/notifications` | `GET, POST` | `beta` | `/api/notifications` | `app/api/notifications/route.js` |
| `/api/onboarding/api-key` | `POST` | `beta` | `/api/onboarding` | `app/api/onboarding/api-key/route.js` |
| `/api/onboarding/status` | `GET` | `beta` | `/api/onboarding` | `app/api/onboarding/status/route.js` |
| `/api/onboarding/workspace` | `POST` | `beta` | `/api/onboarding` | `app/api/onboarding/workspace/route.js` |
| `/api/orgs` | `GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/route.js` |
| `/api/orgs/{orgId}` | `GET, PATCH` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/route.js` |
| `/api/orgs/{orgId}/keys` | `DELETE, GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/keys/route.js` |
| `/api/pairings` | `GET, POST` | `experimental` | `(default)` | `app/api/pairings/route.js` |
| `/api/pairings/{pairingId}` | `GET` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/route.js` |
| `/api/pairings/{pairingId}/approve` | `POST` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/approve/route.js` |
| `/api/policies` | `DELETE, GET, PATCH, POST` | `stable` | `/api/policies` | `app/api/policies/route.js` |
| `/api/policies/import` | `POST` | `stable` | `/api/policies` | `app/api/policies/import/route.js` |
| `/api/policies/proof` | `GET` | `stable` | `/api/policies` | `app/api/policies/proof/route.js` |
| `/api/policies/simulate` | `POST` | `stable` | `/api/policies` | `app/api/policies/simulate/route.js` |
| `/api/policies/test` | `POST` | `stable` | `/api/policies` | `app/api/policies/test/route.js` |
| `/api/preferences` | `GET, POST` | `experimental` | `(default)` | `app/api/preferences/route.js` |
| `/api/prompts/agent-connect/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/agent-connect/raw/route.js` |
| `/api/prompts/render` | `POST` | `experimental` | `(default)` | `app/api/prompts/render/route.js` |
| `/api/prompts/runs` | `GET` | `experimental` | `(default)` | `app/api/prompts/runs/route.js` |
| `/api/prompts/server-setup/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/server-setup/raw/route.js` |
| `/api/prompts/stats` | `GET` | `experimental` | `(default)` | `app/api/prompts/stats/route.js` |
| `/api/prompts/templates` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/route.js` |
| `/api/prompts/templates/{templateId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/route.js` |
| `/api/prompts/templates/{templateId}/versions` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/versions/route.js` |
| `/api/prompts/templates/{templateId}/versions/{versionId}` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/versions/[versionId]/route.js` |
| `/api/relationships` | `GET, POST` | `experimental` | `/api/relationships` | `app/api/relationships/route.js` |
| `/api/routing/agents` | `GET, POST` | `experimental` | `(default)` | `app/api/routing/agents/route.js` |
| `/api/routing/agents/{agentId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/routing/agents/[agentId]/route.js` |
| `/api/routing/health` | `GET` | `experimental` | `(default)` | `app/api/routing/health/route.js` |
| `/api/routing/stats` | `GET` | `experimental` | `(default)` | `app/api/routing/stats/route.js` |
| `/api/routing/tasks` | `GET, POST` | `experimental` | `(default)` | `app/api/routing/tasks/route.js` |
| `/api/routing/tasks/{taskId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/routing/tasks/[taskId]/route.js` |
| `/api/routing/tasks/{taskId}/complete` | `POST` | `experimental` | `(default)` | `app/api/routing/tasks/[taskId]/complete/route.js` |
| `/api/schedules` | `GET` | `experimental` | `/api/schedules` | `app/api/schedules/route.js` |
| `/api/security/prompt-injection` | `GET, POST` | `beta` | `/api/security` | `app/api/security/prompt-injection/route.js` |
| `/api/security/scan` | `POST` | `beta` | `/api/security` | `app/api/security/scan/route.js` |
| `/api/security/status` | `GET` | `beta` | `/api/security` | `app/api/security/status/route.js` |
| `/api/settings` | `DELETE, GET, POST` | `stable` | `/api/settings` | `app/api/settings/route.js` |
| `/api/settings/llm-status` | `GET` | `stable` | `/api/settings` | `app/api/settings/llm-status/route.js` |
| `/api/settings/test` | `POST` | `stable` | `/api/settings` | `app/api/settings/test/route.js` |
| `/api/setup/status` | `GET` | `beta` | `/api/setup` | `app/api/setup/status/route.js` |
| `/api/snippets` | `DELETE, GET, POST` | `stable` | `/api/snippets` | `app/api/snippets/route.js` |
| `/api/snippets/{snippetId}` | `GET` | `stable` | `/api/snippets` | `app/api/snippets/[snippetId]/route.js` |
| `/api/snippets/{snippetId}/use` | `POST` | `stable` | `/api/snippets` | `app/api/snippets/[snippetId]/use/route.js` |
| `/api/stream` | `GET` | `experimental` | `(default)` | `app/api/stream/route.js` |
| `/api/swarm/graph` | `GET` | `experimental` | `/api/swarm` | `app/api/swarm/graph/route.js` |
| `/api/sync` | `POST` | `experimental` | `(default)` | `app/api/sync/route.js` |
| `/api/team` | `GET` | `stable` | `/api/team` | `app/api/team/route.js` |
| `/api/team/invite` | `DELETE, GET, POST` | `stable` | `/api/team` | `app/api/team/invite/route.js` |
| `/api/team/{userId}` | `DELETE, PATCH` | `stable` | `/api/team` | `app/api/team/[userId]/route.js` |
| `/api/tokens` | `GET, POST` | `experimental` | `/api/tokens` | `app/api/tokens/route.js` |
| `/api/tokens/budget` | `GET, PUT` | `experimental` | `/api/tokens` | `app/api/tokens/budget/route.js` |
| `/api/usage` | `GET` | `stable` | `/api/usage` | `app/api/usage/route.js` |
| `/api/webhooks` | `DELETE, GET, POST` | `stable` | `/api/webhooks` | `app/api/webhooks/route.js` |
| `/api/webhooks/{webhookId}/deliveries` | `GET` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/deliveries/route.js` |
| `/api/webhooks/{webhookId}/test` | `POST` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/test/route.js` |
| `/api/workflows` | `GET` | `experimental` | `/api/workflows` | `app/api/workflows/route.js` |

