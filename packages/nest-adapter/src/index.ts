import http from 'node:http';
import {
  bindVastoWebSocket,
  vastoAdapter,
  type DashboardApiOptions,
  type DashboardWebSocketController,
} from '@vasto/dashboard-api';

export interface NestLikeApplication {
  use: (...args: unknown[]) => unknown;
}

export function vastoNestAdapter(options: DashboardApiOptions) {
  return vastoAdapter(options);
}

export function bindVastoNestWebSocket(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  return bindVastoWebSocket(server, options);
}

export function registerNestAdapter(app: NestLikeApplication, options: DashboardApiOptions): void {
  app.use(vastoNestAdapter(options));
}
