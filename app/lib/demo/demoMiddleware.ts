// This file is a facade over the topic-split demoMiddleware.*.ts siblings.
// It re-exports every name previously exported from this file so existing
// imports (middleware.js, tests) keep working unchanged.
export type { DemoFixtures } from './demoMiddleware.actions';
export {
  demoActionArtifacts,
  demoAgents,
  demoListActions,
  demoCreateAction,
  demoActionDetail,
  demoAssumptions,
  demoActionTrace,
  demoDecisionMetrics,
} from './demoMiddleware.actions';
export {
  demoPolicies,
  demoApprovalFloods,
  demoPolicySummary,
  demoContract,
  demoReview,
  demoPolicySimulate,
  demoPolicyProof,
  demoPolicyTest,
  demoGuard,
  demoGuardPost,
  demoTuningProposals,
  demoTighteningProposals,
  demoLooseningProposals,
  demoCalibrationProposals,
  demoCalibrationController,
} from './demoMiddleware.policies';
export {
  demoSessions,
  demoSessionDetail,
  demoSessionEvents,
  demoSessionActions,
  demoIdentities,
  demoApiKeys,
  demoPlans,
  demoPlanDetail,
} from './demoMiddleware.sessions';
export {
  demoActivity,
  demoWebhooks,
  demoWebhookDeliveries,
  demoDoctor,
  demoTeam,
  demoUsage,
} from './demoMiddleware.misc';
