---
source-of-truth: false
owner: API Governance Lead
last-verified: 2026-08-06
doc-type: architecture
---

# API Inventory

- Source: `app/api/**/route.js`
- Artifact: `docs/api-inventory.json`
- Maturity levels: `stable`, `beta`, `experimental`

## Summary

- Total routes: `123`
- Stable routes: `39`
- Beta routes: `17`
- Experimental routes: `67`

## Routes

| Path | Methods | Maturity | Rule Prefix | File |
|---|---|---|---|---|
| `/api/actions` | `DELETE, GET, POST` | `stable` | `/api/actions` | `app/api/actions/route.ts` |
| `/api/actions/stats` | `GET` | `stable` | `/api/actions` | `app/api/actions/stats/route.ts` |
| `/api/actions/{actionId}` | `GET, PATCH` | `stable` | `/api/actions` | `app/api/actions/[actionId]/route.ts` |
| `/api/actions/{actionId}/artifacts` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/artifacts/route.ts` |
| `/api/actions/{actionId}/containment` | `POST` | `stable` | `/api/actions` | `app/api/actions/[actionId]/containment/route.ts` |
| `/api/actions/{actionId}/graph` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/graph/route.ts` |
| `/api/actions/{actionId}/outcome` | `GET, POST` | `stable` | `/api/actions` | `app/api/actions/[actionId]/outcome/route.ts` |
| `/api/actions/{actionId}/trace` | `GET` | `stable` | `/api/actions` | `app/api/actions/[actionId]/trace/route.ts` |
| `/api/activity` | `GET` | `beta` | `/api/activity` | `app/api/activity/route.ts` |
| `/api/admin/trigger-outcome-sweep` | `POST` | `experimental` | `(default)` | `app/api/admin/trigger-outcome-sweep/route.ts` |
| `/api/agents` | `GET` | `experimental` | `/api/agents` | `app/api/agents/route.ts` |
| `/api/agents/fanouts` | `GET` | `experimental` | `/api/agents` | `app/api/agents/fanouts/route.ts` |
| `/api/approvals/bulk` | `POST` | `experimental` | `(default)` | `app/api/approvals/bulk/route.ts` |
| `/api/approvals/floods` | `GET` | `experimental` | `(default)` | `app/api/approvals/floods/route.ts` |
| `/api/approvals/{actionId}` | `POST` | `experimental` | `(default)` | `app/api/approvals/[actionId]/route.ts` |
| `/api/artifacts` | `GET, POST` | `experimental` | `(default)` | `app/api/artifacts/route.ts` |
| `/api/artifacts/evidence-bundle` | `POST` | `experimental` | `(default)` | `app/api/artifacts/evidence-bundle/route.ts` |
| `/api/artifacts/{artifactId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/artifacts/[artifactId]/route.ts` |
| `/api/assumptions` | `GET, POST` | `experimental` | `(default)` | `app/api/assumptions/route.ts` |
| `/api/assumptions/{assumptionId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/assumptions/[assumptionId]/route.ts` |
| `/api/auth/config` | `GET` | `beta` | `/api/auth` | `app/api/auth/config/route.ts` |
| `/api/auth/local` | `DELETE, POST` | `beta` | `/api/auth` | `app/api/auth/local/route.ts` |
| `/api/calibration/controller` | `GET, POST` | `experimental` | `(default)` | `app/api/calibration/controller/route.ts` |
| `/api/calibration/proposals` | `GET, POST` | `experimental` | `(default)` | `app/api/calibration/proposals/route.ts` |
| `/api/capabilities` | `GET` | `experimental` | `(default)` | `app/api/capabilities/route.ts` |
| `/api/capabilities/{capabilityId}/access/check` | `GET` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/access/check/route.ts` |
| `/api/capabilities/{capabilityId}/invoke` | `POST` | `experimental` | `(default)` | `app/api/capabilities/[capabilityId]/invoke/route.ts` |
| `/api/coverage` | `GET, POST` | `experimental` | `(default)` | `app/api/coverage/route.ts` |
| `/api/cron/integration-health` | `GET` | `beta` | `/api/cron` | `app/api/cron/integration-health/route.ts` |
| `/api/cron/jti-sweep` | `GET` | `beta` | `/api/cron` | `app/api/cron/jti-sweep/route.ts` |
| `/api/cron/memory-maintenance` | `GET` | `beta` | `/api/cron` | `app/api/cron/memory-maintenance/route.ts` |
| `/api/cron/outcome-sweep` | `GET` | `beta` | `/api/cron` | `app/api/cron/outcome-sweep/route.ts` |
| `/api/cron/policy-suggestions` | `GET` | `beta` | `/api/cron` | `app/api/cron/policy-suggestions/route.ts` |
| `/api/cron/signals` | `GET` | `beta` | `/api/cron` | `app/api/cron/signals/route.ts` |
| `/api/discord/interactions` | `POST` | `experimental` | `(default)` | `app/api/discord/interactions/route.ts` |
| `/api/docs/raw` | `GET` | `beta` | `/api/docs` | `app/api/docs/raw/route.ts` |
| `/api/doctor` | `GET` | `experimental` | `(default)` | `app/api/doctor/route.ts` |
| `/api/doctor/fix` | `POST` | `experimental` | `(default)` | `app/api/doctor/fix/route.ts` |
| `/api/echo` | `GET, POST` | `experimental` | `(default)` | `app/api/echo/route.ts` |
| `/api/enforcement-liveness` | `GET, POST` | `experimental` | `(default)` | `app/api/enforcement-liveness/route.ts` |
| `/api/guard` | `GET, POST` | `stable` | `/api/guard` | `app/api/guard/route.ts` |
| `/api/guard/decisions` | `GET` | `stable` | `/api/guard` | `app/api/guard/decisions/route.ts` |
| `/api/halt` | `GET, POST` | `experimental` | `(default)` | `app/api/halt/route.ts` |
| `/api/health` | `GET` | `stable` | `/api/health` | `app/api/health/route.ts` |
| `/api/hosted/capacity` | `GET` | `experimental` | `(default)` | `app/api/hosted/capacity/route.ts` |
| `/api/hosted/cleanup` | `POST` | `experimental` | `(default)` | `app/api/hosted/cleanup/route.ts` |
| `/api/hosted/funnel` | `GET` | `experimental` | `(default)` | `app/api/hosted/funnel/route.ts` |
| `/api/hosted/workspaces` | `GET, POST` | `experimental` | `(default)` | `app/api/hosted/workspaces/route.ts` |
| `/api/hosted/workspaces/{workspaceId}` | `DELETE, GET` | `experimental` | `(default)` | `app/api/hosted/workspaces/[workspaceId]/route.ts` |
| `/api/identities` | `GET, POST` | `experimental` | `/api/identities` | `app/api/identities/route.ts` |
| `/api/identities/{agentId}` | `DELETE` | `experimental` | `/api/identities` | `app/api/identities/[agentId]/route.ts` |
| `/api/integrations/health` | `GET` | `experimental` | `(default)` | `app/api/integrations/health/route.ts` |
| `/api/integrations/health/refresh` | `POST` | `experimental` | `(default)` | `app/api/integrations/health/refresh/route.ts` |
| `/api/integrity/jwks` | `GET` | `experimental` | `(default)` | `app/api/integrity/jwks/route.ts` |
| `/api/integrity/verify` | `POST` | `experimental` | `(default)` | `app/api/integrity/verify/route.ts` |
| `/api/internal/resolve-key` | `POST` | `experimental` | `(default)` | `app/api/internal/resolve-key/route.ts` |
| `/api/keys` | `DELETE, GET, POST` | `stable` | `/api/keys` | `app/api/keys/route.ts` |
| `/api/keys/reveal` | `GET` | `stable` | `/api/keys` | `app/api/keys/reveal/route.ts` |
| `/api/live-canary` | `GET, POST` | `experimental` | `(default)` | `app/api/live-canary/route.ts` |
| `/api/marketing/event` | `POST` | `experimental` | `(default)` | `app/api/marketing/event/route.ts` |
| `/api/mcp` | `POST` | `experimental` | `(default)` | `app/api/mcp/route.ts` |
| `/api/messages` | `GET, PATCH, POST` | `stable` | `/api/messages` | `app/api/messages/route.ts` |
| `/api/oauth/authorize` | `GET, POST` | `experimental` | `(default)` | `app/api/oauth/authorize/route.ts` |
| `/api/oauth/metadata/authorization-server` | `GET` | `experimental` | `(default)` | `app/api/oauth/metadata/authorization-server/route.ts` |
| `/api/oauth/metadata/protected-resource` | `GET` | `experimental` | `(default)` | `app/api/oauth/metadata/protected-resource/route.ts` |
| `/api/oauth/register` | `POST` | `experimental` | `(default)` | `app/api/oauth/register/route.ts` |
| `/api/oauth/token` | `POST` | `experimental` | `(default)` | `app/api/oauth/token/route.ts` |
| `/api/operations/summary` | `GET` | `experimental` | `(default)` | `app/api/operations/summary/route.ts` |
| `/api/orgs` | `GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/route.ts` |
| `/api/orgs/{orgId}` | `GET, PATCH` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/route.ts` |
| `/api/orgs/{orgId}/keys` | `DELETE, GET, POST` | `stable` | `/api/orgs` | `app/api/orgs/[orgId]/keys/route.ts` |
| `/api/pairings` | `GET, POST` | `experimental` | `(default)` | `app/api/pairings/route.ts` |
| `/api/pairings/{pairingId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/route.ts` |
| `/api/pairings/{pairingId}/approve` | `POST` | `experimental` | `(default)` | `app/api/pairings/[pairingId]/approve/route.ts` |
| `/api/plans` | `GET, POST` | `experimental` | `(default)` | `app/api/plans/route.ts` |
| `/api/plans/{planId}` | `GET, POST` | `experimental` | `(default)` | `app/api/plans/[planId]/route.ts` |
| `/api/policies` | `DELETE, GET, PATCH, POST` | `stable` | `/api/policies` | `app/api/policies/route.ts` |
| `/api/policies/contract` | `GET` | `stable` | `/api/policies` | `app/api/policies/contract/route.ts` |
| `/api/policies/generate` | `POST` | `stable` | `/api/policies` | `app/api/policies/generate/route.ts` |
| `/api/policies/import` | `POST` | `stable` | `/api/policies` | `app/api/policies/import/route.ts` |
| `/api/policies/loosening` | `GET, POST` | `stable` | `/api/policies` | `app/api/policies/loosening/route.ts` |
| `/api/policies/modes` | `GET` | `stable` | `/api/policies` | `app/api/policies/modes/route.ts` |
| `/api/policies/modes/import` | `POST` | `stable` | `/api/policies` | `app/api/policies/modes/import/route.ts` |
| `/api/policies/modes/preview` | `POST` | `stable` | `/api/policies` | `app/api/policies/modes/preview/route.ts` |
| `/api/policies/proof` | `GET` | `stable` | `/api/policies` | `app/api/policies/proof/route.ts` |
| `/api/policies/proposals` | `GET, POST` | `stable` | `/api/policies` | `app/api/policies/proposals/route.ts` |
| `/api/policies/review` | `GET` | `stable` | `/api/policies` | `app/api/policies/review/route.ts` |
| `/api/policies/review/verdict` | `POST` | `stable` | `/api/policies` | `app/api/policies/review/verdict/route.ts` |
| `/api/policies/simulate` | `POST` | `stable` | `/api/policies` | `app/api/policies/simulate/route.ts` |
| `/api/policies/summary` | `GET` | `stable` | `/api/policies` | `app/api/policies/summary/route.ts` |
| `/api/policies/templates` | `GET` | `stable` | `/api/policies` | `app/api/policies/templates/route.ts` |
| `/api/policies/test` | `POST` | `stable` | `/api/policies` | `app/api/policies/test/route.ts` |
| `/api/policies/tightening` | `GET, POST` | `stable` | `/api/policies` | `app/api/policies/tightening/route.ts` |
| `/api/prompts/agent-connect/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/agent-connect/raw/route.ts` |
| `/api/prompts/sdk-coverage/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/sdk-coverage/raw/route.ts` |
| `/api/prompts/server-setup/raw` | `GET` | `experimental` | `(default)` | `app/api/prompts/server-setup/raw/route.ts` |
| `/api/security/prompt-injection` | `GET, POST` | `beta` | `/api/security` | `app/api/security/prompt-injection/route.ts` |
| `/api/security/status` | `GET` | `beta` | `/api/security` | `app/api/security/status/route.ts` |
| `/api/self-governance` | `GET` | `experimental` | `(default)` | `app/api/self-governance/route.ts` |
| `/api/session/effective` | `GET` | `experimental` | `(default)` | `app/api/session/effective/route.ts` |
| `/api/sessions` | `GET, POST` | `experimental` | `(default)` | `app/api/sessions/route.ts` |
| `/api/sessions/{sessionId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/route.ts` |
| `/api/sessions/{sessionId}/actions` | `GET` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/actions/route.ts` |
| `/api/sessions/{sessionId}/events` | `GET` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/events/route.ts` |
| `/api/sessions/{sessionId}/retro` | `GET` | `experimental` | `(default)` | `app/api/sessions/[sessionId]/retro/route.ts` |
| `/api/settings` | `DELETE, GET, POST` | `stable` | `/api/settings` | `app/api/settings/route.ts` |
| `/api/settings/test` | `POST` | `stable` | `/api/settings` | `app/api/settings/test/route.ts` |
| `/api/setup/live-proof` | `POST` | `beta` | `/api/setup` | `app/api/setup/live-proof/route.ts` |
| `/api/setup/migrate` | `POST` | `beta` | `/api/setup` | `app/api/setup/migrate/route.ts` |
| `/api/setup/ping` | `POST` | `beta` | `/api/setup` | `app/api/setup/ping/route.ts` |
| `/api/setup/proof` | `GET` | `beta` | `/api/setup` | `app/api/setup/proof/route.ts` |
| `/api/setup/status` | `GET` | `beta` | `/api/setup` | `app/api/setup/status/route.ts` |
| `/api/signals` | `GET` | `experimental` | `(default)` | `app/api/signals/route.ts` |
| `/api/stream` | `GET` | `experimental` | `(default)` | `app/api/stream/route.ts` |
| `/api/team-tasks` | `GET, POST` | `experimental` | `(default)` | `app/api/team-tasks/route.ts` |
| `/api/team-tasks/{taskId}` | `GET, PATCH` | `experimental` | `(default)` | `app/api/team-tasks/[taskId]/route.ts` |
| `/api/team-tasks/{taskId}/events` | `GET, POST` | `experimental` | `(default)` | `app/api/team-tasks/[taskId]/events/route.ts` |
| `/api/telegram/webhook` | `POST` | `experimental` | `(default)` | `app/api/telegram/webhook/route.ts` |
| `/api/webhooks` | `DELETE, GET, POST` | `stable` | `/api/webhooks` | `app/api/webhooks/route.ts` |
| `/api/webhooks/{webhookId}/deliveries` | `GET` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/deliveries/route.ts` |
| `/api/webhooks/{webhookId}/test` | `POST` | `stable` | `/api/webhooks` | `app/api/webhooks/[webhookId]/test/route.ts` |
| `/api/workspace/export` | `GET` | `experimental` | `(default)` | `app/api/workspace/export/route.ts` |
| `/api/workspace/import` | `POST` | `experimental` | `(default)` | `app/api/workspace/import/route.ts` |

