# LOC report

Source: `scripts/loc-report.mjs` on working tree @ d6b6b42c (dirty). Thresholds: file >= 1,500 LOC, function >= 150 LOC.

## Scope

Measured trees: `app/`, `sdk/`, `sdk-python/dashclaw/`, `mcp-server/src/`, `mcp-server/bin/`, `cli/bin/`, `cli/lib/`, `hooks/`, `scripts/`, `schema/`, `packages/openclaw-plugin/src/`, `packages/dashclaw-demo/bin/`, `middleware.js`, `next.config.js`, `drizzle.config.js`, `vitest.config.js`, `tailwind.config.js`, `postcss.config.js`, `playwright.config.js`, `eslint.config.mjs`.

Excluded: tests (`__tests__/`, `tests/`, `sdk-python/tests/`, `mcp-server/test/`, `cli/test/`, `*.test.*`, `test_*.py`), node_modules, .next, public/downloads, dist/, `*.generated.*`, `generated/`, `mcp-server/lib/` (compiled), `plugins/dashclaw/hooks/` (mirror), `*.d.ts`.

## Totals

| Metric | Value |
|---|---:|
| Source files | 820 |
| Source LOC (raw lines) | 163,106 |
| Source code lines (blanks + comments stripped) | 134,229 |
| Functions (named + anonymous, all depths) | 7,940 |
| Test files (not measured, counted for fan-in) | 616 |
| Test LOC | 105,561 |

### By language

| Language | Files | LOC | Code |
|---|---:|---:|---:|
| javascript | 206 | 43,171 | 34,185 |
| python | 27 | 13,610 | 8,916 |
| typescript | 587 | 106,325 | 91,128 |

### By tree

| Tree | Files | LOC | Code | Functions |
|---|---:|---:|---:|---:|
| app/lib | 264 | 48,790 | 40,714 | 2,204 |
| app/(pages) | 157 | 37,278 | 33,659 | 1,982 |
| scripts | 125 | 26,136 | 21,156 | 1,282 |
| app/api | 132 | 15,512 | 12,329 | 536 |
| hooks | 17 | 8,887 | 5,217 | 322 |
| app/components | 63 | 7,338 | 6,472 | 481 |
| cli | 23 | 7,154 | 5,637 | 415 |
| mcp-server | 18 | 2,979 | 2,515 | 162 |
| (root) | 8 | 2,534 | 1,735 | 172 |
| schema | 1 | 2,224 | 1,757 | 107 |
| packages/openclaw-plugin | 3 | 1,548 | 1,294 | 82 |
| sdk-python | 5 | 1,369 | 820 | 100 |
| sdk | 3 | 1,276 | 862 | 91 |
| packages/dashclaw-demo | 1 | 81 | 62 | 4 |

## Files >= 1,500 LOC (9)

| File | LOC | Code | Functions | Longest fn | Fan-in (src) | Fan-in (tests) |
|---|---:|---:|---:|---:|---:|---:|
| app/lib/repositories/actions.repository.ts | 2,601 | 2,278 | 117 | 95 | 23 | 22 |
| scripts/hn_readiness.py | 2,593 | 2,304 | 103 | 237 | 0 | 0 |
| hooks/dashclaw_pretool.py | 2,268 | 1,272 | 92 | 77 | 0 | 0 |
| schema/schema.js | 2,224 | 1,757 | 107 | 39 | 1 | 1 |
| middleware.js | 2,096 | 1,438 | 166 | 76 | 0 | 9 |
| scripts/policy-smoke.mjs | 1,943 | 1,429 | 47 | 1825 | 0 | 0 |
| scripts/migrate-multi-tenant.mjs | 1,937 | 1,806 | 24 | 48 | 0 | 0 |
| app/lib/guard/evaluate.ts | 1,804 | 1,352 | 73 | 356 | 2 | 0 |
| app/lib/demo/demoMiddleware.ts | 1,700 | 1,467 | 134 | 225 | 1 | 2 |

## Functions >= 150 LOC (115)

Depth 0 = top-level; deeper rows are nested inside the row above them in the same file.

