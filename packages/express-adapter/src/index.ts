import {
  createDashboardExpressMiddleware,
  startDashboardServer,
  type DashboardApiOptions,
  type StandaloneDashboardServerOptions,
} from '@omni-queue/dashboard-api';

export function createExpressAdapter(options: DashboardApiOptions) {
  return createDashboardExpressMiddleware(options);
}

export function startExpressAdapter(options: StandaloneDashboardServerOptions) {
  return startDashboardServer(options);
}

export {
  createDashboardExpressMiddleware as createDefaultDashboardMiddleware,
  startDashboardServer as startDefaultDashboardServer,
};
