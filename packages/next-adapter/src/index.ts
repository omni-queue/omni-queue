import {
  createDashboardExpressMiddleware,
  startDashboardServer,
  type DashboardApiOptions,
  type StandaloneDashboardServerOptions,
} from '@omni-queue/dashboard-api';

export function createNextAdapter(options: DashboardApiOptions) {
  return createDashboardExpressMiddleware(options);
}

export function startNextAdapter(options: StandaloneDashboardServerOptions) {
  return startDashboardServer(options);
}
