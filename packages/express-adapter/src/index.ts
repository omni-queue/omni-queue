import express from 'express';
import {
  createDashboardRequestHandler,
  type DashboardApiOptions,
} from '@omni-queue/dashboard-api';

export function omniQueueExpressAdapter(options: DashboardApiOptions): express.RequestHandler {
  const app = express();
  createDashboardRequestHandler(options)(app);
  return app;
}

export function createExpressAdapter(options: DashboardApiOptions) {
  return omniQueueExpressAdapter(options);
}

export {
  omniQueueExpressAdapter as createDefaultDashboardMiddleware,
};
