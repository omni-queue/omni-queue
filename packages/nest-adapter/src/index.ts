import http from 'node:http';
import {
  bindOmniQueueWebSocket,
  omniQueueAdapter,
  type DashboardApiOptions,
  type DashboardWebSocketController,
} from '@omni-queue/dashboard-api';

export interface NestLikeApplication {
  use: (...args: unknown[]) => unknown;
}

export function omniQueueNestAdapter(options: DashboardApiOptions) {
  return omniQueueAdapter(options);
}

export function bindOmniQueueNestWebSocket(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  return bindOmniQueueWebSocket(server, options);
}

export function registerNestAdapter(app: NestLikeApplication, options: DashboardApiOptions): void {
  app.use(omniQueueNestAdapter(options));
}
