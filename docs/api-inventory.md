---
source-of-truth: false
owner: API Governance Lead
last-verified: 2026-06-11
doc-type: architecture
---

# API Inventory

- Source: `app/api/**/route.js`
- Artifact: `docs/api-inventory.json`
- Maturity levels: `stable`, `beta`, `experimental`

## Summary

- Total routes: `307`
- Stable routes: `51`
- Beta routes: `24`
- Experimental routes: `232`

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
| `/api/actions` | `DELETE, GET, POST` | `stable` | `/api/actions` | `app/api/actions/route.ts` |
| `/api/actions/costs` | `GET` | `stable` | `/api/actions` | `app/api/actions/costs/route.ts` |
| `/api/actions/loops` | `GET, POST` | `stable` | `/api/actions` | `app/api/actions/loops/route.ts` |
| `/api/actions/loops/{loopId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/loops/[loopId]/route.ts` |
| `/api/actions/stats` | `GET` | `stable` | `/api/actions` | `app/api/actions/stats/route.ts` |
| `/api/actions/{actionId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/[actionId]/route.ts` |
| `/api/actions/{actionId}/artifacts` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/artifacts/route.ts` |
| `/api/actions/{actionId}/graph` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/graph/route.ts` |
| `/api/actions/{actionId}/messages` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/messages/route.ts` |
| `/api/actions/{actionId}/outcome` | `GET, POST` | `stable` | `/api/actions` | `app/api/actions/[actionId]/outcome/route.ts` |
| `/api/actions/{actionId}/trace` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/trace/route.ts` |
| `/api/activity` | `GET` | `beta` | `/api/activity` | `app/api/activity/route.ts` |
| `/api/admin/trigger-outcome-sweep` | `POST` | `experimental` | `(default)` | `app/api/admin/trigger-outcome-sweep/route.ts` |
| `/api/agents` | `GET` | `experimental` | `/api/agents` | `app/api/agents/route.ts` |
| `/api/agents/connections` | `GET, POST` | `experimental` | `/api/agents` | `app/api/agents/connections/route.ts` |
| `/api/agents/heartbeat` | `POST` | `experimental` | `/api/agents` | `app/api/agents/heartbeat/route.ts` |
| `/api/agents/invoke` | `POST` | `experimental` | `/api/agents` | `app/api/agents/invoke/route.ts` |
| `/api/agents/registry` | `GET, POST` | `experimental` | `/api/agents` | `app/api/agents/registry/route.ts` |
| `/api/agents/registry/{id}` | `GET, PATCH` | `experimental` | `/api/agents` | `app/api/agents/registry/[id]/route.ts` |
| `/api/agents/registry/{id}/capabilities` | `GET, POST` | `experimental` | `/api/agents` | `app/api/agents/registry/[id]/capabilities/route.ts` |
| `/api/agents/{agentId}` | `GET` | `experimental` | `/api/agents` | `app/api/agents/[agentId]/route.ts` |
| `/api/agents/{agentId}/profile` | `GET` | `experimental` | `/api/agents` | `app/api/agents/[agentId]/profile/route.ts` |
| `/api/analytics` | `GET` | `experimental` | `(default)` | `app/api/analytics/route.ts` |
| `/api/approvals/{actionId}` | `POST` | `experimental` | `(default)` | `app/api/approvals/[actionId]/route.ts` |
| `/api/artifacts` | `GET, POST` | `experimental` | `(default)` | `app/api/artifacts/route.ts` |
| `/api/artifacts/evidence-bundle` | `POST` | `experimental` | `(default)` | `app/api/artifacts/evidence-bundle/route.ts` |
| `/api/artifacts/{artifactId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/artifacts/[artifactId]/route.ts` |
| `/api/assumptions` | `GET, POST` | `experimental` | `(default)` | `app/api/assumptions/route.ts` |
| `/api/assumptions/{assumptionId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/assumptions/[assumptionId]/route.ts` |
| `/api/auth/config` | `GET` | `beta` | `/api/auth` | `app/api/auth/config/route.ts` |
| `/api/auth/local` | `DELETE, POST` | `beta` | `/api/auth` | `app/api/auth/local/route.ts` |
| `/api/behavior/insights` | `GET, POST` | `experimental` | `/api/behavior` | `app/api/behavior/insights/route.ts` |
| `/api/behavior/recorder` | `GET, POST` | `experimental` | `/api/behavior` | `app/api/behavior/recorder/route.ts` |
| `/api/behavior/samples` | `GET` | `experimental` | `/api/behavior` | `app/api/behavior/samples/route.ts` |
| `/api/behavior/samples/ingest` | `POST` | `experimental` | `/api/behavior` | `app/api/behavior/samples/ingest/route.ts` |
| `/api/behavior/simulate` | `POST` | `experimental` | `/api/behavior` | `app/api/behavior/simulate/route.ts` |
| `/api/behavior/suggestions` | `GET, POST` | `experimental` | `/api/behavior` | `app/api/behavior/suggestions/route.ts` |
| `/api/billing/checkout` | `POST` | `experimental` | `(default)` | `app/api/billing/checkout/route.ts` |
| `/api/billing/portal` | `GET` | `experimental` | `(default)` | `app/api/billing/portal/route.ts` |
| `/api/capabilities` | `GET, POST` | `experimental` | `(default)` | `app/api/capabilities/route.ts` |
| `/api/capabilities/health` | `GET` | `experimental` | `(default)` | `app/api/capabilities/health/route.ts` |
| `/api/capabilities/{capabilityId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/route.ts` |
| `/api/capabilities/{capabilityId}/access` | `GET, POST` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/access/route.ts` |
| `/api/capabilities/{capabilityId}/access/check` | `GET` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/access/check/route.ts` |
| `/api/capabilities/{capabilityId}/access/{ruleId}` | `DELETE` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/access/[ruleId]/route.ts` |
| `/api/capabilities/{capabilityId}/health` | `GET` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/health/route.ts` |
| `/api/capabilities/{capabilityId}/history` | `GET` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/history/route.ts` |
| `/api/capabilities/{capabilityId}/invoke` | `POST` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/invoke/route.ts` |
| `/api/capabilities/{capabilityId}/test` | `POST` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/test/route.ts` |
| `/api/code-sessions/alerts` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/alerts/route.ts` |
| `/api/code-sessions/alerts/read-all` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/alerts/read-all/route.ts` |
| `/api/code-sessions/ingest-jsonl` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/ingest-jsonl/route.ts` |
| `/api/code-sessions/ingest-live` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/ingest-live/route.ts` |
| `/api/code-sessions/manifests/{manifestId}` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/manifests/[manifestId]/route.ts` |
| `/api/code-sessions/memos` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/memos/route.ts` |
| `/api/code-sessions/memos/regenerate` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/memos/regenerate/route.ts` |
| `/api/code-sessions/projects` | `DELETE, GET` | `experimental` | `(default)` | `app/api/code-sessions/projects/route.ts` |
| `/api/code-sessions/projects/{projectId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/code-sessions/projects/[projectId]/route.ts` |
| `/api/code-sessions/projects/{projectId}/sessions` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/projects/[projectId]/sessions/route.ts` |
| `/api/code-sessions/sessions/{sessionId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/route.ts` |
| `/api/code-sessions/sessions/{sessionId}/autopsy` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/autopsy/route.ts` |
| `/api/code-sessions/sessions/{sessionId}/insights` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/insights/route.ts` |
| `/api/code-sessions/sessions/{sessionId}/optimal-files/manifest` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/optimal-files/manifest/route.ts` |
| `/api/code-sessions/sessions/{sessionId}/optimal-files/merge-preview` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/optimal-files/merge-preview/route.ts` |
| `/api/code-sessions/sessions/{sessionId}/optimal-files/preview` | `POST` | `experimental` | `(default)` | `app/api/code-sessions/sessions/[sessionId]/optimal-files/preview/route.ts` |
| `/api/code-sessions/subagent-roi` | `GET` | `experimental` | `(default)` | `app/api/code-sessions/subagent-roi/route.ts` |
| `/api/compliance/evidence` | `GET` | `experimental` | `(default)` | `app/api/compliance/evidence/route.ts` |
| `/api/compliance/exports` | `GET, POST` | `experimental` | `(default)` | `app/api/compliance/exports/route.ts` |
| `/api/compliance/exports/{exportId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/compliance/exports/[exportId]/route.ts` |
| `/api/compliance/exports/{exportId}/download` | `GET` | `experimental` | `(default)` | `app/api/compliance/exports/[exportId]/download/route.ts` |
| `/api/compliance/frameworks` | `GET` | `experimental` | `(default)` | `app/api/compliance/frameworks/route.ts` |
| `/api/compliance/gaps` | `GET` | `experimental` | `(default)` | `app/api/compliance/gaps/route.ts` |
| `/api/compliance/map` | `GET` | `experimental` | `(default)` | `app/api/compliance/map/route.ts` |
| `/api/compliance/report` | `GET` | `experimental` | `(default)` | `app/api/compliance/report/route.ts` |
| `/api/compliance/schedules` | `GET, POST` | `experimental` | `(default)` | `app/api/compliance/schedules/route.ts` |
| `/api/compliance/schedules/{scheduleId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/compliance/schedules/[scheduleId]/route.ts` |
| `/api/compliance/trends` | `GET` | `experimental` | `(default)` | `app/api/compliance/trends/route.ts` |
| `/api/cron/code-session-cache-crater` | `GET` | `beta` | `/api/cron` | `app/api/cron/code-session-cache-crater/route.ts` |
| `/api/cron/code-session-weekly-memo` | `GET` | `beta` | `/api/cron` | `app/api/cron/code-session-weekly-memo/route.ts` |
| `/api/cron/integration-health` | `GET` | `beta` | `/api/cron` | `app/api/cron/integration-health/route.ts` |
| `/api/cron/jti-sweep` | `GET` | `beta` | `/api/cron` | `app/api/cron/jti-sweep/route.ts` |
| `/api/cron/learning-episodes-backfill` | `GET` | `beta` | `/api/cron` | `app/api/cron/learning-episodes-backfill/route.ts` |
| `/api/cron/learning-recommendations` | `GET` | `beta` | `/api/cron` | `app/api/cron/learning-recommendations/route.ts` |
| `/api/cron/memory-maintenance` | `GET` | `beta` | `/api/cron` | `app/api/cron/memory-maintenance/route.ts` |
| `/api/cron/outcome-sweep` | `GET` | `beta` | `/api/cron` | `app/api/cron/outcome-sweep/route.ts` |
| `/api/cron/policy-suggestions` | `GET` | `beta` | `/api/cron` | `app/api/cron/policy-suggestions/route.ts` |
| `/api/cron/reset-meters` | `GET` | `beta` | `/api/cron` | `app/api/cron/reset-meters/route.ts` |
| `/api/cron/routing-maintenance` | `POST` | `beta` | `/api/cron` | `app/api/cron/routing-maintenance/route.ts` |
| `/api/cron/signals` | `GET` | `beta` | `/api/cron` | `app/api/cron/signals/route.ts` |
| `/api/discord/interactions` | `POST` | `experimental` | `(default)` | `app/api/discord/interactions/route.ts` |
| `/api/docs/raw` | `GET` | `beta` | `/api/docs` | `app/api/docs/raw/route.ts` |
| `/api/doctor` | `GET` | `experimental` | `(default)` | `app/api/doctor/route.ts` |
| `/api/doctor/fix` | `POST` | `experimental` | `(default)` | `app/api/doctor/fix/route.ts` |
| `/api/drift/alerts` | `GET, POST` | `experimental` | `(default)` | `app/api/drift/alerts/route.ts` |
| `/api/drift/alerts/{alertId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/drift/alerts/[alertId]/route.ts` |
| `/api/drift/metrics` | `GET` | `experimental` | `(default)` | `app/api/drift/metrics/route.ts` |
| `/api/drift/snapshots` | `GET` | `experimental` | `(default)` | `app/api/drift/snapshots/route.ts` |
| `/api/drift/stats` | `GET` | `experimental` | `(default)` | `app/api/drift/stats/route.ts` |
| `/api/echo` | `GET, POST` | `experimental` | `(default)` | `app/api/echo/route.ts` |
| `/api/evaluations` | `GET, POST` | `experimental` | `(default)` | `app/api/evaluations/route.ts` |
| `/api/evaluations/runs` | `GET, POST` | `experimental` | `(default)` | `app/api/evaluations/runs/route.ts` |
| `/api/evaluations/runs/{runId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/evaluations/runs/[runId]/route.ts` |
| `/api/evaluations/scorers` | `GET, POST` | `experimental` | `(default)` | `app/api/evaluations/scorers/route.ts` |
| `/api/evaluations/scorers/preview` | `POST` | `experimental` | `(default)` | `app/api/evaluations/scorers/preview/route.ts` |
| `/api/evaluations/scorers/{scorerId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/evaluations/scorers/[scorerId]/route.ts` |
| `/api/evaluations/stats` | `GET` | `experimental` | `(default)` | `app/api/evaluations/stats/route.ts` |
| `/api/finops/spend` | `GET` | `experimental` | `(default)` | `app/api/finops/spend/route.ts` |
| `/api/guard` | `GET, POST` | `stable` | `/api/guard` | `app/api/guard/route.ts` |
| `/api/guard/decisions` | `GET` | `stable` | `/api/guard` | `app/api/guard/decisions/route.ts` |
| `/api/handoffs` | `GET, POST` | `stable` | `/api/handoffs` | `app/api/handoffs/route.ts` |
| `/api/handoffs/latest` | `GET` | `stable` | `/api/handoffs` | `app/api/handoffs/latest/route.ts` |
| `/api/handoffs/{id}` | `GET` | `stable` | `/api/handoffs` | `app/api/handoffs/[id]/route.ts` |
| `/api/handoffs/{id}/consume` | `POST` | `stable` | `/api/handoffs` | `app/api/handoffs/[id]/consume/route.ts` |
| `/api/health` | `GET` | `stable` | `/api/health` | `app/api/health/route.ts` |
| `/api/hosted/capacity` | `GET` | `experimental` | `(default)` | `app/api/hosted/capacity/route.ts` |
| `/api/hosted/cleanup` | `POST` | `experimental` | `(default)` | `app/api/hosted/cleanup/route.ts` |
| `/api/hosted/workspaces` | `GET, POST` | `experimental` | `(default)` | `app/api/hosted/workspaces/route.ts` |
| `/api/hosted/workspaces/{workspaceId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/hosted/workspaces/[workspaceId]/route.ts` |
| `/api/identities` | `GET, POST` | `experimental` | `/api/identities` | `app/api/identities/route.ts` |
| `/api/identities/{agentId}` | `DELETE` | `experimental` | `/api/identities` | `app/api/identities/[agentId]/route.ts` |
| `/api/integrations/health` | `GET` | `experimental` | `(default)` | `app/api/integrations/health/route.ts` |
| `/api/integrations/health/refresh` | `POST` | `experimental` | `(default)` | `app/api/integrations/health/refresh/route.ts` |
| `/api/integrity/jwks` | `GET` | `experimental` | `(default)` | `app/api/integrity/jwks/route.ts` |
| `/api/integrity/verify` | `POST` | `experimental` | `(default)` | `app/api/integrity/verify/route.ts` |
| `/api/invite/{token}` | `GET, POST` | `stable` | `/api/invite` | `app/api/invite/[token]/route.ts` |
| `/api/keys` | `DELETE, GET, POST` | `stable` | `/api/keys` | `app/api/keys/route.ts` |
| `/api/keys/reveal` | `GET` | `stable` | `/api/keys` | `app/api/keys/reveal/route.ts` |
| `/api/knowledge/collections` | `GET, POST` | `experimental` | `(default)` | `app/api/knowledge/collections/route.ts` |
| `/api/knowledge/collections/{collectionId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/route.ts` |
| `/api/knowledge/collections/{collectionId}/items` | `GET, POST` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/items/route.ts` |
| `/api/knowledge/collections/{collectionId}/search` | `POST` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/search/route.ts` |
| `/api/knowledge/collections/{collectionId}/sync` | `POST` | `experimental` | `(default)` | `app/api/knowledge/collections/[collectionId]/sync/route.ts` |
| `/api/learning` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/route.ts` |
| `/api/learning/analytics/curves` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/analytics/curves/route.ts` |
| `/api/learning/analytics/maturity` | `GET` | `experimental` | `/api/learning` | `app/api/learning/analytics/maturity/route.ts` |
| `/api/learning/analytics/summary` | `GET` | `experimental` | `/api/learning` | `app/api/learning/analytics/summary/route.ts` |
| `/api/learning/analytics/velocity` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/analytics/velocity/route.ts` |
| `/api/learning/code-signals` | `GET` | `experimental` | `/api/learning` | `app/api/learning/code-signals/route.ts` |
| `/api/learning/export` | `GET` | `experimental` | `/api/learning` | `app/api/learning/export/route.ts` |
| `/api/learning/lessons` | `GET` | `experimental` | `/api/learning` | `app/api/learning/lessons/route.ts` |
| `/api/learning/recommendations` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/recommendations/route.ts` |
| `/api/learning/recommendations/events` | `POST` | `experimental` | `/api/learning` | `app/api/learning/recommendations/events/route.ts` |
| `/api/learning/recommendations/metrics` | `GET` | `experimental` | `/api/learning` | `app/api/learning/recommendations/metrics/route.ts` |
| `/api/learning/recommendations/{recommendationId}` | `PATCH` | `experimental` | `/api/learning` | `app/api/learning/recommendations/[recommendationId]/route.ts` |
| `/api/learning/suggestions` | `GET, POST` | `experimental` | `/api/learning` | `app/api/learning/suggestions/route.ts` |
| `/api/marketing/event` | `POST` | `experimental` | `(default)` | `app/api/marketing/event/route.ts` |
| `/api/mcp` | `POST` | `experimental` | `(default)` | `app/api/mcp/route.ts` |
| `/api/messages` | `GET, PATCH, POST` | `stable` | `/api/messages` | `app/api/messages/route.ts` |
| `/api/messages/attachments` | `GET` | `stable` | `/api/messages` | `app/api/messages/attachments/route.ts` |
| `/api/messages/threads` | `GET, PATCH, POST` | `stable` | `/api/messages` | `app/api/messages/threads/route.ts` |
| `/api/messages/threads/{threadId}` | `GET` | `stable` | `/api/messages` | `app/api/messages/threads/[threadId]/route.ts` |
| `/api/model-strategies` | `GET, POST` | `experimental` | `(default)` | `app/api/model-strategies/route.ts` |
| `/api/model-strategies/{strategyId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/model-strategies/[strategyId]/route.ts` |
| `/api/model-strategies/{strategyId}/complete` | `POST` | `experimental` | `(default)` | `app/api/model-strategies/[strategyId]/complete/route.ts` |
| `/api/oauth/authorize` | `GET, POST` | `experimental` | `(default)` | `app/api/oauth/authorize/route.ts` |
| `/api/oauth/metadata/authorization-server` | `GET` | `experimental` | `(default)` | `app/api/oauth/metadata/authorization-server/route.ts` |
| `/api/oauth/metadata/protected-resource` | `GET` | `experimental` | `(default)` | `app/api/oauth/metadata/protected-resource/route.ts` |
| `/api/oauth/register` | `POST` | `experimental` | `(default)` | `app/api/oauth/register/route.ts` |
| `/api/oauth/token` | `POST` | `experimental` | `(default)` | `app/api/oauth/token/route.ts` |
| `/api/operations/feed` | `GET` | `experimental` | `(default)` | `app/api/operations/feed/route.ts` |
| `/api/operations/summary` | `GET` | `experimental` | `(default)` | `app/api/operations/summary/route.ts` |
| `/api/orgs` | `GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/route.ts` |
| `/api/orgs/{orgId}` | `GET, PATCH` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/route.ts` |
| `/api/orgs/{orgId}/keys` | `DELETE, GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/keys/route.ts` |
| `/api/pairings` | `GET, POST` | `experimental` | `(default)` | `app/api/pairings/route.ts` |
| `/api/pairings/{pairingId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/route.ts` |
| `/api/pairings/{pairingId}/approve` | `POST` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/approve/route.ts` |
| `/api/policies` | `DELETE, GET, PATCH, POST` | `stable` | `/api/policies` | `app/api/policies/route.ts` |
| `/api/policies/generate` | `POST` | `stable` | `/api/policies` | `app/api/policies/generate/route.ts` |
| `/api/policies/import` | `POST` | `stable` | `/api/policies` | `app/api/policies/import/route.ts` |
| `/api/policies/modes` | `GET` | `stable` | `/api/policies` | `app/api/policies/modes/route.ts` |
| `/api/policies/modes/import` | `POST` | `stable` | `/api/policies` | `app/api/policies/modes/import/route.ts` |
| `/api/policies/modes/preview` | `POST` | `stable` | `/api/policies` | `app/api/policies/modes/preview/route.ts` |
| `/api/policies/proof` | `GET` | `stable` | `/api/policies` | `app/api/policies/proof/route.ts` |
| `/api/policies/simulate` | `POST` | `stable` | `/api/policies` | `app/api/policies/simulate/route.ts` |
| `/api/policies/summary` | `GET` | `stable` | `/api/policies` | `app/api/policies/summary/route.ts` |
| `/api/policies/templates` | `GET` | `stable` | `/api/policies` | `app/api/policies/templates/route.ts` |
| `/api/policies/test` | `POST` | `stable` | `/api/policies` | `app/api/policies/test/route.ts` |
| `/api/posture` | `GET` | `experimental` | `(default)` | `app/api/posture/route.ts` |
| `/api/posture/findings` | `GET` | `experimental` | `(default)` | `app/api/posture/findings/route.ts` |
| `/api/posture/findings/{key}/resolve` | `POST` | `experimental` | `(default)` | `app/api/posture/findings/[key]/resolve/route.ts` |
| `/api/posture/scan` | `POST` | `experimental` | `(default)` | `app/api/posture/scan/route.ts` |
| `/api/prompts/agent-connect/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/agent-connect/raw/route.ts` |
| `/api/prompts/render` | `POST` | `experimental` | `(default)` | `app/api/prompts/render/route.ts` |
| `/api/prompts/runs` | `GET` | `experimental` | `(default)` | `app/api/prompts/runs/route.ts` |
| `/api/prompts/sdk-coverage/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/sdk-coverage/raw/route.ts` |
| `/api/prompts/server-setup/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/server-setup/raw/route.ts` |
| `/api/prompts/stats` | `GET` | `experimental` | `(default)` | `app/api/prompts/stats/route.ts` |
| `/api/prompts/templates` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/route.ts` |
| `/api/prompts/templates/{templateId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/route.ts` |
| `/api/prompts/templates/{templateId}/versions` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/versions/route.ts` |
| `/api/prompts/templates/{templateId}/versions/{versionId}` | `GET, POST` | `experimental` | `(default)` | `app/api/prompts/templates/[templateId]/versions/[versionId]/route.ts` |
| `/api/reputation/agents/{agentId}` | `GET` | `experimental` | `(default)` | `app/api/reputation/agents/[agentId]/route.ts` |
| `/api/reputation/agents/{agentId}/events` | `GET` | `experimental` | `(default)` | `app/api/reputation/agents/[agentId]/events/route.ts` |
| `/api/reputation/agents/{agentId}/receipt` | `GET` | `experimental` | `(default)` | `app/api/reputation/agents/[agentId]/receipt/route.ts` |
| `/api/reputation/agents/{agentId}/recompute` | `POST` | `experimental` | `(default)` | `app/api/reputation/agents/[agentId]/recompute/route.ts` |
| `/api/reputation/agents/{agentId}/summary` | `GET` | `experimental` | `(default)` | `app/api/reputation/agents/[agentId]/summary/route.ts` |
| `/api/reputation/leaderboard` | `GET` | `experimental` | `(default)` | `app/api/reputation/leaderboard/route.ts` |
| `/api/reputation/verify` | `POST` | `experimental` | `(default)` | `app/api/reputation/verify/route.ts` |
| `/api/scoring/calibrate` | `POST` | `experimental` | `(default)` | `app/api/scoring/calibrate/route.ts` |
| `/api/scoring/profiles` | `GET, POST` | `experimental` | `(default)` | `app/api/scoring/profiles/route.ts` |
| `/api/scoring/profiles/{profileId}` | `DELETE, GET, PATCH` | `experimental` | `(default)` | `app/api/scoring/profiles/[profileId]/route.ts` |
| `/api/scoring/profiles/{profileId}/dimensions` | `POST` | `experimental` | `(default)` | `app/api/scoring/profiles/[profileId]/dimensions/route.ts` |
| `/api/scoring/profiles/{profileId}/dimensions/{dimensionId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/scoring/profiles/[profileId]/dimensions/[dimensionId]/route.ts` |
| `/api/scoring/risk-templates` | `GET, POST` | `experimental` | `(default)` | `app/api/scoring/risk-templates/route.ts` |
| `/api/scoring/risk-templates/{templateId}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/scoring/risk-templates/[templateId]/route.ts` |
| `/api/scoring/score` | `GET, POST` | `experimental` | `(default)` | `app/api/scoring/score/route.ts` |
| `/api/secrets` | `GET, POST` | `experimental` | `(default)` | `app/api/secrets/route.ts` |
| `/api/secrets/env` | `GET` | `experimental` | `(default)` | `app/api/secrets/env/route.ts` |
| `/api/secrets/rotation-due` | `GET` | `experimental` | `(default)` | `app/api/secrets/rotation-due/route.ts` |
| `/api/secrets/{id}` | `DELETE, PATCH` | `experimental` | `(default)` | `app/api/secrets/[id]/route.ts` |
| `/api/secrets/{id}/value` | `POST` | `experimental` | `(default)` | `app/api/secrets/[id]/value/route.ts` |
| `/api/security/prompt-injection` | `GET, POST` | `beta` | `/api/security` | `app/api/security/prompt-injection/route.ts` |
| `/api/security/scan` | `POST` | `beta` | `/api/security` | `app/api/security/scan/route.ts` |
| `/api/security/status` | `GET` | `beta` | `/api/security` | `app/api/security/status/route.ts` |
| `/api/session/effective` | `GET` | `experimental` | `(default)` | `app/api/session/effective/route.ts` |
| `/api/sessions` | `GET, POST` | `experimental` | `(default)` | `app/api/sessions/route.ts` |
| `/api/sessions/{sessionId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/route.ts` |
| `/api/sessions/{sessionId}/actions` | `GET` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/actions/route.ts` |
| `/api/sessions/{sessionId}/events` | `GET` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/events/route.ts` |
| `/api/settings` | `DELETE, GET, POST` | `stable` | `/api/settings` | `app/api/settings/route.ts` |
| `/api/settings/llm-status` | `GET` | `stable` | `/api/settings` | `app/api/settings/llm-status/route.ts` |
| `/api/settings/test` | `POST` | `stable` | `/api/settings` | `app/api/settings/test/route.ts` |
| `/api/setup/live-proof` | `POST` | `beta` | `/api/setup` | `app/api/setup/live-proof/route.ts` |
| `/api/setup/migrate` | `POST` | `beta` | `/api/setup` | `app/api/setup/migrate/route.ts` |
| `/api/setup/ping` | `POST` | `beta` | `/api/setup` | `app/api/setup/ping/route.ts` |
| `/api/setup/proof` | `GET` | `beta` | `/api/setup` | `app/api/setup/proof/route.ts` |
| `/api/setup/status` | `GET` | `beta` | `/api/setup` | `app/api/setup/status/route.ts` |
| `/api/signals` | `GET` | `experimental` | `(default)` | `app/api/signals/route.ts` |
| `/api/skills/scan` | `POST` | `experimental` | `(default)` | `app/api/skills/scan/route.ts` |
| `/api/skills/scans/{id}` | `GET` | `experimental` | `(default)` | `app/api/skills/scans/[id]/route.ts` |
| `/api/stream` | `GET` | `experimental` | `(default)` | `app/api/stream/route.ts` |
| `/api/swarm/graph` | `GET` | `experimental` | `/api/swarm` | `app/api/swarm/graph/route.ts` |
| `/api/swarm/link` | `GET` | `experimental` | `/api/swarm` | `app/api/swarm/link/route.ts` |
| `/api/team` | `GET` | `stable` | `/api/team` | `app/api/team/route.ts` |
| `/api/team/invite` | `DELETE, GET, POST` | `stable` | `/api/team` | `app/api/team/invite/route.ts` |
| `/api/team/{userId}` | `DELETE, PATCH` | `stable` | `/api/team` | `app/api/team/[userId]/route.ts` |
| `/api/telegram/webhook` | `POST` | `experimental` | `(default)` | `app/api/telegram/webhook/route.ts` |
| `/api/usage` | `GET` | `stable` | `/api/usage` | `app/api/usage/route.ts` |
| `/api/usage/costs` | `GET` | `stable` | `/api/usage` | `app/api/usage/costs/route.ts` |
| `/api/webhooks` | `DELETE, GET, POST` | `stable` | `/api/webhooks` | `app/api/webhooks/route.ts` |
| `/api/webhooks/stripe` | `POST` | `stable` | `/api/webhooks` | `app/api/webhooks/stripe/route.ts` |
| `/api/webhooks/{webhookId}/deliveries` | `GET` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/deliveries/route.ts` |
| `/api/webhooks/{webhookId}/test` | `POST` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/test/route.ts` |
| `/api/widget/summary` | `GET` | `experimental` | `(default)` | `app/api/widget/summary/route.ts` |
| `/api/workflows/draft` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/draft/route.ts` |
| `/api/workflows/templates` | `GET, POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/route.ts` |
| `/api/workflows/templates/{templateId}` | `DELETE, GET, PATCH` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/route.ts` |
| `/api/workflows/templates/{templateId}/duplicate` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/duplicate/route.ts` |
| `/api/workflows/templates/{templateId}/execute` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/execute/route.ts` |
| `/api/workflows/templates/{templateId}/launch` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/launch/route.ts` |
| `/api/workflows/templates/{templateId}/runs` | `GET` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/route.ts` |
| `/api/workflows/templates/{templateId}/runs/{runActionId}` | `GET` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/[runActionId]/route.ts` |
| `/api/workflows/templates/{templateId}/runs/{runActionId}/cancel` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/[runActionId]/cancel/route.ts` |
| `/api/workflows/templates/{templateId}/runs/{runActionId}/resume` | `POST` | `experimental` | `/api/workflows` | `app/api/workflows/templates/[templateId]/runs/[runActionId]/resume/route.ts` |
| `/api/x402/providers` | `GET, POST` | `experimental` | `(default)` | `app/api/x402/providers/route.ts` |
| `/api/x402/providers/{id}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/x402/providers/[id]/route.ts` |
| `/api/x402/providers/{id}/endpoints` | `GET, POST` | `experimental` | `(default)` | `app/api/x402/providers/[id]/endpoints/route.ts` |
| `/api/x402/purchases` | `GET, POST` | `experimental` | `(default)` | `app/api/x402/purchases/route.ts` |

