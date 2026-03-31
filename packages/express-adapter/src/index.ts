import {
  bindOmniQueueWebSocket,
  createDashboardMiddleware,
  type DashboardApiOptions,
} from '@omni-queue/dashboard-api';

export function createExpressAdapter(options: DashboardApiOptions) {
  return createDashboardMiddleware(options);
}

export function createExpressWebSocketBinding(
  ...args: Parameters<typeof bindOmniQueueWebSocket>
) {
  return bindOmniQueueWebSocket(...args);
}

