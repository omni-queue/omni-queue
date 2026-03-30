import express from 'express';
import type { DashboardAuthOptions } from '@omni-queue/core';
import type { DashboardApiOptions } from '../types';
import { normalizeBase } from '../utils/http';
import { buildDashboardRouter } from '../routes/dashboard';

function resolveDashboardConfig(options: DashboardApiOptions) {
  const base = normalizeBase(options.endpoint ?? options.apiBase, '/api/dashboard');
  return {
    base,
    legacyBase: base === '/dashboard' ? undefined : '/dashboard',
    auth: options.auth ?? options.supervisor.getDashboardOptions()?.auth ?? ({ type: 'none' } satisfies DashboardAuthOptions),
    streamIntervalMs: options.streamIntervalMs ?? options.supervisor.getDashboardOptions()?.streamIntervalMs ?? 2000,
  };
}

export function createDashboardRequestHandler(
  options: DashboardApiOptions
): (app: express.Application) => void {
  const resolved = resolveDashboardConfig(options);

  return (app: express.Application) => {
    const router = buildDashboardRouter(options.supervisor, resolved.auth, resolved.streamIntervalMs);
    app.use(resolved.base, router);
    if (resolved.legacyBase) {
      app.use(resolved.legacyBase, router);
    }
  };
}
