import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DashboardApiOptions, DashboardWebSocketController } from '../types';
import { checkAuth } from '../middleware/request-auth';
import { buildDashboardRouter } from '../routes/dashboard';
import { resolveDashboardConfig, resolveDashboardWsPaths } from './factories';
import { attachDashboardWebSocket } from './websocket';

const require = createRequire(import.meta.url);

function loadExpress(): any {
  return require('express');
}

export function vastoAdapter(options: DashboardApiOptions): any {
  const express = loadExpress();
  const app = express();
  const resolved = resolveDashboardConfig(options);
  const router = buildDashboardRouter(options.supervisor, resolved.auth, resolved.streamIntervalMs);

  app.use(resolved.base, router);
  if (resolved.legacyBase) {
    app.use(resolved.legacyBase, router);
  }

  if (resolved.uiDir && fs.existsSync(resolved.uiDir)) {
    const indexFile = path.join(resolved.uiDir, 'index.html');
    const uiRouter = express.Router();

    if (resolved.protectUiWithAuth) {
      uiRouter.use(async (req: any, res: any, next: any) => {
        if (await checkAuth(req, res, resolved.auth)) {
          next();
        }
      });
    }

    uiRouter.use(express.static(resolved.uiDir, { maxAge: '1d' }));

    if (fs.existsSync(indexFile)) {
      uiRouter.get('*', (req: any, res: any, next: any) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        res.sendFile(indexFile);
      });
    }

    app.use(resolved.uiBase, uiRouter);
  }

  return app;
}

export function bindVastoWebSocket(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  const resolved = resolveDashboardConfig(options);
  return attachDashboardWebSocket(
    server,
    resolveDashboardWsPaths(resolved),
    options,
    resolved.auth,
    resolved.streamIntervalMs
  );
}

export function createDashboardMiddleware(options: DashboardApiOptions) {
  return vastoAdapter(options);
}

export function createDashboardWebSocketBinding(
  server: http.Server,
  options: DashboardApiOptions
): DashboardWebSocketController {
  return bindVastoWebSocket(server, options);
}