| File | Function | Lines | LOC | Depth | Exported |
|---|---|---|---:|---:|---|
| scripts/policy-smoke.mjs | main | 114-1938 | 1825 | 0 |  |
| app/docs/page.tsx | DocsPage | 192-1488 | 1297 | 0 | yes |
| app/policies/components/Ledger.tsx | Ledger | 410-1332 | 923 | 0 | yes |
| app/decisions/page.tsx | DecisionsLedgerInner | 122-997 | 876 | 0 |  |
| app/approvals/page.tsx | ApprovalsPage | 90-850 | 761 | 0 | yes |
| app/setup/page.tsx | SetupPage | 261-1002 | 742 | 0 | yes |
| app/identities/page.tsx | IdentitiesPage | 75-784 | 710 | 0 | yes |
| app/webhooks/page.tsx | WebhooksPage | 73-739 | 667 | 0 | yes |
| app/integrations/page.tsx | IntegrationsPage | 65-677 | 613 | 0 | yes |
| mcp-server/src/tools.ts | createToolHandlers | 468-1009 | 542 | 0 | yes |
| scripts/drills/hosted-buyer.mjs | main | 148-668 | 521 | 0 |  |
| app/page.tsx | LandingPage | 140-645 | 506 | 0 | yes |
| app/policies/components/PolicyRuleBuilderSection.tsx | PolicyRuleBuilderSection | 491-980 | 490 | 0 | yes |
| app/api-keys/page.tsx | ApiKeysPage | 21-505 | 485 | 0 | yes |
| app/decisions/[actionId]/page.tsx | DecisionReplayPage | 38-519 | 482 | 0 | yes |
| app/connect/page.tsx | FullConnectGuide | 186-655 | 470 | 0 |  |
| app/components/AssumptionGraph.tsx | AssumptionGraph | 36-482 | 447 | 0 | yes |
| app/audit-log/page.tsx | AuditLogPage | 37-471 | 435 | 0 | yes |
| app/approve/page.tsx | ApprovePage | 103-527 | 425 | 0 | yes |
| app/policies/components/TriageInbox.tsx | TriageInbox | 861-1285 | 425 | 0 | yes |
| scripts/bootstrap-agent.mjs | main | 1096-1491 | 396 | 0 |  |
| app/settings/components/AgentIdentityPanel.tsx | AgentIdentityPanel | 44-438 | 395 | 0 | yes |
| app/api/actions/route.ts | POST | 239-630 | 392 | 0 | yes |
| app/assumptions/page.tsx | AssumptionsPage | 40-430 | 391 | 0 | yes |
| cli/lib/telegram/setup.js | runTelegramSetup | 94-484 | 391 | 0 | yes |
| app/policies/components/CalibrationSection.tsx | CalibrationSection | 139-522 | 384 | 0 | yes |
| app/sessions/[sessionId]/page.tsx | SessionDetailPage | 58-427 | 370 | 0 | yes |
| app/self-host/page.tsx | SelfHostPage | 19-384 | 366 | 0 | yes |
| app/replay/[actionId]/page.tsx | PublicReplayPage | 145-507 | 363 | 0 | yes |
| app/lib/guard/evaluate.ts | evaluateGuard | 1411-1766 | 356 | 0 | yes |
| app/policies/components/ShortListSection.tsx | ShortListSection | 165-517 | 353 | 0 | yes |
| app/components/GovernanceSignalsPanel.tsx | GovernanceSignalsPanel | 86-428 | 343 | 0 | yes |
| app/policies/components/TriageInbox.tsx | InboxRow | 341-681 | 341 | 0 |  |
| app/api/capabilities/[capabilityId]/invoke/route.ts | POST | 28-351 | 324 | 0 | yes |
| app/lib/signals.ts | computeSignals | 482-793 | 312 | 0 | yes |
| app/settings/page.tsx | SettingsPage | 39-346 | 308 | 0 | yes |
| app/settings/components/ModelPricingPanel.tsx | ModelPricingPanel | 19-324 | 306 | 0 | yes |
| app/guides/discord-approvals/page.tsx | DiscordApprovalsGuidePage | 22-326 | 305 | 0 | yes |
| app/components/NotificationCenter.tsx | NotificationCenter | 27-330 | 304 | 0 | yes |
| app/widget/page.jsx | WidgetPage | 74-373 | 300 | 0 | yes |
| app/guides/hermes/page.tsx | HermesGuidePage | 22-315 | 294 | 0 | yes |
| app/self-host/SetupTabs.tsx | SetupTabs | 39-332 | 294 | 0 | yes |
| app/policies/packs/PackGallery.tsx | PackDrawer | 239-530 | 292 | 0 |  |
| app/downloads/page.tsx | DownloadsPage | 122-408 | 287 | 0 | yes |
| scripts/test-sdk-agent.py | run_tests | 53-334 | 282 | 0 | yes |
| app/lib/demo/demoFixtures.ts | buildFixtures | 17-294 | 278 | 0 |  |
| app/guides/platform/PlatformGuideClient.tsx | GuideBody | 61-332 | 272 | 0 |  |
| app/guides/codex/page.tsx | CodexGuidePage | 22-292 | 271 | 0 | yes |
| app/policies/components/PolicyAdvancedImportPanel.tsx | PolicyAdvancedImportPanel | 30-300 | 271 | 0 | yes |
| app/api/actions/[actionId]/route.ts | PATCH | 86-353 | 268 | 0 | yes |
| app/decisions/page.tsx | (anonymous) | 724-989 | 266 | 1 |  |
| app/policies/components/ExternalVerdictPanel.tsx | ExternalVerdictPanel | 61-315 | 255 | 0 | yes |
| app/explain/page.tsx | ExplainPage | 31-284 | 254 | 0 | yes |
| app/guides/openclaw/page.tsx | OpenClawGuidePage | 22-271 | 250 | 0 | yes |
| app/sessions/page.tsx | SessionsPage | 63-308 | 246 | 0 | yes |
| app/components/LiveDemo.tsx | LiveDemo | 84-326 | 243 | 0 | yes |
| app/approvals/page.tsx | (anonymous) | 541-782 | 242 | 1 | yes |
| app/blog/claude-code-beachhead/page.tsx | BlogPostPage | 36-273 | 238 | 0 | yes |
| app/components/Sidebar.tsx | Sidebar | 68-304 | 237 | 0 | yes |
| app/guides/claude-code/page.tsx | ClaudeCodeGuidePage | 22-258 | 237 | 0 | yes |
| scripts/hn_readiness.py | check_launch_kit | 945-1181 | 237 | 0 | yes |
| app/blog/codex-parity/page.tsx | BlogPostPage | 27-262 | 236 | 0 | yes |
| app/api/actions/[actionId]/containment/route.ts | POST | 55-289 | 235 | 0 | yes |
| app/guides/vercel-ai-sdk/page.tsx | VercelAiSdkGuidePage | 21-250 | 230 | 0 | yes |
| app/policies/components/PolicyWorkbench.tsx | PolicyWorkbench | 33-261 | 229 | 0 | yes |
| app/lib/demo/demoMiddleware.ts | demoActionDetail | 356-580 | 225 | 0 | yes |
| app/decisions/[actionId]/_components/PoliciesTab.tsx | PoliciesTab | 19-242 | 224 | 0 | yes |
| app/lib/doctor/checks/governance.mjs | runChecks | 36-258 | 223 | 0 | yes |
| app/api/policies/loosening/route.ts | POST | 308-526 | 219 | 0 | yes |
| app/lib/repositories/agents.repository.ts | listAgentsForOrg | 105-321 | 217 | 0 | yes |
| app/approvals/_components/ContainmentCard.tsx | ContainmentCard | 52-265 | 214 | 0 | yes |
| app/guides/pydantic-ai/page.tsx | PydanticAiGuidePage | 21-234 | 214 | 0 | yes |
| app/blog/hermes-plugin/page.tsx | BlogPostPage | 25-231 | 207 | 0 | yes |
| app/guides/autogen/page.tsx | AutoGenGuidePage | 21-225 | 205 | 0 | yes |
| app/api/plans/[planId]/route.ts | POST | 48-247 | 200 | 0 | yes |
| app/practical-systems/page.tsx | PracticalSystemsPage | 18-217 | 200 | 0 | yes |
| app/lib/session-retro.ts | buildSessionRetro | 89-287 | 199 | 0 | yes |
| app/api/plans/route.ts | POST | 59-256 | 198 | 0 | yes |
| app/guides/platform/components/PolicyPlayground.tsx | PolicyPlayground | 76-273 | 198 | 0 | yes |
| hooks/enforcement_liveness_probe.py | main | 612-808 | 197 | 0 | yes |
| app/guides/langgraph/page.tsx | LangGraphGuidePage | 21-214 | 194 | 0 | yes |
| app/lib/widget/pulse.ts | composePulse | 239-432 | 194 | 0 | yes |
| app/policies/components/GeneratePanel.tsx | GeneratePanel | 30-223 | 194 | 0 | yes |
| app/api/guard/route.ts | POST | 469-659 | 191 | 0 | yes |
| app/approvals/_components/LivePlansSection.tsx | LivePlansSection | 83-266 | 184 | 0 | yes |
| cli/bin/dashclaw.js | cmdContainedApply | 848-1031 | 184 | 0 |  |
| app/approvals/_components/PlanReviewCard.tsx | PlanReviewCard | 33-215 | 183 | 0 | yes |
| app/guides/crewai/page.tsx | CrewAIGuidePage | 21-200 | 180 | 0 | yes |
| app/policies/components/PolicyRuleBuilderSection.tsx | DelegationConstraintFields | 150-328 | 179 | 0 |  |
| app/api/policies/review/verdict/route.ts | POST | 63-240 | 178 | 0 | yes |
| app/team/page.tsx | TeamPage | 39-216 | 178 | 0 | yes |
| app/api/stream/route.ts | GET | 19-195 | 177 | 0 | yes |
| app/connect/FirstGovernedActionCard.jsx | FirstGovernedActionCard | 49-225 | 177 | 0 | yes |
| app/settings/components/GovernancePanel.tsx | GovernancePanel | 38-213 | 176 | 0 | yes |
| app/webhooks/page.tsx | (anonymous) | 540-715 | 176 | 1 | yes |
| app/connect/HostedProvisionClient.jsx | HostedProvisionClient | 30-203 | 174 | 0 | yes |
| cli/lib/openclaw/install.js | installOpenclaw | 462-635 | 174 | 0 | yes |
| app/lib/doctor/checks/write-canary.mjs | runChecks | 56-228 | 173 | 0 | yes |
| app/api/approvals/[actionId]/route.ts | POST | 37-207 | 171 | 0 | yes |
| app/components/context-menu/ContextMenu.tsx | ContextMenu | 19-189 | 171 | 0 | yes |
| app/api/policies/tightening/route.ts | POST | 156-323 | 168 | 0 | yes |
| app/api/cron/signals/route.ts | GET | 55-216 | 162 | 0 | yes |
| app/lib/readiness/databaseCheck.mjs | buildDatabaseSection | 4-164 | 161 | 0 | yes |
| scripts/cross-org-smoke.mjs | main | 70-230 | 161 | 0 |  |
| scripts/drills/claim-flow.mjs | main | 89-249 | 161 | 0 |  |
| app/guides/openai-agents-sdk/page.tsx | OpenAIAgentsSdkGuidePage | 21-180 | 160 | 0 | yes |
| app/pricing/page.tsx | PricingPage | 90-248 | 159 | 0 | yes |
| app/proof/page.tsx | ProofPage | 106-262 | 157 | 0 | yes |
| app/login/LoginClient.tsx | LoginClient | 16-170 | 155 | 0 | yes |
| cli/lib/up/index.js | runUp | 264-418 | 155 | 0 | yes |
| app/api/guard/route.ts | recordRunningAction | 95-245 | 151 | 0 |  |
| app/components/ArtifactsTab.tsx | ArtifactsTab | 113-263 | 151 | 0 | yes |
| app/lib/readiness/workflow.mjs | buildRecommendations | 79-228 | 150 | 0 | yes |
| app/policies/components/TriageInbox.tsx | describe | 133-282 | 150 | 0 |  |
| scripts/startup-smoke.mjs | main | 66-215 | 150 | 0 |  |

