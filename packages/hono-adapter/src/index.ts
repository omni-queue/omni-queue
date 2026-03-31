import http from 'node:http';
import {
  bindOmniQueueWebSocket,
  omniQueueAdapter,
  type DashboardApiOptions,
  type DashboardWebSocketController,
} from '@omni-queue/dashboard-api';

export function omniQueueHonoAdapter(options: DashboardApiOptions) {
  const app = omniQueueAdapter(options);

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    app(req as never, res as never, (() => undefined) as never);
  };
}

export function bindOmniQueueHonoWebSocket(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  return bindOmniQueueWebSocket(server, options);
}
