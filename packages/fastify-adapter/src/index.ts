import {
  createDashboardExpressMiddleware,
  startDashboardServer,
  type DashboardApiOptions,
  type StandaloneDashboardServerOptions,
} from '@omni-queue/dashboard-api';

export interface FastifyLike {
  use?: (...args: unknown[]) => unknown;
}

export function registerFastifyAdapter(app: FastifyLike, options: DashboardApiOptions): void {
  if (typeof app.use !== 'function') {
    throw new Error(
      'Fastify adapter requires app.use middleware support. Enable @fastify/middie or @fastify/express first.'
    );
  }

  app.use(createDashboardExpressMiddleware(options));
}

export function startFastifyAdapter(options: StandaloneDashboardServerOptions) {
  return startDashboardServer(options);
}
