import {
  createDashboardExpressMiddleware,
  startDashboardServer,
  type DashboardApiOptions,
  type StandaloneDashboardServerOptions,
} from '@omni-queue/dashboard-api';

export interface NestLikeApplication {
  use: (...args: unknown[]) => unknown;
}

export function registerNestAdapter(app: NestLikeApplication, options: DashboardApiOptions): void {
  app.use(createDashboardExpressMiddleware(options));
}

export function startNestAdapter(options: StandaloneDashboardServerOptions) {
  return startDashboardServer(options);
}
