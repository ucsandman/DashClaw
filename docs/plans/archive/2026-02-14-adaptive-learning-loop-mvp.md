---
source-of-truth: true
owner: Platform PM
last-verified: 2026-02-14
doc-type: rfc
---

# RFC: Adaptive Learning Loop MVP

- RFC ID: RFC-2026-02-14-adaptive-learning-loop-mvp
- Status: Approved and implemented (MVP + production-hardening slice)
- Date: February 14, 2026
- Horizon: 2 weeks

## 1. Objective

Implement a lightweight adaptive loop so agent behavior improves from observed outcomes without introducing full RL infrastructure.

MVP outcome:
- Score completed agent actions as learning episodes.
- Synthesize per-agent/per-action-type recommendations from historical high-performing episodes.
- Expose recommendations via API and SDKs.
- Capture recommendation telemetry and expose recommendation effectiveness metrics.
- Provide recommendation operations controls (enable/disable) for admins.

## 2. Non-Goals (MVP)

- No online policy gradient or runtime model fine-tuning.
- No automated prompt mutation pipeline.
- No cross-org learning transfer.
- No breaking changes to existing action/learning APIs.

## 3. Design Summary

The implementation introduces three data planes:
1. `learning_episodes`: normalized, scored trajectory outcomes for actions.
2. `learning_recommendations`: synthesized hints derived from top-scoring episodes.
3. `learning_recommendation_events`: recommendation telemetry events (`fetched`, `applied`, `overridden`, `outcome`).

Flow:
1. Agent updates an action outcome (`PATCH /api/actions/{actionId}`).
2. Server computes an episode score from outcome/risk/reversibility/loops/assumptions.
3. Episode is upserted into `learning_episodes`.
4. Rebuild API synthesizes recommendations from recent episodes.
5. SDK methods fetch/rebuild/apply hints before future actions.
6. Recommendation event telemetry is recorded and correlated with outcome episodes.
7. Metrics API computes adoption and outcome deltas per recommendation.

## 4. Schema Changes

Migration script:
- `scripts/migrate-learning-loop-mvp.mjs`

New tables:
- `learning_episodes`
  - Keys: `id` (PK), unique `(org_id, action_id)`
  - Core fields: `agent_id`, `action_type`, `status`, `outcome_label`, `risk_score`, `reversible`, `confidence`, `duration_ms`, `cost_estimate`
  - Diagnostics: `invalidated_assumptions`, `open_loops`, `score`, `score_breakdown`
  - Recommendation linkage: `recommendation_id`, `recommendation_applied`
  - Timestamps: `created_at`, `updated_at`
- `learning_recommendations`
  - Keys: `id` (PK), unique `(org_id, agent_id, action_type)`
  - Core fields: `confidence`, `sample_size`, `top_sample_size`, `success_rate`, `avg_score`
  - Recommendation payloads: `hints` (JSON string), `guidance` (JSON string)
  - Ops state: `active` (default enabled)
  - Timestamps: `computed_at`, `updated_at`
- `learning_recommendation_events`
  - Keys: `id` (PK)
  - Linkage: `recommendation_id`, `agent_id`, `action_id`
  - Telemetry: `event_type`, `event_key`, `details`
  - Timestamps: `created_at`

Extended columns:
- `action_records.recommendation_id`
- `action_records.recommendation_applied`
- `action_records.recommendation_override_reason`

Indexes:
- `learning_episodes(org_id, agent_id, action_type)`
- `learning_episodes(org_id, recommendation_id)`
- `learning_episodes(updated_at)`
- `learning_recommendations(org_id, agent_id)`
- `learning_recommendations(org_id, active)`
- `learning_recommendation_events(org_id, created_at)`
- `learning_recommendation_events(org_id, recommendation_id, created_at)`
- `learning_recommendation_events(org_id, action_id)`
- `learning_recommendation_events(org_id, event_key)` (unique)

## 5. API Changes

### Existing Endpoint Extension

- `PATCH /api/actions/{actionId}`
  - Existing contract unchanged.
  - New side effect: best-effort episode scoring and upsert into `learning_episodes`.

### New Endpoint

- `GET /api/learning/recommendations`
  - Query: `agent_id?`, `action_type?`, `limit?`, `include_inactive?`, `track_events?`, `include_metrics?`, `lookback_days?`
  - Returns: recommendation rows with `hints` + `guidance`, optional metrics blob.

- `POST /api/learning/recommendations`
  - Body: `agent_id?`, `action_type?`, `lookback_days?`, `episode_limit?`, `min_samples?`, `action_id?`
  - Behavior:
    - Optional `action_id` pre-score before rebuild.
    - Rebuild recommendations from filtered recent episodes.
  - Returns: rebuild summary + recommendation rows.

- `POST /api/learning/recommendations/events`
  - Body: single event or `events[]` batch (`fetched|applied|overridden|outcome`)
  - Returns: created events count.

- `GET /api/learning/recommendations/metrics`
  - Query: `agent_id?`, `action_type?`, `lookback_days?`, `limit?`, `include_inactive?`
  - Returns: per-recommendation telemetry/outcome metrics and summary aggregates.

- `PATCH /api/learning/recommendations/{recommendationId}`
  - Body: `{ active: boolean }`
  - Auth: admin/service role
  - Returns: updated recommendation row.

## 6. SDK Changes

Node SDK (`sdk/dashclaw.js`):
- `getRecommendations(filters?)`
- `getRecommendationMetrics(filters?)`
- `rebuildRecommendations(options?)`
- `recommendAction(action)`
- `recordRecommendationEvents(events)`
- `setRecommendationActive(recommendationId, active)`
- Constructor options: `autoRecommend`, `recommendationConfidenceMin`, `recommendationCallback`

Python SDK (`sdk-python/dashclaw/client.py`):
- `get_recommendations(...)`
- `get_recommendation_metrics(...)`
- `rebuild_recommendations(...)`
- `recommend_action(action)`
- `record_recommendation_events(events)`
- `set_recommendation_active(recommendation_id, active)`
- Constructor options: `auto_recommend`, `recommendation_confidence_min`, `recommendation_callback`

## 7. Scoring Heuristic (MVP)

Episode score range: `0..100`.

Signals used:
- Outcome status (`completed` vs `failed`/`cancelled`)
- Risk score
- Reversibility
- Duration and cost
- Confidence calibration
- Invalidated assumptions
- Open loops

This is deliberately deterministic and auditable for v1.

## 8. Rollout Plan

1. Run `npm run migrate:learning-loop` in each environment.
2. Deploy API + SDK changes.
3. Backfill episodes passively as actions complete.
4. Trigger recommendation rebuild job on schedule (or manually via POST endpoint).

## 9. Acceptance Criteria

- Action outcome updates produce `learning_episodes` rows.
- Recommendation rebuild returns non-empty rows for agents with sufficient history.
- SDKs can fetch/apply hints and support safe auto-adapt with override fallback.
- Recommendation telemetry (`fetched/applied/overridden/outcome`) is persisted.
- Metrics API returns adoption and outcome deltas.
- Recommendation active state can be toggled via API and dashboard UI.
- Unit tests cover route validation and core recommendation flows.

## 10. Risks and Mitigations

- Sparse data yields weak recommendations.
  - Mitigation: `min_samples` threshold + confidence scaling + explicit guidance note.
- Heuristic bias from simplistic scoring.
  - Mitigation: store `score_breakdown` for audit and tuning.
- Runtime overhead on action PATCH.
  - Mitigation: single best-effort scoring pass; failure does not block action update.
