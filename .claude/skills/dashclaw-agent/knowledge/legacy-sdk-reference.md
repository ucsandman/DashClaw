# DashClaw V1 Legacy SDK Reference

> **Note:** This documents the v1 legacy SDK. For the v2 stable SDK (80 methods), see `sdk-reference.md`.

Complete reference for the DashClaw V1 Legacy SDK — 187 methods across 31 categories.

## Import Paths

```javascript
// ESM
import { DashClaw } from 'dashclaw/legacy';

// CJS bridge
const { DashClaw } = require('dashclaw/legacy');
```

## Backward Compatibility

```javascript
// Alias — both resolve to the same class
import { OpenClawAgent } from 'dashclaw/legacy';
// OpenClawAgent === DashClaw
```

---

## Constructor

```javascript
new DashClaw({
  baseUrl,                          // string — API base URL
  apiKey,                           // string — API key
  agentId,                          // string — agent identifier
  agentName?,                       // string — display name
  swarmId?,                         // string — swarm membership
  guardMode?: 'off'|'warn'|'enforce',
  guardCallback?: Function,
  autoRecommend?: 'off'|'warn'|'enforce',
  recommendationConfidenceMin?: number,  // default 70
  recommendationCallback?: Function,
  hitlMode?: 'off'|'wait',
  privateKey?: CryptoKey|JWK
})
```

---

## 1. Decision Recording (12 methods)

| Method | Parameters |
|---|---|
| `createAction` | `action` |
| `waitForApproval` | `actionId, options` |
| `approveAction` | `actionId, decision, reasoning` |
| `getPendingApprovals` | `options` |
| `updateOutcome` | `actionId, outcome` |
| `getAction` | `actionId` |
| `getActions` | `filters` |
| `getActionTrace` | `actionId` |
| `track` | `actionDef, fn` |
| `heartbeat` | `options` |
| `startHeartbeat` | `options` |
| `stopHeartbeat` | — |

## 2. Decision Integrity — Loops & Assumptions (7 methods)

| Method | Parameters |
|---|---|
| `registerOpenLoop` | `loop` |
| `resolveOpenLoop` | `loopId, status, resolution` |
| `getOpenLoops` | `filters` |
| `registerAssumption` | `assumption` |
| `getAssumption` | `assumptionId` |
| `validateAssumption` | `assumptionId, validated, reason` |
| `getDriftReport` | `filters` |

## 3. Signals (1 method)

| Method | Parameters |
|---|---|
| `getSignals` | — |

## 4. Dashboard & Learning (9 methods)

| Method | Parameters |
|---|---|
| `reportTokenUsage` | `usage` |
| `wrapClient` | `llmClient, options` |
| `recordDecision` | `entry` |
| `getRecommendations` | `filters` |
| `getRecommendationMetrics` | `filters` |
| `recordRecommendationEvents` | `events` |
| `setRecommendationActive` | `recommendationId, active` |
| `rebuildRecommendations` | `options` |
| `recommendAction` | `action` |

## 5. Memory Management (7 methods)

| Method | Parameters |
|---|---|
| `createGoal` | `goal` |
| `recordContent` | `content` |
| `recordInteraction` | `interaction` |
| `createCalendarEvent` | `event` |
| `recordIdea` | `idea` |
| `reportMemoryHealth` | `report` |
| `reportConnections` | `connections` |

## 6. Session Handoffs (3 methods)

| Method | Parameters |
|---|---|
| `createHandoff` | `handoff` |
| `getHandoffs` | `filters` |
| `getLatestHandoff` | — |

## 7. Context Manager (7 methods)

| Method | Parameters |
|---|---|
| `captureKeyPoint` | `point` |
| `getKeyPoints` | `filters` |
| `createThread` | `thread` |
| `addThreadEntry` | `threadId, content, entryType` |
| `closeThread` | `threadId, summary` |
| `getThreads` | `filters` |
| `getContextSummary` | — |

## 8. Automation Snippets (5 methods)

| Method | Parameters |
|---|---|
| `saveSnippet` | `snippet` |
| `getSnippets` | `filters` |
| `getSnippet` | `snippetId` |
| `useSnippet` | `snippetId` |
| `deleteSnippet` | `snippetId` |

## 9. User Preferences (6 methods)

| Method | Parameters |
|---|---|
| `logObservation` | `obs` |
| `setPreference` | `pref` |
| `logMood` | `entry` |
| `trackApproach` | `entry` |
| `getPreferenceSummary` | — |
| `getApproaches` | `filters` |

