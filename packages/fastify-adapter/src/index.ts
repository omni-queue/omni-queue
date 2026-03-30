import {
  type DashboardApiOptions,
} from '@omni-queue/dashboard-api';
import { omniQueueExpressAdapter } from '@omni-queue/express-adapter';

export interface FastifyLike {
  use?: (...args: unknown[]) => unknown;
}

export function omniQueueFastifyAdapter(options: DashboardApiOptions) {
  return omniQueueExpressAdapter(options);
}

export function registerFastifyAdapter(app: FastifyLike, options: DashboardApiOptions): void {
  if (typeof app.use !== 'function') {
    throw new Error(
      'Fastify adapter requires app.use middleware support. Enable @fastify/middie or @fastify/express first.'
    );
  }

  app.use(omniQueueFastifyAdapter(options));
}
