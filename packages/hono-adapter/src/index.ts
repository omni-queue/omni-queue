import http from 'node:http';
import express from 'express';
import {
  createDashboardRequestHandler,
  type DashboardApiOptions,
} from '@omni-queue/dashboard-api';

export function omniQueueHonoAdapter(options: DashboardApiOptions) {
  const app = express();
  createDashboardRequestHandler(options)(app);

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    app(req as express.Request, res as express.Response);
  };
}