## Highest fan-in (top 30, source importers)

Fan-in counts distinct importing files resolved through relative and `@/` specifiers (imports, re-exports, require, dynamic import). Bare package imports are not edges.

| File | Fan-in (src) | Fan-in (tests) | LOC | LOC x fan-in |
|---|---:|---:|---:|---:|
| app/lib/db.ts | 126 | 3 | 100 | 12,600 |
| app/lib/org.ts | 88 | 3 | 16 | 1,408 |
| app/lib/types/db.ts | 59 | 11 | 18 | 1,062 |
| app/lib/apiErrors.ts | 44 | 1 | 80 | 3,520 |
| app/components/ui/Card.tsx | 31 | 0 | 73 | 2,263 |
| app/lib/marketingSeo.ts | 29 | 1 | 99 | 2,871 |
| app/lib/repositories/settings.repository.ts | 26 | 2 | 385 | 10,010 |
| scripts/_db.mjs | 26 | 0 | 53 | 1,378 |
| app/components/PublicNavbar.tsx | 24 | 0 | 128 | 3,072 |
| app/components/PublicFooter.tsx | 24 | 0 | 63 | 1,512 |
| app/lib/repositories/actions.repository.ts | 23 | 22 | 2,601 | 59,823 |
| app/lib/events.ts | 22 | 1 | 584 | 12,848 |
| app/lib/repositories/guardrails.repository.ts | 22 | 6 | 444 | 9,768 |
| app/components/ui/Badge.tsx | 22 | 0 | 30 | 660 |
| app/lib/audit.ts | 20 | 1 | 71 | 1,420 |
| app/components/PageLayout.tsx | 19 | 1 | 84 | 1,596 |
| app/lib/security.ts | 18 | 1 | 89 | 1,602 |
| app/lib/guard.ts | 16 | 42 | 29 | 464 |
| app/components/JsonLd.tsx | 15 | 0 | 17 | 255 |
| app/lib/policy-shapes.ts | 14 | 6 | 416 | 5,824 |
| app/components/ui/Skeleton.tsx | 14 | 0 | 49 | 686 |
| app/lib/guideContent.ts | 14 | 0 | 41 | 574 |
| app/lib/calibration-mining.js | 13 | 7 | 478 | 6,214 |
| app/components/ui/CollapsibleSection.tsx | 13 | 1 | 152 | 1,976 |
| scripts/_load-env.mjs | 13 | 0 | 39 | 507 |
| app/lib/isDemoMode.ts | 13 | 0 | 19 | 247 |
| app/lib/repositories/hosted-workspace.repository.ts | 12 | 6 | 619 | 7,428 |
| app/lib/hosted/flag.ts | 12 | 1 | 22 | 264 |
| app/components/ui/EmptyState.tsx | 12 | 0 | 21 | 252 |
| app/lib/validate.js | 11 | 19 | 1,028 | 11,308 |

## God-file rank (LOC x max(1, fan-in), top 25)

| Rank | File | LOC | Fan-in | LOC x fan-in |
|---:|---|---:|---:|---:|
| 1 | app/lib/repositories/actions.repository.ts | 2,601 | 23 | 59,823 |
| 2 | app/lib/events.ts | 584 | 22 | 12,848 |
| 3 | app/lib/db.ts | 100 | 126 | 12,600 |
| 4 | app/lib/validate.js | 1,028 | 11 | 11,308 |
| 5 | app/lib/webhooks.ts | 911 | 11 | 10,021 |
| 6 | app/lib/repositories/settings.repository.ts | 385 | 26 | 10,010 |
| 7 | app/lib/repositories/guardrails.repository.ts | 444 | 22 | 9,768 |
| 8 | app/lib/repositories/hosted-workspace.repository.ts | 619 | 12 | 7,428 |
| 9 | app/lib/guard/caches.ts | 695 | 10 | 6,950 |
| 10 | app/lib/calibration-mining.js | 478 | 13 | 6,214 |
| 11 | app/lib/policy-shapes.ts | 416 | 14 | 5,824 |
| 12 | sdk/dashclaw.js | 1,153 | 5 | 5,765 |
| 13 | app/lib/posture/loosening.ts | 822 | 7 | 5,754 |
| 14 | app/lib/guard/evaluate.ts | 1,804 | 2 | 3,608 |
| 15 | app/lib/apiErrors.ts | 80 | 44 | 3,520 |
| 16 | app/lib/sessions.ts | 553 | 6 | 3,318 |
| 17 | app/lib/repositories/agents.repository.ts | 468 | 7 | 3,276 |
| 18 | app/lib/signals.ts | 793 | 4 | 3,172 |
| 19 | app/components/PublicNavbar.tsx | 128 | 24 | 3,072 |
| 20 | app/lib/marketingSeo.ts | 99 | 29 | 2,871 |
| 21 | app/lib/guard/calibration.ts | 462 | 6 | 2,772 |
| 22 | app/lib/repositories/plans.repository.ts | 653 | 4 | 2,612 |
| 23 | scripts/hn_readiness.py | 2,593 | 0 | 2,593 |
| 24 | app/lib/policy-tuning/engine.ts | 361 | 7 | 2,527 |
| 25 | app/lib/policy-modes/compile.ts | 359 | 7 | 2,513 |

## Duplicate helper clusters

### Same-named functions in 2+ files, bodies similar (token 3-gram Jaccard >= 0.60) (70)