## 10. Daily Digest (1 method)

| Method | Parameters |
|---|---|
| `getDailyDigest` | `date` |

## 11. Security Scanning (3 methods)

| Method | Parameters |
|---|---|
| `scanContent` | `text, destination` |
| `reportSecurityFinding` | `text, destination` |
| `scanPromptInjection` | `text, options` |

## 12. Agent Messaging (14 methods)

| Method | Parameters |
|---|---|
| `sendMessage` | `params` |
| `getInbox` | `filters` |
| `getSentMessages` | `filters` |
| `getMessages` | `params` |
| `getMessage` | `messageId` |
| `markRead` | `messageIds` |
| `archiveMessages` | `messageIds` |
| `broadcast` | `params` |
| `createMessageThread` | `params` |
| `getMessageThreads` | `filters` |
| `resolveMessageThread` | `threadId, summary` |
| `saveSharedDoc` | `params` |
| `getAttachmentUrl` | `attachmentId` |
| `getAttachment` | `attachmentId` |

## 13. Guard (2 methods)

| Method | Parameters |
|---|---|
| `guard` | `context, options` |
| `getGuardDecisions` | `filters` |

## 14. Policy Testing (3 methods)

| Method | Parameters |
|---|---|
| `testPolicies` | — |
| `getProofReport` | `options` |
| `importPolicies` | `options` |

## 15. Compliance Engine (5 methods)

| Method | Parameters |
|---|---|
| `mapCompliance` | `framework` |
| `analyzeGaps` | `framework` |
| `getComplianceReport` | `framework, options` |
| `listFrameworks` | — |
| `getComplianceEvidence` | `options` |

## 16. Task Routing (10 methods)

| Method | Parameters |
|---|---|
| `listRoutingAgents` | `filters` |
| `registerRoutingAgent` | `agent` |
| `getRoutingAgent` | `agentId` |
| `updateRoutingAgentStatus` | `agentId, status` |
| `deleteRoutingAgent` | `agentId` |
| `listRoutingTasks` | `filters` |
| `submitRoutingTask` | `task` |
| `completeRoutingTask` | `taskId, result` |
| `getRoutingStats` | — |
| `getRoutingHealth` | — |

## 17. Agent Pairing (3 methods)

| Method | Parameters |
|---|---|
| `createPairing` | `options` |
| `createPairingFromPrivateJwk` | `privateJwk, options` |
| `waitForPairing` | `pairingId, options` |

## 18. Identity Binding (3 methods)

| Method | Parameters |
|---|---|
| `registerIdentity` | `identity` |
| `getIdentities` | — |
| `revokeIdentity` | `agentId` |

## 19. Org Management (5 methods)

| Method | Parameters |
|---|---|
| `getOrg` | — |
| `createOrg` | `org` |
| `getOrgById` | `orgId` |
| `updateOrg` | `orgId, updates` |
| `getOrgKeys` | `orgId` |

## 20. Activity Logs (1 method)

| Method | Parameters |
|---|---|
| `getActivityLogs` | `filters` |

## 21. Webhooks (5 methods)

| Method | Parameters |
|---|---|
| `getWebhooks` | — |
| `createWebhook` | `webhook` |
| `deleteWebhook` | `webhookId` |
| `testWebhook` | `webhookId` |
| `getWebhookDeliveries` | `webhookId` |

## 22. Real-Time Events (1 method)

| Method | Parameters |
|---|---|
| `events` | `options` |

Returns an SSE stream handle with `.on()` and `.close()` methods.

```javascript
const stream = client.events({ types: ['action.created'] });
stream.on('action.created', (event) => { /* ... */ });
stream.close();
```

## 23. Bulk Sync (1 method)

| Method | Parameters |
|---|---|
| `syncState` | `state` |

## 24. Evaluations (6 methods)

| Method | Parameters |
|---|---|
| `createScore` | `params` |
| `getScores` | `filters` |
| `createScorer` | `params` |
| `getScorers` | — |
| `updateScorer` | `scorerId, updates` |
| `deleteScorer` | `scorerId` |

## 25. Eval Runs (4 methods)

| Method | Parameters |
|---|---|
| `createEvalRun` | `params` |
| `getEvalRuns` | `filters` |
| `getEvalRun` | `runId` |
| `getEvalStats` | `filters` |

## 26. Prompt Management (12 methods)

