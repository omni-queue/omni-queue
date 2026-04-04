import http from 'node:http';
import {
  bindVastoWebSocket,
  vastoAdapter,
  type DashboardApiOptions,
  type DashboardWebSocketController,
} from '@vasto/dashboard-api';

export function vastoHonoAdapter(options: DashboardApiOptions) {
  const app = vastoAdapter(options);

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    app(req as never, res as never, (() => undefined) as never);
  };
}

export function bindVastoHonoWebSocket(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  return bindVastoWebSocket(server, options);
}