Similarity 1.00 with identical pairs > 0 means byte-for-byte the same tokens. JS/TS only; top-level or exported, >= 3 lines.

| Name | Files | Max similarity | Identical pairs | Total LOC | Sites |
|---|---:|---:|---:|---:|---|
| log | 14 | 1.00 | 13 | 46 | scripts/auto-migrate.mjs:39-41<br>scripts/migrate-agent-pairings.mjs:27-29<br>scripts/migrate-hitl-metadata.mjs:28-30<br>scripts/migrate-identity-binding.mjs:27-29<br>scripts/migrate-multi-tenant.mjs:31-33<br>scripts/migrate-policy-agent-scope.mjs:29-31<br>scripts/refresh-bundles.mjs:102-104<br>scripts/release-mcp-server.mjs:21-23<br>scripts/release-sdks.mjs:10-12<br>scripts/security-scan.js:82-84<br>scripts/setup.mjs:69-75<br>scripts/test-actions.mjs:27-29<br>scripts/test-full-api.mjs:41-43<br>scripts/test-sdk-live.mjs:53-55 |
| parseRules | 9 | 1.00 | 1 | 84 | app/approvals/_components/ActiveGrantsStrip.tsx:43-50<br>app/lib/guardrails/short-list.ts:74-85<br>app/lib/inert-policies.ts:45-54<br>app/lib/policy-modes/summary.ts:157-167<br>app/lib/policy-tuning/engine.ts:149-158<br>app/lib/posture/loosening.ts:148-157<br>app/policies/components/Ledger.tsx:126-129<br>app/policies/lib/misfireClient.ts:24-35<br>app/policies/lib/policyFormModel.js:109-115 |
| check | 6 | 1.00 | 1 | 22 | app/lib/doctor/checks/write-canary.mjs:31-33<br>cli/lib/local-doctor.js:108-110<br>scripts/cross-org-smoke.mjs:52-55<br>scripts/living-merge/selftest-merge.ts:45-48<br>scripts/living-merge/selftest-overlap.ts:40-43<br>scripts/policy-smoke.mjs:106-109 |
| arg | 5 | 1.00 | 1 | 23 | scripts/add-calibration-vector.mjs:42-45<br>scripts/build-desktop-plugin.mjs:24-27<br>scripts/guard-load.mjs:60-66<br>scripts/mine-calibration-candidates.mjs:35-38<br>scripts/telegram-verify-loop.mjs:13-16 |
| git | 5 | 1.00 | 1 | 23 | scripts/living-merge/install.ts:42-48<br>scripts/living-merge/overlap-signal.ts:23-29<br>scripts/living-merge/rebase-onto-main.ts:33-35<br>scripts/living-merge/selftest-merge.ts:34-36<br>scripts/living-merge/selftest-overlap.ts:26-28 |
| assert | 4 | 1.00 | 1 | 37 | scripts/live-canary.mjs:50-54<br>scripts/test-actions.mjs:31-41<br>scripts/test-full-api.mjs:45-55<br>scripts/test-sdk-live.mjs:57-66 |
| errorFrom | 4 | 1.00 | 6 | 16 | app/policies/lib/calibrationClient.ts:72-75<br>app/policies/lib/looseningClient.ts:148-151<br>app/policies/lib/proposalsClient.ts:47-50<br>app/policies/lib/tighteningClient.ts:48-51 |
| generateApiKey | 4 | 1.00 | 3 | 19 | app/api/keys/route.ts:16-19<br>app/api/orgs/[orgId]/keys/route.ts:21-24<br>app/api/orgs/route.ts:21-24<br>app/lib/repositories/hosted-workspace.repository.ts:20-26 |
| hashKey | 4 | 1.00 | 3 | 16 | app/api/keys/route.ts:12-14<br>app/api/orgs/[orgId]/keys/route.ts:17-19<br>app/api/orgs/route.ts:16-18<br>app/api/setup/ping/route.ts:9-15 |
| decisionSummary | 3 | 1.00 | 1 | 28 | app/api/calibration/proposals/route.ts:42-51<br>app/api/policies/loosening/route.ts:59-67<br>app/api/policies/tightening/route.ts:40-48 |
| getSql | 3 | 1.00 | 1 | 64 | app/api/actions/[actionId]/trace/route.ts:10-14<br>app/api/signals/route.ts:15-19<br>app/lib/db.ts:47-100 |
| isNeonUrl | 3 | 1.00 | 1 | 10 | app/lib/db.ts:34-37<br>app/lib/setupStatus.mjs:13-15<br>scripts/_db.mjs:12-14 |
| jsonFetch | 3 | 1.00 | 1 | 45 | scripts/drills/claim-flow.mjs:64-79<br>scripts/drills/hosted-buyer.mjs:97-112<br>scripts/drills/hosted-stranger.mjs:67-79 |
| parseHostname | 3 | 1.00 | 1 | 21 | app/lib/db.ts:26-32<br>app/lib/setupStatus.mjs:5-11<br>scripts/_db.mjs:4-10 |
| readJson | 3 | 1.00 | 1 | 17 | app/lib/doctor/checks/openclawPlugin.mjs:54-60<br>scripts/lib/contracts/check-sdk-surface.mjs:5-9<br>scripts/lib/contracts/load-contracts.mjs:4-8 |
| record | 3 | 1.00 | 1 | 15 | scripts/drills/claim-flow.mjs:58-62<br>scripts/drills/hosted-buyer.mjs:79-83<br>scripts/drills/hosted-stranger.mjs:61-65 |
| __resetInsecureUrlWarning | 2 | 1.00 | 1 | 6 | cli/lib/config.js:116-118<br>mcp-server/src/dashclaw/client.ts:52-54 |
| backupOnce | 2 | 1.00 | 1 | 14 | cli/lib/codex/install.js:483-489<br>cli/lib/openclaw/install.js:400-406 |
| buildPromotionGoal | 2 | 1.00 | 1 | 6 | app/lib/guard/containment.ts:186-188<br>cli/lib/contained.js:27-29 |
| computeSummary | 2 | 1.00 | 1 | 14 | app/lib/doctor/engine.mjs:74-80<br>cli/lib/doctor.js:144-150 |
| getApiRoot | 2 | 1.00 | 1 | 6 | scripts/lib/api-route-inventory.mjs:52-54<br>scripts/lib/route-sql-guard.mjs:19-21 |
| getCandidates | 2 | 1.00 | 1 | 41 | scripts/run-python-unittest.mjs:18-38<br>scripts/run-sdk-live-python.mjs:27-46 |
| getInventoryJsonPath | 2 | 1.00 | 1 | 6 | scripts/check-api-inventory-diff.mjs:11-13<br>scripts/generate-api-inventory.mjs:11-13 |
| getInventoryMarkdownPath | 2 | 1.00 | 1 | 6 | scripts/check-api-inventory-diff.mjs:15-17<br>scripts/generate-api-inventory.mjs:15-17 |
| handleCopyIds | 2 | 1.00 | 1 | 8 | app/assumptions/page.tsx:188-191<br>app/audit-log/page.tsx:147-150 |
| invalid | 2 | 1.00 | 1 | 6 | app/api/enforcement-liveness/route.ts:36-38<br>app/api/live-canary/route.ts:32-34 |
| isDbContainmentRef | 2 | 1.00 | 1 | 6 | app/lib/guard/containment.ts:91-93<br>cli/lib/contained.js:23-25 |
| isPemPublicKey | 2 | 1.00 | 1 | 6 | app/api/identities/route.ts:9-11<br>app/api/pairings/route.ts:9-11 |
| isShortString | 2 | 1.00 | 1 | 6 | app/api/enforcement-liveness/route.ts:40-42<br>app/api/live-canary/route.ts:36-38 |
| isStaleCustomerError | 2 | 1.00 | 1 | 14 | app/api/billing/checkout/route.ts:27-33<br>app/api/billing/portal/route.ts:15-21 |
| isUnixPathLike | 2 | 1.00 | 1 | 8 | scripts/bootstrap-agent.mjs:114-117<br>scripts/lib/extractors.mjs:19-22 |
| isWindows | 2 | 1.00 | 1 | 6 | scripts/run-python-unittest.mjs:14-16<br>scripts/run-sdk-live-python.mjs:23-25 |
| isWindowsPathLike | 2 | 1.00 | 1 | 8 | scripts/bootstrap-agent.mjs:109-112<br>scripts/lib/extractors.mjs:14-17 |
| looksLikeJwt | 2 | 1.00 | 1 | 18 | app/lib/jwks-verifier.ts:327-335<br>middleware.js:1728-1736 |
| normalize | 2 | 1.00 | 1 | 6 | scripts/check-api-inventory-diff.mjs:27-29<br>scripts/check-openapi-diff.mjs:18-20 |
| pct | 2 | 1.00 | 1 | 6 | app/lib/policy-tuning/engine.ts:115-117<br>app/lib/posture/loosening.ts:144-146 |
| resolveTimeoutMinutes | 2 | 1.00 | 1 | 24 | app/api/admin/trigger-outcome-sweep/route.ts:15-26<br>app/api/cron/outcome-sweep/route.ts:21-32 |
| safeDisconnect | 2 | 1.00 | 1 | 22 | app/lib/events.ts:70-80<br>app/lib/org-rate-limit.ts:85-95 |
| sameList | 2 | 1.00 | 1 | 6 | scripts/lib/contracts/check-setup-env-prerequisites.mjs:31-33<br>scripts/lib/contracts/check-setup-prerequisites.mjs:27-29 |
| Section | 2 | 1.00 | 1 | 16 | app/agents/page.tsx:15-22<br>app/privacy/page.tsx:17-24 |
| showSuccess | 2 | 1.00 | 1 | 8 | app/identities/page.tsx:168-171<br>app/settings/components/AgentIdentityPanel.tsx:112-115 |
| sleep | 2 | 1.00 | 1 | 6 | app/lib/capability-invoke.ts:74-76<br>scripts/drills/fresh-windows.mjs:45-47 |
| tableExists | 2 | 1.00 | 1 | 18 | scripts/migrate-action-records-compat.mjs:19-27<br>scripts/migrate-api-keys-compat.mjs:21-29 |
| withCommandTimeout | 2 | 1.00 | 1 | 22 | app/lib/events.ts:55-65<br>app/lib/org-rate-limit.ts:50-60 |
| isSecretLike | 2 | 0.98 | 0 | 28 | scripts/bootstrap-agent.mjs:119-132<br>scripts/lib/extractors.mjs:24-37 |
| buildResolvedText | 2 | 0.97 | 0 | 26 | app/api/discord/interactions/route.ts:161-173<br>app/api/telegram/webhook/route.ts:55-67 |
| cookieFromSetCookie | 2 | 0.96 | 0 | 14 | scripts/drills/claim-flow.mjs:81-87<br>scripts/drills/hosted-buyer.mjs:114-120 |
| redactAny | 2 | 0.95 | 0 | 30 | app/lib/guard/evaluate.ts:69-82<br>app/lib/security.ts:49-64 |
| walkRouteFiles | 3 | 0.90 | 0 | 61 | scripts/lib/api-route-inventory.mjs:106-122<br>scripts/lib/contracts/check-api-surface.mjs:14-39<br>scripts/lib/route-sql-guard.mjs:23-40 |
| formatDate | 3 | 0.86 | 0 | 16 | app/api-keys/page.tsx:127-131<br>app/identities/page.tsx:60-64<br>app/settings/components/AgentIdentityPanel.tsx:7-12 |
| buildPinnedDispatcher | 2 | 0.84 | 0 | 65 | app/lib/url-safety.ts:138-162<br>app/lib/webhooks.ts:79-118 |
| b64url | 2 | 0.83 | 0 | 15 | app/lib/doctor/fixes/generate-secrets.mjs:5-11<br>scripts/setup.mjs:191-198 |
| CopyButton | 5 | 0.82 | 0 | 108 | app/components/ArtifactsTab.tsx:12-28<br>app/connect/HostedProvisionClient.jsx:7-28<br>app/decisions/[actionId]/_components/CopyButton.tsx:11-29<br>app/guides/GuideClient.tsx:10-32<br>app/guides/platform/components/CopyButton.tsx:6-32 |
| timeAgo | 3 | 0.82 | 0 | 24 | app/approve/page.tsx:14-23<br>app/sessions/[sessionId]/page.tsx:15-21<br>app/sessions/page.tsx:22-28 |
| buildPromotionAct | 2 | 0.80 | 0 | 21 | app/lib/guard/containment.ts:203-214<br>cli/lib/contained.js:37-45 |
| copyDirRecursive | 2 | 0.80 | 0 | 23 | cli/lib/claude/install.js:129-138<br>cli/lib/codex/install.js:102-114 |
| withAbort | 2 | 0.80 | 0 | 30 | app/lib/capability-invoke.ts:35-45<br>app/lib/webhooks.ts:250-268 |
| parseArgs | 13 | 0.79 | 0 | 160 | scripts/bootstrap-agent.mjs:75-87<br>scripts/check-contracts.mjs:8-13<br>scripts/diagnose-hooks.mjs:34-44<br>scripts/drills/claim-flow.mjs:42-55<br>scripts/drills/fresh-linux.mjs:23-36<br>scripts/drills/fresh-windows.mjs:32-43<br>scripts/drills/hosted-buyer.mjs:63-76<br>scripts/drills/hosted-stranger.mjs:41-58<br>scripts/init-self-host-env.mjs:5-13<br>scripts/install-hooks.mjs:89-95<br>scripts/repair-stale-running-actions.mjs:47-59<br>scripts/smoke-hosted.mjs:21-33<br>scripts/startup-smoke.mjs:26-41 |
| waitReady | 2 | 0.79 | 0 | 26 | scripts/demo-entrypoint.mjs:5-17<br>scripts/run-demo.mjs:12-24 |
| warnIfInsecureBaseUrl | 2 | 0.79 | 0 | 28 | cli/lib/config.js:120-133<br>mcp-server/src/dashclaw/client.ts:56-69 |
| safeJsonParse | 3 | 0.75 | 0 | 22 | app/lib/repositories/artifacts.repository.ts:8-12<br>app/lib/repositories/capabilities.repository.ts:81-89<br>scripts/add-calibration-vector.mjs:90-97 |
| npmVersionExists | 2 | 0.74 | 0 | 26 | scripts/release-mcp-server.mjs:27-38<br>scripts/release-sdks.mjs:18-31 |
| toIso | 5 | 0.73 | 0 | 30 | app/lib/policy-tuning/engine.ts:160-164<br>app/lib/repositories/fanouts.repository.ts:64-68<br>app/lib/repositories/policy-review.repository.ts:62-72<br>app/lib/repositories/self-governance.repository.ts:35-39<br>app/lib/silent-lane-witness.ts:57-60 |
| loadConsumerSources | 2 | 0.73 | 0 | 41 | scripts/lib/contracts/check-setup-env-prerequisites.mjs:62-78<br>scripts/lib/contracts/check-setup-prerequisites.mjs:31-54 |
| handleCopy | 5 | 0.71 | 0 | 36 | app/api-keys/page.tsx:95-103<br>app/components/CopyableCodeBlock.tsx:15-20<br>app/components/InlineCopyCommand.tsx:15-19<br>app/guides/platform/components/CopyButton.tsx:9-17<br>app/policies/components/ProofExportPanel.tsx:50-56 |
| unauthorized | 2 | 0.71 | 0 | 6 | app/api/discord/interactions/route.ts:72-74<br>app/api/telegram/webhook/route.ts:17-19 |
| request | 2 | 0.68 | 0 | 38 | scripts/test-actions.mjs:43-61<br>scripts/test-full-api.mjs:63-81 |
| ensureTable | 5 | 0.65 | 0 | 83 | app/lib/repositories/identities.repository.ts:5-19<br>app/lib/repositories/integration-health.repository.ts:5-19<br>app/lib/repositories/jti-replay.repository.ts:32-46<br>app/lib/repositories/pairings.repository.ts:5-25<br>app/lib/repositories/signal-dismissals.repository.ts:9-25 |
| parsePositiveInt | 2 | 0.61 | 0 | 8 | app/lib/hosted/flag.ts:5-8<br>app/lib/org-rate-limit.ts:73-76 |
| tryRun | 2 | 0.61 | 0 | 41 | scripts/run-python-unittest.mjs:40-60<br>scripts/run-sdk-live-python.mjs:48-67 |