| Method | Parameters |
|---|---|
| `listPromptTemplates` | `options` |
| `createPromptTemplate` | `params` |
| `getPromptTemplate` | `templateId` |
| `updatePromptTemplate` | `templateId, fields` |
| `deletePromptTemplate` | `templateId` |
| `listPromptVersions` | `templateId` |
| `createPromptVersion` | `templateId, params` |
| `getPromptVersion` | `templateId, versionId` |
| `activatePromptVersion` | `templateId, versionId` |
| `renderPrompt` | `params` |
| `listPromptRuns` | `params` |
| `getPromptStats` | `params` |

## 27. Feedback Loops (6 methods)

| Method | Parameters |
|---|---|
| `submitFeedback` | `params` |
| `listFeedback` | `filters` |
| `getFeedback` | `feedbackId` |
| `resolveFeedback` | `feedbackId` |
| `deleteFeedback` | `feedbackId` |
| `getFeedbackStats` | `params` |

## 28. Compliance Export (10 methods)

| Method | Parameters |
|---|---|
| `createComplianceExport` | `params` |
| `listComplianceExports` | `options` |
| `getComplianceExport` | `exportId` |
| `downloadComplianceExport` | `exportId` |
| `deleteComplianceExport` | `exportId` |
| `createComplianceSchedule` | `params` |
| `listComplianceSchedules` | — |
| `updateComplianceSchedule` | `scheduleId, fields` |
| `deleteComplianceSchedule` | `scheduleId` |
| `getComplianceTrends` | `params` |

## 29. Behavioral Drift (9 methods)

| Method | Parameters |
|---|---|
| `computeDriftBaselines` | `params` |
| `detectDrift` | `params` |
| `recordDriftSnapshots` | — |
| `listDriftAlerts` | `params` |
| `acknowledgeDriftAlert` | `alertId` |
| `deleteDriftAlert` | `alertId` |
| `getDriftStats` | `params` |
| `getDriftSnapshots` | `params` |
| `getDriftMetrics` | — |

## 30. Learning Analytics (6 methods)

| Method | Parameters |
|---|---|
| `computeLearningVelocity` | `params` |
| `getLearningVelocity` | `params` |
| `computeLearningCurves` | `params` |
| `getLearningCurves` | `params` |
| `getLearningAnalyticsSummary` | `params` |
| `getMaturityLevels` | — |

## 31. Scoring Profiles (17 methods)

| Method | Parameters |
|---|---|
| `createScoringProfile` | `data` |
| `listScoringProfiles` | `params` |
| `getScoringProfile` | `profileId` |
| `updateScoringProfile` | `profileId, data` |
| `deleteScoringProfile` | `profileId` |
| `addScoringDimension` | `profileId, data` |
| `updateScoringDimension` | `profileId, dimensionId, data` |
| `deleteScoringDimension` | `profileId, dimensionId` |
| `scoreWithProfile` | `profileId, action` |
| `batchScoreWithProfile` | `profileId, actions` |
| `getProfileScores` | `params` |
| `getProfileScoreStats` | `profileId` |
| `createRiskTemplate` | `data` |
| `listRiskTemplates` | `params` |
| `updateRiskTemplate` | `templateId, data` |
| `deleteRiskTemplate` | `templateId` |
| `autoCalibrate` | `options` |

---

## Error Classes

### GuardBlockedError

Thrown when `guardMode` is `'enforce'` and a policy blocks the action.

| Property | Type |
|---|---|
| `decision` | string |
| `reasons` | string[] |
| `warnings` | string[] |
| `matchedPolicies` | string[] |
| `riskScore` | number |

### ApprovalDeniedError

Thrown when a human-in-the-loop approval is denied.

---

## V2 Promotion Candidates

Methods under consideration for promotion to the V2 SDK.

### High Priority

| Method | Category |
|---|---|
| `registerOpenLoop` | Decision Integrity |
| `resolveOpenLoop` | Decision Integrity |
| `events()` | Real-Time Events |
| `heartbeat` | Decision Recording |
| `startHeartbeat` | Decision Recording |
| `track()` | Decision Recording |

### Medium Priority

| Method | Category |
|---|---|
| `getRecommendations` | Dashboard & Learning |
| `recommendAction` | Dashboard & Learning |
| `getLearningVelocity` | Learning Analytics |
| `getLearningCurves` | Learning Analytics |
| `getSignals` | Signals |

### Lower Priority

| Suite | Category |
|---|---|
| Drift suite | Behavioral Drift (all 9 methods) |
| Scoring profiles suite | Scoring Profiles (all 17 methods) |
| Compliance engine suite | Compliance Engine (all 5 methods) |
