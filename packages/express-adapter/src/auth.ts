import type { DashboardAuthContext, DashboardAuthOptions } from '@vasto-queue/core';
import {
  authenticateDashboardRequest,
  hasDashboardPermissionForContext,
} from '@vasto-queue/dashboard-api';
import type { Request, Response } from 'express';

type DashboardPermission = 'read' | 'operate' | 'admin';

function resolveAuthContext(req: Request): DashboardAuthContext {
  return (resLocalAuth(req) ?? { role: 'admin' }) as DashboardAuthContext;
}

function resLocalAuth(req: Request): DashboardAuthContext | undefined {
  return (req.res?.locals as { dashboardAuth?: DashboardAuthContext } | undefined)?.dashboardAuth;
}

export function getDashboardAuthContext(req: Request): DashboardAuthContext {
  return resolveAuthContext(req);
}

export function hasDashboardPermission(req: Request, permission: DashboardPermission): boolean {
  const authContext = resolveAuthContext(req);
  return hasDashboardPermissionForContext(authContext, permission);
}

export function getAllowedQueues(req: Request): Set<string> | null {
  const authContext = resolveAuthContext(req);
  const queues = authContext.allowedQueues;
  if (!queues || queues.length === 0) {
    return null;
  }

  return new Set(queues);
}

export function sendUnauthorized(
  res: Response,
  auth: DashboardAuthOptions,
  message = 'Unauthorized'
): void {
  const realm = auth.type === 'none' ? 'vasto-dashboard' : (auth.realm ?? 'vasto-dashboard');
  const challenge = auth.type === 'bearer' ? `Bearer realm="${realm}"` : `Basic realm="${realm}"`;
  res.status(401).set('www-authenticate', challenge).json({ error: message });
}

export async function checkAuth(
  req: Request,
  res: Response,
  auth: DashboardAuthOptions
): Promise<boolean> {
  const authContext = await authenticateDashboardRequest(req, auth);
  if (!authContext) {
    sendUnauthorized(res, auth);
    return false;
  }

  (res.locals as { dashboardAuth?: DashboardAuthContext }).dashboardAuth = authContext;

  return true;
}