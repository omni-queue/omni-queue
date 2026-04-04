import http from 'node:http';
import {
  bindVastoWebSocket,
  vastoAdapter,
  type DashboardApiOptions,
  type DashboardWebSocketController,
} from '@vasto/dashboard-api';

export interface FastifyLike {
  use?: (...args: unknown[]) => unknown;
}

export function vastoFastifyAdapter(options: DashboardApiOptions) {
  return vastoAdapter(options);
}

export function bindVastoFastifyWebSocket(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  return bindVastoWebSocket(server, options);
}

export function registerFastifyAdapter(app: FastifyLike, options: DashboardApiOptions): void {
  if (typeof app.use !== 'function') {
    throw new Error(
      'Fastify adapter requires app.use middleware support. Enable @fastify/middie or @fastify/express first.'
    );
  }

  app.use(vastoFastifyAdapter(options));
}
