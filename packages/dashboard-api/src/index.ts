export {
  resolveDashboardConfig,
  resolveDashboardWsPaths,
} from './server/factories';
export {
  bindVastoWebSocket,
  createDashboardMiddleware,
  createDashboardWebSocketBinding,
  vastoAdapter,
} from './server/adapter';
export {
  authenticateDashboardLogin,
  authenticateDashboardRequest,
  authenticateDashboardSession,
  extractDashboardBearerToken,
  hasDashboardPermissionForContext,
  resolveDashboardAuthHandler,
  resolveDashboardChallenge,
  resolveDashboardLoginMode,
  resolveDashboardSessionValidator,
} from './middleware/auth';
export {
  checkAuth,
  getAllowedQueues,
  getDashboardAuthContext,
  hasDashboardPermission,
  sendUnauthorized,
} from './middleware/request-auth';
export { buildDashboardRouter } from './routes/dashboard';
export { queryArchive, updateArchiveRetention } from './services/archive';
export { getDashboardBatch, listDashboardBatches } from './services/batches';
export {
  getDashboardJobById,
  getDashboardJobs,
  getSilencedJobs,
  type DashboardJobFilterStatus,
} from './services/jobs';
export { getMonitoringTag, listMonitoringTags } from './services/monitoring';
export { buildOverview } from './services/overview';
export { buildSloReport } from './services/slo';
export { createScopedBearerAuth, rotateScopedBearerTokens } from './middleware/token-auth';
export { asNonNegativeInt, asPositiveInt, asString } from './utils/http';
export type {
  DashboardApiOptions,
  DashboardOptions,
  DashboardWebSocketController,
} from './types';
