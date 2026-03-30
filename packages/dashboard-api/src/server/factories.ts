import express from 'express';
import type { DashboardAuthOptions } from '@omni-queue/core';
import { APIAdapter } from './api-adapter';
import type { APIAdapterOptions, DashboardApiOptions, StandaloneDashboardServerOptions } from '../types';
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

export function createDashboardExpressMiddleware(options: DashboardApiOptions): express.RequestHandler {
  const resolved = resolveDashboardConfig(options);
  const router = buildDashboardRouter(options.supervisor, resolved.auth, resolved.streamIntervalMs);

  return (req, res, next) => {
    const matchBase = req.path.startsWith(`${resolved.base}/`) || req.path === resolved.base;
    const matchLegacy = Boolean(
      resolved.legacyBase && (req.path.startsWith(`${resolved.legacyBase}/`) || req.path === resolved.legacyBase)
    );

    if (!matchBase && !matchLegacy) {
      next();
      return;
    }

    const effectiveBase = matchBase ? resolved.base : (resolved.legacyBase as string);
    req.url = req.url.slice(effectiveBase.length) || '/';
    router(req, res, next);
  };
}

export function startDashboardServer(options: StandaloneDashboardServerOptions): APIAdapter {
  const adapterOptions: APIAdapterOptions = { supervisor: options.supervisor };

  if (options.host !== undefined) adapterOptions.host = options.host;
  if (options.port !== undefined) adapterOptions.port = options.port;
  const apiBase = options.endpoint ?? options.apiBase;
  if (apiBase !== undefined) adapterOptions.apiBase = apiBase;
  if (options.auth !== undefined) adapterOptions.auth = options.auth;
  if (options.streamIntervalMs !== undefined) adapterOptions.streamIntervalMs = options.streamIntervalMs;
  if (options.cors !== undefined) adapterOptions.cors = options.cors;
  if (options.uiDir !== undefined) adapterOptions.uiDir = options.uiDir;
  if (options.uiBase !== undefined) adapterOptions.uiBase = options.uiBase;
  if (options.signals !== undefined) adapterOptions.signals = options.signals;

  const adapter = new APIAdapter(adapterOptions);
  void adapter.start();
  return adapter;
}