### Same-named functions in 2+ files, bodies differ (similarity < 0.60) (115)

Same name, different behaviour: candidates for a rename or a review, not a merge.

| Name | Files | Max similarity | Sites |
|---|---:|---:|---|
| run | 20 | 0.57 | app/components/context-menu/actionRegistry.tsx<br>app/guides/platform/components/PolicyPlayground.tsx<br>cli/lib/up/db.js<br>scripts/living-merge/rebase-onto-main.ts<br>scripts/migrate-agent-messages-index.mjs<br>scripts/migrate-agent-pairings.mjs<br>scripts/migrate-agent-schedules.mjs<br>scripts/migrate-cost-analytics.mjs<br>scripts/migrate-hitl-metadata.mjs<br>scripts/migrate-ideas-subscores.mjs<br>scripts/migrate-identity-binding.mjs<br>scripts/migrate-message-attachments.mjs<br>scripts/migrate-multi-tenant.mjs<br>scripts/migrate-policy-agent-scope.mjs<br>scripts/migrate-prompt-injection.mjs<br>scripts/migrate-token-budgets.mjs<br>scripts/precommit-lint-typecheck.mjs<br>scripts/release-mcp-server.mjs<br>scripts/release-prep.mjs<br>scripts/setup.mjs |
| deriveIdempotencyKey | 2 | 0.57 | mcp-server/src/tools.ts<br>sdk/dashclaw.js |
| handleBulkRevoke | 2 | 0.56 | app/api-keys/page.tsx<br>app/identities/page.tsx |
| base64url | 2 | 0.55 | app/lib/oauth/crypto.ts<br>scripts/init-self-host-env.mjs |
| parseJsonObject | 2 | 0.54 | app/api/approvals/[actionId]/grant/route.ts<br>app/lib/parseJson.ts |
| submit | 2 | 0.53 | app/approvals/_components/ContainmentCard.tsx<br>app/approvals/_components/PlanReviewCard.tsx |
| CodeBlock | 4 | 0.52 | app/agents/page.tsx<br>app/connect/page.tsx<br>app/docs/page.tsx<br>app/settings/components/Common.tsx |
| ensureDir | 2 | 0.52 | scripts/install-hooks.mjs<br>scripts/refresh-bundles.mjs |
| normalizeGoal | 3 | 0.50 | app/lib/calibration-mining.js<br>app/lib/guard/deviation.ts<br>app/lib/session-retro.ts |
| isEnabled | 2 | 0.50 | app/lib/discordApprovals.ts<br>app/lib/telegramApprovals.ts |
| finish | 4 | 0.49 | cli/lib/codex/trust.js<br>scripts/drills/claim-flow.mjs<br>scripts/drills/hosted-buyer.mjs<br>scripts/drills/hosted-stranger.mjs |
| ask | 3 | 0.48 | cli/lib/config.js<br>cli/lib/telegram/setup.js<br>scripts/setup.mjs |
| extractSections | 2 | 0.48 | scripts/bootstrap-agent.mjs<br>scripts/lib/extractors.mjs |
| safeRead | 2 | 0.48 | scripts/bootstrap-agent.mjs<br>scripts/lib/extractors.mjs |
| killTree | 2 | 0.47 | cli/lib/up/index.js<br>scripts/release-prep.mjs |
| handleRevoke | 2 | 0.46 | app/api-keys/page.tsx<br>app/identities/page.tsx |
| createPolicy | 3 | 0.45 | app/policies/lib/shortListClient.ts<br>scripts/bench-guard-hotpath.mjs<br>scripts/policy-smoke.mjs |
| addIndexes | 2 | 0.45 | scripts/migrate-action-records-compat.mjs<br>scripts/migrate-api-keys-compat.mjs |
| ensureTrailingNewline | 2 | 0.45 | cli/lib/codex/install.js<br>cli/lib/openclaw/install.js |
| slugify | 2 | 0.42 | app/lib/repositories/capabilities.repository.ts<br>mcp-server/src/util.ts |
| handleCreate | 2 | 0.39 | app/api-keys/page.tsx<br>app/webhooks/page.tsx |
| send | 9 | 0.36 | app/api/stream/route.ts<br>app/guides/platform/components/TryItPanel.tsx<br>app/lib/notification-adapters/discord.ts<br>app/lib/notification-adapters/email.ts<br>app/lib/notification-adapters/github.ts<br>app/lib/notification-adapters/linear.ts<br>app/lib/notification-adapters/slack.ts<br>app/policies/lib/shortListClient.ts<br>cli/lib/codex/trust.js |
| mergeAgentsMd | 2 | 0.33 | cli/lib/codex/install.js<br>cli/lib/openclaw/install.js |
| num | 3 | 0.29 | app/lib/approval-flood.ts<br>app/lib/confidence-calibration.ts<br>app/lib/widget/pulse.ts |
| onKey | 4 | 0.27 | app/components/ConnectAgentButton.tsx<br>app/components/context-menu/ContextMenu.tsx<br>app/lib/useSelectAllHotkey.ts<br>app/policies/components/Ledger.tsx |
| validateSnapshot | 3 | 0.26 | app/api/calibration/proposals/route.ts<br>app/api/policies/loosening/route.ts<br>app/api/policies/tightening/route.ts |
| snapshotOf | 3 | 0.25 | app/policies/lib/calibrationClient.ts<br>app/policies/lib/looseningClient.ts<br>app/policies/lib/tighteningClient.ts |
| sendApprovalMessage | 2 | 0.24 | app/lib/discordApprovals.ts<br>app/lib/telegramApprovals.ts |
| argValue | 2 | 0.23 | scripts/bench-guard-hotpath.mjs<br>scripts/living-merge/rebase-onto-main.ts |
| askYesNo | 2 | 0.23 | cli/lib/openclaw/wizard.js<br>cli/lib/telegram/setup.js |
| addColumns | 2 | 0.21 | scripts/migrate-action-records-compat.mjs<br>scripts/migrate-api-keys-compat.mjs |
| isMissingTable | 2 | 0.21 | app/lib/repositories/agents.repository.ts<br>app/lib/repositories/calibration-state.repository.ts |
| parseEnvFile | 2 | 0.21 | scripts/init-self-host-env.mjs<br>scripts/setup.mjs |
| BlogPostPage | 3 | 0.20 | app/blog/claude-code-beachhead/page.tsx<br>app/blog/codex-parity/page.tsx<br>app/blog/hermes-plugin/page.tsx |
| handleDelete | 3 | 0.20 | app/components/ArtifactsTab.tsx<br>app/policies/components/Ledger.tsx<br>app/webhooks/page.tsx |
| walk | 4 | 0.19 | app/lib/repositories/settings.repository.ts<br>scripts/check-surface-budget.mjs<br>scripts/check-version-hardcodes.mjs<br>scripts/lib/discovery.mjs |
| loadEnvFile | 2 | 0.18 | scripts/_load-env.mjs<br>scripts/bootstrap-agent.mjs |
| newId | 2 | 0.18 | app/lib/oauth/crypto.ts<br>mcp-server/src/util.ts |
| readPyprojectVersion | 2 | 0.18 | scripts/check-version-hardcodes.mjs<br>scripts/release-sdks.mjs |
| fail | 5 | 0.17 | app/lib/capability-contracts.ts<br>mcp-server/src/tools/index.ts<br>scripts/auto-migrate.mjs<br>scripts/check-production-ready.mjs<br>scripts/setup.mjs |
| DashClawLogo | 2 | 0.16 | app/components/DashClawLogo.tsx<br>app/replay/[actionId]/page.tsx |
| normalizePath | 2 | 0.15 | app/lib/guard/protected-path.ts<br>scripts/living-merge/manifest.ts |
| handleSave | 3 | 0.14 | app/integrations/page.tsx<br>app/policies/components/Ledger.tsx<br>app/settings/components/GovernancePanel.tsx |
| runChecks | 10 | 0.13 | app/lib/doctor/checks/auth.mjs<br>app/lib/doctor/checks/config.mjs<br>app/lib/doctor/checks/data-hygiene.mjs<br>app/lib/doctor/checks/database.mjs<br>app/lib/doctor/checks/deployment.mjs<br>app/lib/doctor/checks/governance.mjs<br>app/lib/doctor/checks/hosted.mjs<br>app/lib/doctor/checks/openclawPlugin.mjs<br>app/lib/doctor/checks/sdk.mjs<br>app/lib/doctor/checks/write-canary.mjs |
| migrate | 4 | 0.13 | scripts/migrate-evaluations.mjs<br>scripts/migrate-feedback.mjs<br>scripts/migrate-prompts.mjs<br>scripts/migrate-scoring-profiles.mjs |
| resolveAgentIdentity | 2 | 0.13 | app/lib/guard-identity.ts<br>app/lib/identity-resolution.ts |
| redactSecret | 2 | 0.11 | cli/lib/telegram/setup.js<br>scripts/setup.mjs |
| testAssumptions | 2 | 0.11 | scripts/test-actions.mjs<br>scripts/test-sdk-live.mjs |
| askSecret | 3 | 0.10 | cli/lib/config.js<br>cli/lib/telegram/setup.js<br>scripts/setup.mjs |
| formatAge | 2 | 0.10 | app/lib/widget/pulse.ts<br>cli/bin/dashclaw.js |
| groupByCategory | 2 | 0.10 | app/components/DoctorPanel.tsx<br>scripts/lib/classifiers.mjs |
| apply | 4 | 0.09 | app/lib/doctor/fixes/create-default-policy.mjs<br>app/lib/doctor/fixes/fix-cors.mjs<br>app/lib/doctor/fixes/migrate.mjs<br>app/lib/doctor/fixes/normalize-timestamps.mjs |
| agent_allowlist | 2 | 0.09 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| protected_path | 2 | 0.09 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| revoke | 2 | 0.09 | app/approvals/_components/ActiveGrantsStrip.tsx<br>app/approvals/_components/LivePlansSection.tsx |
| risk_threshold | 2 | 0.09 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| scanFile | 2 | 0.09 | scripts/check-version-hardcodes.mjs<br>scripts/security-scan.js |
| release | 2 | 0.08 | scripts/release-mcp-server.mjs<br>scripts/release-sdks.mjs |
| shapeKey | 2 | 0.08 | app/lib/calibration-mining.js<br>app/lib/policy-shapes.ts |
| preflight | 2 | 0.07 | cli/lib/claude/install.js<br>scripts/guard-load.mjs |
| guardBody | 2 | 0.06 | scripts/bench-guard-hotpath.mjs<br>scripts/guard-load.mjs |
| StatTile | 2 | 0.06 | app/policies/components/CalibrationSection.tsx<br>app/usage/page.jsx |
| _authHeaders | 2 | 0.05 | mcp-server/src/client.ts<br>sdk/dashclaw.js |
| delegation_constraint | 2 | 0.05 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| loadEnv | 2 | 0.05 | scripts/bootstrap-agent.mjs<br>scripts/repair-stale-running-actions.mjs |
| resolvePath | 2 | 0.05 | app/lib/mapping.ts<br>app/lib/template-vars.ts |
| summarize | 5 | 0.04 | app/lib/confidence-calibration.ts<br>scripts/bench-guard-hotpath.mjs<br>scripts/diagnose-hooks.mjs<br>scripts/guard-load.mjs<br>scripts/live-canary.mjs |
| branch_freshness | 2 | 0.04 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| dismiss | 2 | 0.04 | app/components/HelpIcon.tsx<br>app/components/context-menu/ContextMenuProvider.tsx |
| normalizeHost | 2 | 0.04 | app/lib/guideContent.ts<br>app/lib/validate.js |
| post | 2 | 0.04 | mcp-server/src/client.ts<br>scripts/demo-agent.mjs |
| createSession | 2 | 0.03 | app/lib/sessions.ts<br>sdk/dashclaw.js |
| evaluatePolicy | 2 | 0.03 | app/explain/sections.tsx<br>app/lib/guard/policy.ts |
| green_contract | 2 | 0.03 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| PolicyPlayground | 2 | 0.03 | app/explain/sections.tsx<br>app/guides/platform/components/PolicyPlayground.tsx |
| resolveApiKey | 2 | 0.03 | cli/lib/openclaw/install.js<br>middleware.js |
| role_constraint | 2 | 0.03 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| sanitizeText | 2 | 0.03 | app/lib/liveVerificationProof.mjs<br>scripts/regen-platform-guide-examples.mjs |
| handleClick | 3 | 0.02 | app/components/AssumptionGraph.tsx<br>app/components/ConnectAgentButton.tsx<br>app/components/TrackedLink.tsx |
| resolveConfig | 3 | 0.02 | app/api/mcp/route.ts<br>cli/lib/config.js<br>packages/openclaw-plugin/src/index.ts |
| createPairing | 2 | 0.02 | app/lib/repositories/pairings.repository.ts<br>sdk/dashclaw.js |
| handleExport | 2 | 0.02 | app/connect/ExportWorkspaceButton.jsx<br>app/policies/components/Ledger.tsx |
| resolveContainment | 2 | 0.02 | app/lib/repositories/actions.repository.ts<br>sdk/dashclaw.js |
| validate | 2 | 0.02 | app/api/oauth/authorize/route.ts<br>app/lib/validate.js |
| classifyFile | 3 | 0.01 | app/lib/guard/evidence.ts<br>packages/openclaw-plugin/src/index.ts<br>scripts/lib/classifiers.mjs |
| applyFix | 2 | 0.01 | app/components/DoctorPanel.tsx<br>app/lib/doctor/fixes/index.mjs |
| buildPolicySummary | 2 | 0.01 | app/lib/policy-modes/summary.ts<br>app/policies/lib/policyFormModel.js |
| deviation_response | 2 | 0.01 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| guard | 2 | 0.01 | mcp-server/src/tools/index.ts<br>sdk/dashclaw.js |
| onClick | 2 | 0.01 | app/components/NotificationCenter.tsx<br>app/sessions/page.tsx |
| rate_limit | 2 | 0.01 | app/lib/guard/policy.ts<br>app/lib/validate.js |
| runDoctor | 2 | 0.01 | app/lib/doctor/engine.mjs<br>cli/lib/doctor.js |
| getClient | 3 | 0.00 | app/lib/marketingEvents.ts<br>app/lib/repositories/oauth.repository.ts<br>packages/openclaw-plugin/src/index.ts |
| ok | 3 | 0.00 | app/api/telegram/webhook/route.ts<br>mcp-server/src/tools/index.ts<br>scripts/setup.mjs |
| step | 3 | 0.00 | app/lib/demo/demoMiddleware.ts<br>scripts/drills/hosted-buyer.mjs<br>scripts/setup.mjs |
| appendTeamTaskEvent | 2 | 0.00 | app/lib/repositories/teamTasks.repository.ts<br>sdk/dashclaw.js |
| attestPlan | 2 | 0.00 | app/lib/repositories/plans.repository.ts<br>sdk/dashclaw.js |
| buildAgentsMdBlock | 2 | 0.00 | cli/lib/codex/install.js<br>cli/lib/openclaw/install.js |
| cleanup | 2 | 0.00 | app/api/stream/route.ts<br>scripts/telegram-verify-loop.mjs |
| createTeamTask | 2 | 0.00 | app/lib/repositories/teamTasks.repository.ts<br>sdk/dashclaw.js |
| finding | 2 | 0.00 | app/lib/guard/deviation.ts<br>scripts/check-hosted-ready.mjs |
| get | 2 | 0.00 | mcp-server/src/client.ts<br>sdk/index.cjs |
| getActionOutcome | 2 | 0.00 | app/lib/repositories/actions.repository.ts<br>sdk/dashclaw.js |
| getSession | 2 | 0.00 | app/lib/sessions.ts<br>sdk/dashclaw.js |
| getSessionEvents | 2 | 0.00 | app/lib/sessions.ts<br>sdk/dashclaw.js |
| listPlans | 2 | 0.00 | app/lib/repositories/plans.repository.ts<br>sdk/dashclaw.js |
| listSessions | 2 | 0.00 | app/lib/sessions.ts<br>sdk/dashclaw.js |
| openclaw | 2 | 0.00 | app/connect/hostedTemplates.js<br>app/lib/policy-modes/compile.ts |
| prune | 2 | 0.00 | app/lib/events.ts<br>app/lib/hosted/rate-limit.ts |
| scanPromptInjection | 2 | 0.00 | app/lib/guard/evaluate.ts<br>sdk/dashclaw.js |
| statusTone | 2 | 0.00 | app/components/ExecutionGraph.tsx<br>app/setup/page.tsx |
| typeLabel | 2 | 0.00 | app/components/ExecutionGraph.tsx<br>app/components/GovernanceSignalsPanel.tsx |
| updateSession | 2 | 0.00 | app/lib/sessions.ts<br>sdk/dashclaw.js |
| updateTeamTask | 2 | 0.00 | app/lib/repositories/teamTasks.repository.ts<br>sdk/dashclaw.js |
| warn | 2 | 0.00 | scripts/refresh-bundles.mjs<br>scripts/setup.mjs |

