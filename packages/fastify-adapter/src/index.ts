import http from 'node:http';
import {
  bindOmniQueueWebSocket,
  omniQueueAdapter,
  type DashboardApiOptions,
  type DashboardWebSocketController,
} from '@omni-queue/dashboard-api';

export interface FastifyLike {
  use?: (...args: unknown[]) => unknown;
}

export function omniQueueFastifyAdapter(options: DashboardApiOptions) {
  return omniQueueAdapter(options);
}

export function bindOmniQueueFastifyWebSocket(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  return bindOmniQueueWebSocket(server, options);
}

export function registerFastifyAdapter(app: FastifyLike, options: DashboardApiOptions): void {
  if (typeof app.use !== 'function') {
    throw new Error(
      'Fastify adapter requires app.use middleware support. Enable @fastify/middie or @fastify/express first.'
    );
  }

  app.use(omniQueueFastifyAdapter(options));
}
