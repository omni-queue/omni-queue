import {
  bindVastoWebSocket,
  createDashboardMiddleware,
  type DashboardApiOptions,
} from '@vasto-queue/dashboard-api';

export function createExpressAdapter(options: DashboardApiOptions) {
  return createDashboardMiddleware(options);
}

export function createExpressWebSocketBinding(
  ...args: Parameters<typeof bindVastoWebSocket>
) {
  return bindVastoWebSocket(...args);
}