### Structural clones (identifier-normalized token match, >= 6 lines, 2+ files) (17)

Different names, same shape. Each row is one body that appears at every listed site.

| LOC | Names | Sites |
|---:|---|---|
| 21 | getCandidates | scripts/run-python-unittest.mjs:18-38<br>scripts/run-sdk-live-python.mjs:27-46 |
| 16 | jsonFetch | scripts/drills/claim-flow.mjs:64-79<br>scripts/drills/hosted-buyer.mjs:97-112 |
| 12 | resolveTimeoutMinutes | app/api/admin/trigger-outcome-sweep/route.ts:15-26<br>app/api/cron/outcome-sweep/route.ts:21-32 |
| 11 | withCommandTimeout | app/lib/events.ts:55-65<br>app/lib/org-rate-limit.ts:50-60 |
| 11 | safeDisconnect | app/lib/events.ts:70-80<br>app/lib/org-rate-limit.ts:85-95 |
| 11 | assert | scripts/test-actions.mjs:31-41<br>scripts/test-full-api.mjs:45-55 |
| 7 | parseHostname | app/lib/db.ts:26-32<br>app/lib/setupStatus.mjs:5-11<br>scripts/_db.mjs:4-10 |
| 10 | parseRules | app/lib/policy-tuning/engine.ts:149-158<br>app/lib/posture/loosening.ts:148-157 |
| 9 | decisionSummary | app/api/policies/loosening/route.ts:59-67<br>app/api/policies/tightening/route.ts:40-48 |
| 9 | looksLikeJwt | app/lib/jwks-verifier.ts:327-335<br>middleware.js:1728-1736 |
| 9 | tableExists | scripts/migrate-action-records-compat.mjs:19-27<br>scripts/migrate-api-keys-compat.mjs:21-29 |
| 8 | Section | app/agents/page.tsx:15-22<br>app/privacy/page.tsx:17-24 |
| 7 | isStaleCustomerError | app/api/billing/checkout/route.ts:27-33<br>app/api/billing/portal/route.ts:15-21 |
| 7 | computeSummary | app/lib/doctor/engine.mjs:74-80<br>cli/lib/doctor.js:144-150 |
| 7 | safeJsonArray, parseGuardResponse | app/lib/posture/loosening.ts:748-754<br>app/lib/webhooks.ts:650-656 |
| 7 | backupOnce | cli/lib/codex/install.js:483-489<br>cli/lib/openclaw/install.js:400-406 |
| 6 | isEnabled | app/lib/discordApprovals.ts:65-70<br>app/lib/telegramApprovals.ts:62-67 |
