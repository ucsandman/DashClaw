// Facade: the action-records repository is split by topic into the
// actions.repository.<topic>.ts siblings. Explicit named re-exports (not
// `export *`) so the public surface is identical under every loader: Node's
// CJS named-export lexer cannot see through a star re-export when this file
// is loaded via tsx (app/lib/doctor/checks/write-canary.mjs does that).
export {
  APPROVAL_EXPIRED_ERROR,
  APPROVAL_RETRY_GRACE_SECONDS,
  DEFAULT_APPROVAL_WAIT_SECONDS,
  computeApprovalExpiry,
  expireOverdueApproval,
  findUnconsumedPromotionGrant,
  getActionForGrant,
  getActionRecord,
  getActionStatus,
  getActionSummary,
  getActionTimeBounds,
  hasAction,
  isApprovalOverdue,
  listActionApprovalFacts,
  listPendingApprovalIdsByActionTypes,
  listPendingApprovalIdsByPolicy,
  listPendingApprovalsForGrant,
  markActionBlocked,
  recordApproval,
  recordBulkApprovals,
  resolveContainment,
  setContainmentAwaiting,
  stampExecutedDespite,
  stampPromotionApproval,
  sweepExpiredApprovals,
} from './actions.repository.approvals';
export type { PendingApprovalForGrant } from './actions.repository.approvals';
export {
  getActionByIdempotencyKey,
  getActionIdByIdempotencyKey,
  hasAgentAction,
  isFirstActionForOrg,
  listActions,
} from './actions.repository.list';
export {
  createActionRecord,
  createBlockedActionRecord,
  getActionWithRelations,
  getGuardContextsByIds,
} from './actions.repository.create';
export {
  __resetLostOutcomeSweepThrottle,
  getActionOutcome,
  listOrgsWithStaleOutcomes,
  maybeSweepLostOutcomes,
  setActionOutcome,
  sweepLostOutcomesForOrg,
  updateActionOutcome,
} from './actions.repository.outcome';
export { buildActionGraph, getActionTraceData } from './actions.repository.trace';
export { getActionStats, getConfidenceCalibration } from './actions.repository.stats';
export {
  deleteActionsByFilter,
  deleteActionsByIds,
  listActionIdsByFilter,
  listActionsForSimulation,
} from './actions.repository.delete';
