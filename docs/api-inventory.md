---
source-of-truth: false
owner: API Governance Lead
last-verified: 2026-05-14
doc-type: architecture
---

# API Inventory

- Source: `app/api/**/route.js`
- Artifact: `docs/api-inventory.json`
- Maturity levels: `stable`, `beta`, `experimental`

## Summary

- Total routes: `250`
- Stable routes: `42`
- Beta routes: `23`
- Experimental routes: `185`

## Routes

| Path | Methods | Maturity | Rule Prefix | File |
|---|---|---|---|---|
| `/api/_archive/agent-schedules` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/agent-schedules/route.js` |
| `/api/_archive/bounties` | `GET` | `experimental` | `(default)` | `app/api/_archive/bounties/route.js` |
| `/api/_archive/bug-hunter` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/bug-hunter/route.js` |
| `/api/_archive/calendar` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/calendar/route.js` |
| `/api/_archive/content` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/content/route.js` |
| `/api/_archive/context/points` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/context/points/route.js` |
| `/api/_archive/context/threads` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/context/threads/route.js` |
| `/api/_archive/context/threads/{threadId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/_archive/context/threads/[threadId]/route.js` |
| `/api/_archive/context/threads/{threadId}/entries` | `POST` | `experimental` | `(default)` | `app/api/_archive/context/threads/[threadId]/entries/route.js` |
| `/api/_archive/digest` | `GET` | `experimental` | `(default)` | `app/api/_archive/digest/route.js` |
| `/api/_archive/docs/raw` | `GET` | `experimental` | `(default)` | `app/api/_archive/docs/raw/route.js` |
| `/api/_archive/feedback` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/feedback/route.js` |
| `/api/_archive/feedback/stats` | `GET` | `experimental` | `(default)` | `app/api/_archive/feedback/stats/route.js` |
| `/api/_archive/feedback/{feedbackId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/_archive/feedback/[feedbackId]/route.js` |
| `/api/_archive/goals` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/goals/route.js` |
| `/api/_archive/handoffs` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/handoffs/route.js` |
| `/api/_archive/identities` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/identities/route.js` |
| `/api/_archive/inspiration` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/inspiration/route.js` |
| `/api/_archive/invite/{token}` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/invite/[token]/route.js` |
| `/api/_archive/memory` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/memory/route.js` |
| `/api/_archive/messages` | `GET, PATCH, POST` | `experimental` | `(default)` | `app/api/_archive/messages/route.js` |
| `/api/_archive/messages/attachments` | `GET` | `experimental` | `(default)` | `app/api/_archive/messages/attachments/route.js` |
| `/api/_archive/messages/docs` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/messages/docs/route.js` |
| `/api/_archive/messages/threads` | `GET, PATCH, POST` | `experimental` | `(default)` | `app/api/_archive/messages/threads/route.js` |
| `/api/_archive/notifications` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/notifications/route.js` |
| `/api/_archive/onboarding/api-key` | `POST` | `experimental` | `(default)` | `app/api/_archive/onboarding/api-key/route.js` |
| `/api/_archive/onboarding/status` | `GET` | `experimental` | `(default)` | `app/api/_archive/onboarding/status/route.js` |
| `/api/_archive/onboarding/workspace` | `POST` | `experimental` | `(default)` | `app/api/_archive/onboarding/workspace/route.js` |
| `/api/_archive/pairings` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/pairings/route.js` |
| `/api/_archive/pairings/{pairingId}` | `GET` | `experimental` | `(default)` | `app/api/_archive/pairings/[pairingId]/route.js` |
| `/api/_archive/pairings/{pairingId}/approve` | `POST` | `experimental` | `(default)` | `app/api/_archive/pairings/[pairingId]/approve/route.js` |
| `/api/_archive/preferences` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/preferences/route.js` |
| `/api/_archive/relationships` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/relationships/route.js` |
| `/api/_archive/routing/agents` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/routing/agents/route.js` |
| `/api/_archive/routing/agents/{agentId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/_archive/routing/agents/[agentId]/route.js` |
| `/api/_archive/routing/health` | `GET` | `experimental` | `(default)` | `app/api/_archive/routing/health/route.js` |
| `/api/_archive/routing/stats` | `GET` | `experimental` | `(default)` | `app/api/_archive/routing/stats/route.js` |
| `/api/_archive/routing/tasks` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/routing/tasks/route.js` |
| `/api/_archive/routing/tasks/{taskId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/_archive/routing/tasks/[taskId]/route.js` |
| `/api/_archive/routing/tasks/{taskId}/complete` | `POST` | `experimental` | `(default)` | `app/api/_archive/routing/tasks/[taskId]/complete/route.js` |
| `/api/_archive/schedules` | `GET` | `experimental` | `(default)` | `app/api/_archive/schedules/route.js` |
| `/api/_archive/snippets` | `DELETE, GET, POST` | `experimental` | `(default)` | `app/api/_archive/snippets/route.js` |
| `/api/_archive/snippets/{snippetId}` | `GET` | `experimental` | `(default)` | `app/api/_archive/snippets/[snippetId]/route.js` |
| `/api/_archive/snippets/{snippetId}/use` | `POST` | `experimental` | `(default)` | `app/api/_archive/snippets/[snippetId]/use/route.js` |
| `/api/_archive/sync` | `POST` | `experimental` | `(default)` | `app/api/_archive/sync/route.js` |
| `/api/_archive/tokens` | `GET, POST` | `experimental` | `(default)` | `app/api/_archive/tokens/route.js` |
| `/api/_archive/tokens/budget` | `GET, PUT` | `experimental` | `(default)` | `app/api/_archive/tokens/budget/route.js` |
| `/api/_archive/workflows` | `GET` | `experimental` | `(default)` | `app/api/_archive/workflows/route.js` |
| `/api/actions` | `DELETE, GET, POST` | `stable` | `/api/actions` | `app/api/actions/route.js` |
| `/api/actions/costs` | `GET` | `stable` | `/api/actions` | `app/api/actions/costs/route.js` |
| `/api/actions/loops` | `GET, POST` | `stable` | `/api/actions` | `app/api/actions/loops/route.js` |
| `/api/actions/loops/{loopId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/loops/[loopId]/route.js` |
| `/api/actions/stats` | `GET` | `stable` | `/api/actions` | `app/api/actions/stats/route.js` |
| `/api/actions/{actionId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/[actionId]/route.js` |
| `/api/actions/{actionId}/artifacts` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/artifacts/route.js` |
| `/api/actions/{actionId}/graph` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/graph/route.js` |
| `/api/actions/{actionId}/messages` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/messages/route.js` |
| `/api/actions/{actionId}/outcome` | `GET, POST` | `stable` | `/api/actions` | `app/api/actions/[actionId]/outcome/route.js` |
| `/api/actions/{actionId}/trace` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/trace/route.js` |
| `/api/activity` | `GET` | `beta` | `/api/activity` | `app/api/activity/route.js` |
| `/api/agents` | `GET` | `experimental` | `/api/agents` | `app/api/agents/route.js` |
| `/api/agents/connections` | `GET, POST` | `experimental` | `/api/agents` | `app/api/agents/connections/route.js` |
| `/api/agents/heartbeat` | `POST` | `experimental` | `/api/agents` | `app/api/agents/heartbeat/route.js` |
| `/api/agents/{agentId}` | `GET` | `experimental` | `/api/agents` | `app/api/agents/[agentId]/route.js` |
| `/api/agents/{agentId}/profile` | `GET` | `experimental` | `/api/agents` | `app/api/agents/[agentId]/profile/route.js` |
| `/api/analytics` | `GET` | `experimental` | `(default)` | `app/api/analytics/route.js` |
| `/api/approvals/{actionId}` | `POST` | `experimental` | `(default)` | `app/api/approvals/[actionId]/route.js` |
| `/api/artifacts` | `GET, POST` | `experimental` | `(default)` | `app/api/artifacts/route.js` |
| `/api/artifacts/evidence-bundle` | `POST` | `experimental` | `(default)` | `app/api/artifacts/evidence-bundle/route.js` |
| `/api/artifacts/{artifactId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/artifacts/[artifactId]/route.js` |
| `/api/assumptions` | `GET, POST` | `experimental` | `(default)` | `app/api/assumptions/route.js` |
| `/api/assumptions/{assumptionId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/assumptions/[assumptionId]/route.js` |
| `/api/auth/config` | `GET` | `beta` | `/api/auth` | `app/api/auth/config/route.js` |
| `/api/auth/local` | `DELETE, POST` | `beta` | `/api/auth` | `app/api/auth/local/route.js` |
| `/api/billing/checkout` | `POST` | `experimental` | `(default)` | `app/api/billing/checkout/route.js` |
| `/api/billing/portal` | `GET` | `experimental` | `(default)` | `app/api/billing/portal/route.js` |
| `/api/capabilities` | `GET, POST` | `experimental` | `(default)` | `app/api/capabilities/route.js` |
| `/api/capabilities/health` | `GET` | `experimental` | `(default)` | `app/api/capabilities/health/route.js` |
| `/api/capabilities/{capabilityId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/route.js` |
| `/api/capabilities/{capabilityId}/access` | `GET, POST` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/access/route.js` |
| `/api/capabilities/{capabilityId}/access/check` | `GET` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/access/check/route.js` |
| `/api/capabilities/{capabilityId}/access/{ruleId}` | `DELETE` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/access/[ruleId]/route.js` |
| `/api/capabilities/{capabilityId}/health` | `GET` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/health/route.js` |
| `/api/capabilities/{capabilityId}/history` | `GET` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/history/route.js` |
| `/api/capabilities/{capabilityId}/invoke` | `POST` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/invoke/route.js` |
| `/api/capabilities/{capabilityId}/test` | `POST` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/test/route.js` |
| `/api/code-sessions/alerts` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/alerts/route.js` |
| `/api/code-sessions/alerts/read-all` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/alerts/read-all/route.js` |
| `/api/code-sessions/ingest-jsonl` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/ingest-jsonl/route.js` |
| `/api/code-sessions/ingest-live` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/ingest-live/route.js` |
| `/api/code-sessions/manifests/{manifestId}` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/manifests/[manifestId]/route.js` |
| `/api/code-sessions/memos` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/memos/route.js` |
| `/api/code-sessions/memos/regenerate` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/memos/regenerate/route.js` |
| `/api/code-sessions/projects` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/projects/route.js` |
| `/api/code-sessions/projects/{projectId}/sessions` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/projects/[projectId]/sessions/route.js` |
| `/api/code-sessions/sessions/{sessionId}` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/route.js` |
| `/api/code-sessions/sessions/{sessionId}/autopsy` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/autopsy/route.js` |
| `/api/code-sessions/sessions/{sessionId}/insights` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/insights/route.js` |
| `/api/code-sessions/sessions/{sessionId}/optimal-files/manifest` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/optimal-files/manifest/route.js` |
| `/api/code-sessions/sessions/{sessionId}/optimal-files/merge-preview` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/optimal-files/merge-preview/route.js` |
| `/api/code-sessions/sessions/{sessionId}/optimal-files/preview` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/optimal-files/preview/route.js` |
| `/api/code-sessions/subagent-roi` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/subagent-roi/route.js` |
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
| `/api/cron/code-session-cache-crater` | `GET` | `beta` | `/api/cron` | `app/api/cron/code-session-cache-crater/route.js` |
| `/api/cron/code-session-weekly-memo` | `GET` | `beta` | `/api/cron` | `app/api/cron/code-session-weekly-memo/route.js` |
| `/api/cron/integration-health` | `GET` | `beta` | `/api/cron` | `app/api/cron/integration-health/route.js` |
| `/api/cron/learning-episodes-backfill` | `GET` | `beta` | `/api/cron` | `app/api/cron/learning-episodes-backfill/route.js` |
| `/api/cron/learning-recommendations` | `GET` | `beta` | `/api/cron` | `app/api/cron/learning-recommendations/route.js` |
| `/api/cron/memory-maintenance` | `GET` | `beta` | `/api/cron` | `app/api/cron/memory-maintenance/route.js` |
| `/api/cron/outcome-sweep` | `GET` | `beta` | `/api/cron` | `app/api/cron/outcome-sweep/route.js` |
| `/api/cron/policy-suggestions` | `GET` | `beta` | `/api/cron` | `app/api/cron/policy-suggestions/route.js` |
| `/api/cron/reset-meters` | `GET` | `beta` | `/api/cron` | `app/api/cron/reset-meters/route.js` |
| `/api/cron/routing-maintenance` | `POST` | `beta` | `/api/cron` | `app/api/cron/routing-maintenance/route.js` |
| `/api/cron/signals` | `GET` | `beta` | `/api/cron` | `app/api/cron/signals/route.js` |
| `/api/discord/interactions` | `POST` | `experimental` | `(default)` | `app/api/discord/interactions/route.js` |
| `/api/docs/raw` | `GET` | `beta` | `/api/docs` | `app/api/docs/raw/route.js` |
| `/api/doctor` | `GET` | `experimental` | `(default)` | `app/api/doctor/route.js` |
| `/api/doctor/fix` | `POST` | `experimental` | `(default)` | `app/api/doctor/fix/route.js` |
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
| `/api/guard` | `GET, POST` | `stable` | `/api/guard` | `app/api/guard/route.js` |
| `/api/guard/decisions` | `GET` | `stable` | `/api/guard` | `app/api/guard/decisions/route.js` |
| `/api/health` | `GET` | `stable` | `/api/health` | `app/api/health/route.js` |
| `/api/hosted/cleanup` | `POST` | `experimental` | `(default)` | `app/api/hosted/cleanup/route.js` |
| `/api/hosted/workspaces` | `GET, POST` | `experimental` | `(default)` | `app/api/hosted/workspaces/route.js` |
| `/api/hosted/workspaces/{workspaceId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/hosted/workspaces/[workspaceId]/route.js` |
| `/api/identities` | `GET, POST` | `experimental` | `/api/identities` | `app/api/identities/route.js` |
| `/api/identities/{agentId}` | `DELETE` | `experimental` | `/api/identities` | `app/api/identities/[agentId]/route.js` |
| `/api/integrations/health` | `GET` | `experimental` | `(default)` | `app/api/integrations/health/route.js` |
| `/api/integrations/health/refresh` | `POST` | `experimental` | `(default)` | `app/api/integrations/health/refresh/route.js` |
| `/api/keys` | `DELETE, GET, POST` | `stable` | `/api/keys` | `app/api/keys/route.js` |
| `/api/keys/reveal` | `GET` | `stable` | `/api/keys` | `app/api/keys/reveal/route.js` |
| `/api/knowledge/collections` | `GET, POST` | `experimental` | `(default)` | `app/api/knowledge/collections/route.js` |
| `/api/knowledge/collections/{collectionId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/route.js` |
| `/api/knowledge/collections/{collectionId}/items` | `GET, POST` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/items/route.js` |
| `/api/knowledge/collections/{collectionId}/search` | `POST` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/search/route.js` |
| `/api/knowledge/collections/{collectionId}/sync` | `POST` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/sync/route.js` |
| `/api/learning` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/route.js` |
| `/api/learning/analytics/curves` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/analytics/curves/route.js` |
| `/api/learning/analytics/maturity` | `GET` | `experimental` | `/api/learning` | `app/api/learning/analytics/maturity/route.js` |
| `/api/learning/analytics/summary` | `GET` | `experimental` | `/api/learning` | `app/api/learning/analytics/summary/route.js` |
| `/api/learning/analytics/velocity` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/analytics/velocity/route.js` |
| `/api/learning/code-signals` | `GET` | `experimental` | `/api/learning` | `app/api/learning/code-signals/route.js` |
| `/api/learning/lessons` | `GET` | `experimental` | `/api/learning` | `app/api/learning/lessons/route.js` |
| `/api/learning/recommendations` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/recommendations/route.js` |
| `/api/learning/recommendations/events` | `POST` | `experimental` | `/api/learning` | `app/api/learning/recommendations/events/route.js` |
| `/api/learning/recommendations/metrics` | `GET` | `experimental` | `/api/learning` | `app/api/learning/recommendations/metrics/route.js` |
| `/api/learning/recommendations/{recommendationId}` | `PATCH` | `experimental` | `/api/learning` | `app/api/learning/recommendations/[recommendationId]/route.js` |
| `/api/learning/suggestions` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/suggestions/route.js` |
| `/api/marketing/event` | `POST` | `experimental` | `(default)` | `app/api/marketing/event/route.js` |
| `/api/mcp` | `POST` | `experimental` | `(default)` | `app/api/mcp/route.js` |
| `/api/messages` | `GET, PATCH, POST` | `stable` | `/api/messages` | `app/api/messages/route.js` |
| `/api/messages/attachments` | `GET` | `stable` | `/api/messages` | `app/api/messages/attachments/route.js` |
| `/api/messages/threads` | `GET, PATCH, POST` | `stable` | `/api/messages` | `app/api/messages/threads/route.js` |
| `/api/messages/threads/{threadId}` | `GET` | `stable` | `/api/messages` | `app/api/messages/threads/[threadId]/route.js` |
| `/api/model-strategies` | `GET, POST` | `experimental` | `(default)` | `app/api/model-strategies/route.js` |
| `/api/model-strategies/{strategyId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/model-strategies/[strategyId]/route.js` |
| `/api/model-strategies/{strategyId}/complete` | `POST` | `experimental` | `(default)` | `app/api/model-strategies/[strategyId]/complete/route.js` |
| `/api/monetization/verified-integrations-count` | `GET` | `experimental` | `(default)` | `app/api/monetization/verified-integrations-count/route.js` |
| `/api/operations/feed` | `GET` | `experimental` | `(default)` | `app/api/operations/feed/route.js` |
| `/api/operations/summary` | `GET` | `experimental` | `(default)` | `app/api/operations/summary/route.js` |
| `/api/orgs` | `GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/route.js` |
| `/api/orgs/{orgId}` | `GET, PATCH` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/route.js` |
| `/api/orgs/{orgId}/keys` | `DELETE, GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/keys/route.js` |
| `/api/pairings` | `GET, POST` | `experimental` | `(default)` | `app/api/pairings/route.js` |
| `/api/pairings/{pairingId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/route.js` |
| `/api/pairings/{pairingId}/approve` | `POST` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/approve/route.js` |
| `/api/policies` | `DELETE, GET, PATCH, POST` | `stable` | `/api/policies` | `app/api/policies/route.js` |
| `/api/policies/generate` | `POST` | `stable` | `/api/policies` | `app/api/policies/generate/route.js` |
| `/api/policies/import` | `POST` | `stable` | `/api/policies` | `app/api/policies/import/route.js` |
| `/api/policies/proof` | `GET` | `stable` | `/api/policies` | `app/api/policies/proof/route.js` |
| `/api/policies/simulate` | `POST` | `stable` | `/api/policies` | `app/api/policies/simulate/route.js` |
| `/api/policies/templates` | `GET` | `stable` | `/api/policies` | `app/api/policies/templates/route.js` |
| `/api/policies/test` | `POST` | `stable` | `/api/policies` | `app/api/policies/test/route.js` |
| `/api/prompts/agent-connect/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/agent-connect/raw/route.js` |
| `/api/prompts/render` | `POST` | `experimental` | `(default)` | `app/api/prompts/render/route.js` |
| `/api/prompts/runs` | `GET` | `experimental` | `(default)` | `app/api/prompts/runs/route.js` |
| `/api/prompts/sdk-coverage/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/sdk-coverage/raw/route.js` |
| `/api/prompts/server-setup/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/server-setup/raw/route.js` |
| `/api/prompts/stats` | `GET` | `experimental` | `(default)` | `app/api/prompts/stats/route.js` |
| `/api/prompts/templates` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/route.js` |
| `/api/prompts/templates/{templateId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/route.js` |
| `/api/prompts/templates/{templateId}/versions` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/versions/route.js` |
| `/api/prompts/templates/{templateId}/versions/{versionId}` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/versions/[versionId]/route.js` |
| `/api/scoring/calibrate` | `POST` | `experimental` | `(default)` | `app/api/scoring/calibrate/route.js` |
| `/api/scoring/profiles` | `GET, POST` | `experimental` | `(default)` | `app/api/scoring/profiles/route.js` |
| `/api/scoring/profiles/{profileId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/scoring/profiles/[profileId]/route.js` |
| `/api/scoring/profiles/{profileId}/dimensions` | `POST` | `experimental` | `(default)` | `app/api/scoring/profiles/[profileId]/dimensions/route.js` |
| `/api/scoring/profiles/{profileId}/dimensions/{dimensionId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/scoring/profiles/[profileId]/dimensions/[dimensionId]/route.js` |
| `/api/scoring/risk-templates` | `GET, POST` | `experimental` | `(default)` | `app/api/scoring/risk-templates/route.js` |
| `/api/scoring/risk-templates/{templateId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/scoring/risk-templates/[templateId]/route.js` |
| `/api/scoring/score` | `GET, POST` | `experimental` | `(default)` | `app/api/scoring/score/route.js` |
| `/api/security/prompt-injection` | `GET, POST` | `beta` | `/api/security` | `app/api/security/prompt-injection/route.js` |
| `/api/security/scan` | `POST` | `beta` | `/api/security` | `app/api/security/scan/route.js` |
| `/api/security/status` | `GET` | `beta` | `/api/security` | `app/api/security/status/route.js` |
| `/api/session/effective` | `GET` | `experimental` | `(default)` | `app/api/session/effective/route.js` |
| `/api/sessions` | `GET, POST` | `experimental` | `(default)` | `app/api/sessions/route.js` |
| `/api/sessions/{sessionId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/route.js` |
| `/api/sessions/{sessionId}/events` | `GET` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/events/route.js` |
| `/api/settings` | `DELETE, GET, POST` | `stable` | `/api/settings` | `app/api/settings/route.js` |
| `/api/settings/llm-status` | `GET` | `stable` | `/api/settings` | `app/api/settings/llm-status/route.js` |
| `/api/settings/test` | `POST` | `stable` | `/api/settings` | `app/api/settings/test/route.js` |
| `/api/setup/live-proof` | `POST` | `beta` | `/api/setup` | `app/api/setup/live-proof/route.js` |
| `/api/setup/migrate` | `POST` | `beta` | `/api/setup` | `app/api/setup/migrate/route.js` |
| `/api/setup/ping` | `POST` | `beta` | `/api/setup` | `app/api/setup/ping/route.js` |
| `/api/setup/proof` | `GET` | `beta` | `/api/setup` | `app/api/setup/proof/route.js` |
| `/api/setup/status` | `GET` | `beta` | `/api/setup` | `app/api/setup/status/route.js` |
| `/api/signals` | `GET` | `experimental` | `(default)` | `app/api/signals/route.js` |
| `/api/stream` | `GET` | `experimental` | `(default)` | `app/api/stream/route.js` |
| `/api/swarm/graph` | `GET` | `experimental` | `/api/swarm` | `app/api/swarm/graph/route.js` |
| `/api/swarm/link` | `GET` | `experimental` | `/api/swarm` | `app/api/swarm/link/route.js` |
| `/api/team` | `GET` | `stable` | `/api/team` | `app/api/team/route.js` |
| `/api/team/invite` | `DELETE, GET, POST` | `stable` | `/api/team` | `app/api/team/invite/route.js` |
| `/api/team/{userId}` | `DELETE, PATCH` | `stable` | `/api/team` | `app/api/team/[userId]/route.js` |
| `/api/telegram/webhook` | `POST` | `experimental` | `(default)` | `app/api/telegram/webhook/route.js` |
| `/api/usage` | `GET` | `stable` | `/api/usage` | `app/api/usage/route.js` |
| `/api/usage/costs` | `GET` | `stable` | `/api/usage` | `app/api/usage/costs/route.js` |
| `/api/webhooks` | `DELETE, GET, POST` | `stable` | `/api/webhooks` | `app/api/webhooks/route.js` |
| `/api/webhooks/stripe` | `POST` | `stable` | `/api/webhooks` | `app/api/webhooks/stripe/route.js` |
| `/api/webhooks/{webhookId}/deliveries` | `GET` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/deliveries/route.js` |
| `/api/webhooks/{webhookId}/test` | `POST` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/test/route.js` |
| `/api/workflows/draft` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/draft/route.js` |
| `/api/workflows/templates` | `GET, POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/route.js` |
| `/api/workflows/templates/{templateId}` | `DELETE, GET, PATCH` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/route.js` |
| `/api/workflows/templates/{templateId}/duplicate` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/duplicate/route.js` |
| `/api/workflows/templates/{templateId}/execute` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/execute/route.js` |
| `/api/workflows/templates/{templateId}/launch` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/launch/route.js` |
| `/api/workflows/templates/{templateId}/runs` | `GET` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/route.js` |
| `/api/workflows/templates/{templateId}/runs/{runActionId}` | `GET` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/[runActionId]/route.js` |
| `/api/workflows/templates/{templateId}/runs/{runActionId}/cancel` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/[runActionId]/cancel/route.js` |
| `/api/workflows/templates/{templateId}/runs/{runActionId}/resume` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/[runActionId]/resume/route.js` |

